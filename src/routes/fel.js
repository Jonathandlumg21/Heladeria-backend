const router = require('express').Router()
const pool   = require('../config/db')
const { verificarToken, soloRoles } = require('../middlewares/auth')
require('dotenv').config()

const QAPI_BASE = 'https://api.dtevia.com.gt/v1'
const QAPI_KEY  = process.env.QAPI_API_KEY

// Datos del emisor quemados — siempre serán los mismos
const EMISOR = {
  nit:                    '52081575',
  nombre:                 'Heladeria Sarita Doble Via',
  nombre_comercial:       'Heladeria Sarita',
  codigo_establecimiento: 1,
  afiliacion_iva:         'PEQ',
  direccion: {
    calle:         'Guastatoya',
    municipio:     'Guastatoya',
    departamento:  'El Progreso',
    codigo_postal: '22001',
    pais:          'GT',
  },
  correo: 'heladeriasarita@gmail.com',
}

// ─────────────────────────────────────────
// POST /api/fel/facturar/:venta_id
// Genera y certifica una factura FEL
// ─────────────────────────────────────────
router.post('/facturar/:venta_id', verificarToken, soloRoles('admin', 'vendedor'), async (req, res) => {
  try {
    const { nit_receptor, nombre_receptor } = req.body

    // Receptor: con NIT o Consumidor Final
    const receptor = nit_receptor ? {
      id:      nit_receptor,
      tipo_id: 'NIT',
      nombre:  nombre_receptor || 'Cliente',
    } : {
      id:      'CF',
      tipo_id: 'NIT',
      nombre:  'Consumidor Final',
    }

    // Obtener detalle de la venta
    const { rows: detalle } = await pool.query(`
      SELECT dv.cantidad, dv.precio_unitario, p.nombre
      FROM detalle_ventas dv
      JOIN productos p ON p.id = dv.producto_id
      WHERE dv.venta_id = $1
    `, [req.params.venta_id])

    if (!detalle.length) {
      return res.status(404).json({ error: 'Venta no encontrada' })
    }

    // Construir items para QAPI
    // Pequeño contribuyente: no cobra IVA por separado.
    // QAPI exige monto_gravable=0 y monto_impuesto=0 para tipo_dte FPEQ.
    const items = detalle.map(item => {
    const precioUnitario = parseFloat(item.precio_unitario)
    const cantidad       = item.cantidad
    const descuento      = 0

    return {
        tipo:            'B',
        cantidad,
        unidad_medida:   'UND',
        descripcion:      item.nombre,
        precio_unitario:  precioUnitario,
        descuento,
        impuestos: [{
            nombre:                 'IVA',
            codigo_unidad_gravable: 1,
            monto_gravable:         0,
            monto_impuesto:         0,
            }],
         }
    })

    // Fecha en zona horaria de Guatemala UTC-6
    const now          = new Date()
    const fechaLocal   = new Date(now.getTime() - 6 * 60 * 60 * 1000)
    const fechaEmision = fechaLocal.toISOString().slice(0, 19) + '-06:00'

    // Payload completo para QAPI
    const payload = {
      tipo_dte:      'FPEQ',
      moneda:        'GTQ',
      fecha_emision: fechaEmision,
      emisor:        EMISOR,
      receptor,
      frases: [{ tipo_frase: 1, codigo_escenario: 2 }],
      items,
      metadata: { referencia_interna: `VENTA-${req.params.venta_id}` },
    }

    // Enviar a QAPI
    const qapiRes = await fetch(`${QAPI_BASE}/invoices`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${QAPI_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const qapiData = await qapiRes.json()

    if (!qapiRes.ok) {
      console.error('QAPI error:', qapiData)
      return res.status(qapiRes.status).json({ error: qapiData })
    }

    // Guardar ID de QAPI en la venta
    await pool.query(
      'UPDATE ventas SET qapi_invoice_id=$1, fel_status=$2 WHERE id=$3',
      [qapiData.id, 'PROCESSING', req.params.venta_id]
    )

    // Polling hasta CERTIFIED (máx 10 intentos, 1 seg entre cada uno)
    let certified = null
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 1000))
      const pollRes  = await fetch(`${QAPI_BASE}/invoices/${qapiData.id}`, {
        headers: { Authorization: `Bearer ${QAPI_KEY}` },
      })
      const pollData = await pollRes.json()

      if (pollData.status === 'CERTIFIED') {
        certified = pollData
        break
      }
      if (pollData.status === 'FAILED') {
        await pool.query(
          'UPDATE ventas SET fel_status=$1 WHERE id=$2',
          ['FAILED', req.params.venta_id]
        )
        return res.status(422).json({ error: pollData.error_message })
      }
    }

    if (!certified) {
      return res.status(202).json({
        status:     'PROCESSING',
        invoice_id: qapiData.id,
        mensaje:    'La factura está siendo procesada, consulta el estado en unos segundos',
      })
    }

    // Guardar datos certificados en la venta
    await pool.query(`
      UPDATE ventas
      SET fel_status=$1, uuid_sat=$2, numero_dte=$3, pdf_url_fel=$4
      WHERE id=$5
    `, [
      'CERTIFIED',
      certified.uuid_sat,
      certified.numero_dte,
      certified.pdf_url,
      req.params.venta_id,
    ])

    res.json({
      ok:         true,
      status:     'CERTIFIED',
      uuid_sat:   certified.uuid_sat,
      numero_dte: certified.numero_dte,
      pdf_url:    certified.pdf_url,
    })

  } catch (err) {
    console.error('FEL error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ─────────────────────────────────────────
// GET /api/fel/estado/:venta_id
// Consultar estado FEL de una venta
// ─────────────────────────────────────────
router.get('/estado/:venta_id', verificarToken, async (req, res) => {
  try {
    const { rows: [venta] } = await pool.query(`
      SELECT fel_status, uuid_sat, numero_dte, pdf_url_fel, qapi_invoice_id
      FROM ventas WHERE id=$1
    `, [req.params.venta_id])

    if (!venta) return res.status(404).json({ error: 'Venta no encontrada' })
    res.json(venta)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─────────────────────────────────────────
// GET /api/fel/factura/:invoice_id
// Consultar factura directamente en QAPI
// ─────────────────────────────────────────
router.get('/factura/:invoice_id', verificarToken, async (req, res) => {
  try {
    const response = await fetch(`${QAPI_BASE}/invoices/${req.params.invoice_id}`, {
      headers: { Authorization: `Bearer ${QAPI_KEY}` },
    })
    const data = await response.json()
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router