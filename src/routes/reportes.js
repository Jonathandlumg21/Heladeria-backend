const router = require('express').Router();
const pool   = require('../config/db');
const { verificarToken, soloRoles } = require('../middlewares/auth');

// GET /api/reportes/stock — todos los productos con su estado de stock
router.get('/stock', verificarToken, soloRoles('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        id, nombre, categoria, tipo, stock, stock_minimo, unidad,
        CASE
          WHEN stock = 0 THEN 'sin_stock'
          WHEN stock_minimo IS NOT NULL AND stock_minimo > 0 AND stock < stock_minimo THEN 'bajo_stock'
          ELSE 'ok'
        END AS estado,
        GREATEST(COALESCE(stock_minimo, 0) - stock, 0) AS faltante
      FROM productos
      WHERE activo = true
        AND tipo != 'compuesto'
        AND (categoria IS NULL OR categoria != 'Especialidades')
      ORDER BY
        CASE
          WHEN stock = 0 THEN 0
          WHEN stock_minimo IS NOT NULL AND stock < stock_minimo THEN 1
          ELSE 2
        END,
        nombre ASC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
