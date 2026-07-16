const router = require('express').Router();
const pool   = require('../config/db');
const { verificarToken, soloRoles } = require('../middlewares/auth');

// GET /api/reportes/stock — productos con bajo stock o sin stock
router.get('/stock', verificarToken, soloRoles('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        p.id,
        p.nombre,
        p.categoria,
        p.stock,
        p.stock_minimo,
        p.unidad,
        CASE
          WHEN p.stock = 0 THEN 'sin_stock'
          WHEN p.stock_minimo IS NOT NULL
            AND p.stock_minimo > 0
            AND p.stock < p.stock_minimo THEN 'bajo_stock'
          ELSE 'ok'
        END AS estado,
        GREATEST(COALESCE(p.stock_minimo, 0) - p.stock, 0) AS faltante
      FROM productos p
      WHERE p.activo = true
      ORDER BY p.stock ASC, p.nombre ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error('[/reportes/stock]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
