const router = require('express').Router()
const pool   = require('../config/db')
const { verificarToken, soloRoles } = require('../middlewares/auth')

// ─────────────────────────────────────────
// GET /api/compras/hoy
// Listar compras del día actual
// ─────────────────────────────────────────
router.get('/hoy', verificarToken, soloRoles('admin', 'vendedor'), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*, u.nombre AS usuario
      FROM compras c
      JOIN usuarios u ON u.id = c.usuario_id
      WHERE DATE(c.fecha AT TIME ZONE 'America/Guatemala') = (NOW() AT TIME ZONE 'America/Guatemala')::date
      ORDER BY c.fecha DESC
    `)
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─────────────────────────────────────────
// POST /api/compras
// Registrar una nueva compra
// ─────────────────────────────────────────
router.post('/', verificarToken, soloRoles('admin', 'vendedor'), async (req, res) => {
  try {
    const { descripcion, monto } = req.body
    if (!descripcion || !monto || monto <= 0) {
      return res.status(400).json({ error: 'Descripción y monto válido son requeridos' })
    }
    const { rows } = await pool.query(`
      INSERT INTO compras (descripcion, monto, usuario_id)
      VALUES ($1, $2, $3) RETURNING *
    `, [descripcion, parseFloat(monto), req.usuario.id])
    res.status(201).json(rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─────────────────────────────────────────
// DELETE /api/compras/:id
// Eliminar una compra (solo admin)
// ─────────────────────────────────────────
router.delete('/:id', verificarToken, soloRoles('admin'), async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM compras WHERE id=$1', [req.params.id])
    if (rowCount === 0) return res.status(404).json({ error: 'Compra no encontrada' })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─────────────────────────────────────────
// GET /api/compras/resumen-hoy
// Resumen del día: ventas + compras + efectivo neto
// ─────────────────────────────────────────
router.get('/resumen-hoy', verificarToken, soloRoles('admin', 'vendedor'), async (req, res) => {
  try {
    // Ventas de hoy
    const { rows: [ventas] } = await pool.query(`
      SELECT
        COALESCE(SUM(total), 0)::numeric                                              AS total_ventas,
        COALESCE(SUM(CASE WHEN metodo_pago='efectivo' THEN total ELSE 0 END), 0)::numeric AS efectivo,
        COALESCE(SUM(CASE WHEN metodo_pago='tarjeta'  THEN total ELSE 0 END), 0)::numeric AS tarjeta,
        COALESCE(SUM(CASE WHEN metodo_pago='fri'      THEN total ELSE 0 END), 0)::numeric AS fri,
        COUNT(*)::int                                                                  AS cantidad_ventas
      FROM ventas
      WHERE DATE(fecha AT TIME ZONE 'America/Guatemala') = (NOW() AT TIME ZONE 'America/Guatemala')::date
    `)

    // Compras de hoy
    const { rows: [compras] } = await pool.query(`
      SELECT COALESCE(SUM(monto), 0)::numeric AS total_compras
      FROM compras
      WHERE DATE(fecha AT TIME ZONE 'America/Guatemala') = (NOW() AT TIME ZONE 'America/Guatemala')::date
    `)

    const efectivo_neto = parseFloat(ventas.efectivo) - parseFloat(compras.total_compras)

    res.json({
      total_ventas:          parseFloat(ventas.total_ventas),
      ventas_efectivo:       parseFloat(ventas.efectivo),
      ventas_tarjeta:        parseFloat(ventas.tarjeta),
      ventas_fri:            parseFloat(ventas.fri),
      cantidad_ventas:       ventas.cantidad_ventas,
      total_compras:         parseFloat(compras.total_compras),
      efectivo_neto,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─────────────────────────────────────────
// POST /api/compras/cierre
// Realizar el cierre del día
// ─────────────────────────────────────────
router.post('/cierre', verificarToken, soloRoles('admin', 'vendedor'), async (req, res) => {
  try {
    // Verificar si ya hay cierre del día
    const { rows: [existente] } = await pool.query(`
      SELECT id FROM cierres
      WHERE fecha_cierre = (NOW() AT TIME ZONE 'America/Guatemala')::date
    `)
    if (existente) {
      return res.status(400).json({ error: 'Ya se realizó el cierre del día de hoy' })
    }

    // Calcular totales
    const { rows: [ventas] } = await pool.query(`
      SELECT
        COALESCE(SUM(total), 0)::numeric AS total_ventas,
        COALESCE(SUM(CASE WHEN metodo_pago='efectivo' THEN total ELSE 0 END), 0)::numeric AS efectivo,
        COALESCE(SUM(CASE WHEN metodo_pago='tarjeta'  THEN total ELSE 0 END), 0)::numeric AS tarjeta,
        COALESCE(SUM(CASE WHEN metodo_pago='fri'      THEN total ELSE 0 END), 0)::numeric AS fri,
        COUNT(*)::int AS cantidad_ventas
      FROM ventas
      WHERE DATE(fecha AT TIME ZONE 'America/Guatemala') = (NOW() AT TIME ZONE 'America/Guatemala')::date
    `)

    const { rows: [compras] } = await pool.query(`
      SELECT COALESCE(SUM(monto), 0)::numeric AS total_compras
      FROM compras
      WHERE DATE(fecha AT TIME ZONE 'America/Guatemala') = (NOW() AT TIME ZONE 'America/Guatemala')::date
    `)

    const efectivo_neto = parseFloat(ventas.efectivo) - parseFloat(compras.total_compras)

    // Guardar el cierre
    const { rows: [cierre] } = await pool.query(`
      INSERT INTO cierres (
        fecha_cierre, total_ventas, total_ventas_efectivo,
        total_ventas_tarjeta, total_ventas_fri,
        total_compras, efectivo_neto, cantidad_ventas, usuario_id
      ) VALUES ((NOW() AT TIME ZONE 'America/Guatemala')::date, $1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      ventas.total_ventas,
      ventas.efectivo,
      ventas.tarjeta,
      ventas.fri,
      compras.total_compras,
      efectivo_neto,
      ventas.cantidad_ventas,
      req.usuario.id,
    ])

    res.status(201).json(cierre)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─────────────────────────────────────────
// GET /api/compras/cierres
// Historial de cierres (solo admin)
// ─────────────────────────────────────────
router.get('/cierres', verificarToken, soloRoles('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*, u.nombre AS usuario
      FROM cierres c
      JOIN usuarios u ON u.id = c.usuario_id
      ORDER BY c.fecha_cierre DESC
      LIMIT 30
    `)
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router