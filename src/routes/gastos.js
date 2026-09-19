const router = require('express').Router()
const pool   = require('../config/db')
const { verificarToken, soloRoles } = require('../middlewares/auth')

const CATEGORIAS = ['pedido', 'pago_negocio']

// ─────────────────────────────────────────
// GET /api/gastos?categoria=&desde=&hasta=
// Historial de pedidos y pagos del negocio (solo admin)
// ─────────────────────────────────────────
router.get('/', verificarToken, soloRoles('admin'), async (req, res) => {
  const { categoria, desde, hasta } = req.query
  const params = []
  let where = '1=1'
  if (categoria && CATEGORIAS.includes(categoria)) {
    params.push(categoria)
    where += ` AND g.categoria = $${params.length}`
  }
  if (desde) {
    params.push(desde)
    where += ` AND g.fecha >= $${params.length}::date`
  }
  if (hasta) {
    params.push(hasta)
    where += ` AND g.fecha <= $${params.length}::date`
  }
  try {
    const { rows } = await pool.query(`
      SELECT g.*, u.nombre AS usuario
      FROM gastos_negocio g
      JOIN usuarios u ON u.id = g.usuario_id
      WHERE ${where}
      ORDER BY g.fecha DESC, g.id DESC
      LIMIT 300
    `, params)
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─────────────────────────────────────────
// GET /api/gastos/resumen-mes
// Totales de pedidos y pagos del negocio del mes actual (hora Guatemala)
// ─────────────────────────────────────────
router.get('/resumen-mes', verificarToken, soloRoles('admin', 'propietario'), async (req, res) => {
  try {
    const { rows: [r] } = await pool.query(`
      SELECT
        COALESCE(SUM(monto) FILTER (WHERE categoria = 'pedido'), 0)::numeric       AS total_pedidos,
        COALESCE(SUM(monto) FILTER (WHERE categoria = 'pago_negocio'), 0)::numeric AS total_pagos
      FROM gastos_negocio
      WHERE EXTRACT(MONTH FROM fecha) = EXTRACT(MONTH FROM (NOW() AT TIME ZONE 'America/Guatemala'))
        AND EXTRACT(YEAR  FROM fecha) = EXTRACT(YEAR  FROM (NOW() AT TIME ZONE 'America/Guatemala'))
    `)
    res.json({
      total_pedidos: parseFloat(r.total_pedidos),
      total_pagos:   parseFloat(r.total_pagos),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─────────────────────────────────────────
// POST /api/gastos
// Registrar un pedido o pago del negocio (solo admin)
// ─────────────────────────────────────────
router.post('/', verificarToken, soloRoles('admin'), async (req, res) => {
  const { categoria, descripcion, monto, fecha } = req.body
  if (!CATEGORIAS.includes(categoria)) {
    return res.status(400).json({ error: 'Categoría inválida' })
  }
  if (!descripcion || !monto || monto <= 0) {
    return res.status(400).json({ error: 'Descripción y monto válido son requeridos' })
  }
  try {
    const { rows } = await pool.query(`
      INSERT INTO gastos_negocio (categoria, descripcion, monto, usuario_id, fecha)
      VALUES ($1, $2, $3, $4, COALESCE($5::date, (NOW() AT TIME ZONE 'America/Guatemala')::date))
      RETURNING *
    `, [categoria, descripcion, parseFloat(monto), req.usuario.id, fecha || null])
    res.status(201).json(rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─────────────────────────────────────────
// DELETE /api/gastos/:id
// Eliminar un registro (solo admin)
// ─────────────────────────────────────────
router.delete('/:id', verificarToken, soloRoles('admin'), async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM gastos_negocio WHERE id=$1', [req.params.id])
    if (rowCount === 0) return res.status(404).json({ error: 'Registro no encontrado' })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
