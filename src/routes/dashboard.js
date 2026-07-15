const router = require('express').Router();
const pool   = require('../config/db');
const { verificarToken, soloRoles } = require('../middlewares/auth');

// GET /api/dashboard/ventas-diarias — últimos 30 días
router.get('/ventas-diarias', verificarToken, soloRoles('admin', 'propietario'), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        DATE(fecha)          AS dia,
        SUM(total)::numeric  AS total,
        COUNT(*)::int        AS cantidad,
        SUM(CASE WHEN metodo_pago='efectivo' THEN total ELSE 0 END)::numeric AS efectivo,
        SUM(CASE WHEN metodo_pago='tarjeta'  THEN total ELSE 0 END)::numeric AS tarjeta,
        SUM(CASE WHEN metodo_pago='fri'      THEN total ELSE 0 END)::numeric AS fri
      FROM ventas
      WHERE fecha >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(fecha)
      ORDER BY dia
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/ventas-mensuales — año actual
router.get('/ventas-mensuales', verificarToken, soloRoles('admin', 'propietario'), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        EXTRACT(MONTH FROM fecha)::int AS mes,
        TO_CHAR(fecha, 'TMMonth')      AS nombre_mes,
        SUM(total)::numeric            AS total,
        COUNT(*)::int                  AS cantidad
      FROM ventas
      WHERE EXTRACT(YEAR FROM fecha) = EXTRACT(YEAR FROM NOW())
      GROUP BY EXTRACT(MONTH FROM fecha), TO_CHAR(fecha, 'TMMonth')
      ORDER BY mes
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/ventas-anuales — todos los años
router.get('/ventas-anuales', verificarToken, soloRoles('admin', 'propietario'), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        EXTRACT(YEAR FROM fecha)::int AS anio,
        SUM(total)::numeric           AS total,
        COUNT(*)::int                 AS cantidad
      FROM ventas
      GROUP BY EXTRACT(YEAR FROM fecha)
      ORDER BY anio
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/stock-bajo — productos bajo el mínimo
router.get('/stock-bajo', verificarToken, soloRoles('admin', 'bodeguero', 'propietario'), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        id, nombre, categoria, tipo, stock, stock_minimo, unidad, imagen_url,
        GREATEST(stock_minimo - stock, 0) AS faltante
      FROM productos
      WHERE activo = true
        AND tipo != 'compuesto'
        AND (categoria IS NULL OR categoria != 'Especialidades')
        AND (
          stock = 0
          OR (stock_minimo IS NOT NULL AND stock_minimo > 0 AND stock < stock_minimo)
        )
      ORDER BY stock ASC, faltante DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/resumen — tarjetas del dashboard
router.get('/resumen', verificarToken, soloRoles('admin', 'propietario'), async (req, res) => {
  try {
    const hoy = await pool.query(`
      SELECT COALESCE(SUM(total),0)::numeric AS total, COUNT(*)::int AS cantidad
      FROM ventas WHERE DATE(fecha) = CURRENT_DATE
    `);
    const mes = await pool.query(`
      SELECT COALESCE(SUM(total),0)::numeric AS total, COUNT(*)::int AS cantidad
      FROM ventas
      WHERE EXTRACT(MONTH FROM fecha) = EXTRACT(MONTH FROM NOW())
        AND EXTRACT(YEAR  FROM fecha) = EXTRACT(YEAR  FROM NOW())
    `);
    const stockBajo = await pool.query(`
      SELECT COUNT(*)::int AS cantidad FROM productos
      WHERE stock <= stock_minimo AND activo = true
    `);
    const productosActivos = await pool.query(`
      SELECT COUNT(*)::int AS cantidad FROM productos WHERE activo = true
    `);

    res.json({
      ventas_hoy:           hoy.rows[0],
      ventas_mes:           mes.rows[0],
      productos_stock_bajo: stockBajo.rows[0].cantidad,
      total_productos:      productosActivos.rows[0].cantidad,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/productos-mas-vendidos — top 10 del mes
router.get('/productos-mas-vendidos', verificarToken, soloRoles('admin', 'propietario'), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        p.nombre,
        SUM(dv.cantidad)::int                        AS unidades,
        SUM(dv.cantidad * dv.precio_unitario)::numeric AS total
      FROM detalle_ventas dv
      JOIN ventas v    ON v.id  = dv.venta_id
      JOIN productos p ON p.id  = dv.producto_id
      WHERE v.fecha >= DATE_TRUNC('month', NOW())
      GROUP BY p.nombre
      ORDER BY unidades DESC
      LIMIT 10
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/ventas-por-metodo?periodo=dia|semana|mes|año
router.get('/ventas-por-metodo', verificarToken, soloRoles('admin', 'vendedor', 'propietario'), async (req, res) => {
  const { periodo = 'dia' } = req.query;

  const filtros = {
    dia:    `DATE(fecha) = CURRENT_DATE`,
    semana: `fecha >= DATE_TRUNC('week',  NOW())`,
    mes:    `fecha >= DATE_TRUNC('month', NOW())`,
    año:    `fecha >= DATE_TRUNC('year',  NOW())`,
  };

  const where = filtros[periodo] || filtros['dia'];

  try {
    const { rows } = await pool.query(`
      SELECT
        metodo_pago                   AS metodo,
        COALESCE(SUM(total), 0)::numeric AS total,
        COUNT(*)::int                 AS cantidad
      FROM ventas
      WHERE ${where}
      GROUP BY metodo_pago
      ORDER BY metodo_pago
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;