const router = require('express').Router();
const pool   = require('../config/db');
const { verificarToken, soloRoles } = require('../middlewares/auth');

// GET /api/inventario — ver stock de todos los productos
router.get('/', verificarToken, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        p.id,
        p.nombre,
        p.tipo,
        p.stock,
        p.stock_minimo,
        p.unidad,
        p.imagen_url,
        c.nombre AS categoria,
        CASE
          WHEN p.stock = 0               THEN 'sin_stock'
          WHEN p.stock <= p.stock_minimo THEN 'bajo'
          ELSE 'ok'
        END AS estado_stock
      FROM productos p
      LEFT JOIN categorias c ON c.id = p.categoria_id
      WHERE p.activo = true
      ORDER BY estado_stock ASC, p.nombre
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inventario/entrada — ingresar stock (admin y bodeguero)
router.post('/entrada', verificarToken, soloRoles('admin', 'bodeguero'), async (req, res) => {
  const { producto_id, cantidad, nota } = req.body;

  if (!producto_id || !cantidad || cantidad <= 0) {
    return res.status(400).json({ error: 'Producto y cantidad positiva son requeridos' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [prod] } = await client.query(
      'UPDATE productos SET stock = stock + $1 WHERE id=$2 AND activo=true RETURNING *',
      [parseInt(cantidad), producto_id]
    );
    if (!prod) return res.status(404).json({ error: 'Producto no encontrado' });

    await client.query(
      'INSERT INTO movimientos_inventario (producto_id, usuario_id, tipo, cantidad, nota) VALUES ($1,$2,$3,$4,$5)',
      [producto_id, req.usuario.id, 'entrada', parseInt(cantidad), nota || null]
    );

    await client.query('COMMIT');
    res.json({ ok: true, producto: prod });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/inventario/ajuste — ajuste manual de stock (solo admin)
router.post('/ajuste', verificarToken, soloRoles('admin'), async (req, res) => {
  const { producto_id, stock_nuevo, nota } = req.body;

  if (producto_id === undefined || stock_nuevo === undefined || stock_nuevo < 0) {
    return res.status(400).json({ error: 'Producto y stock nuevo (≥0) son requeridos' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [antes] } = await client.query(
      'SELECT stock FROM productos WHERE id=$1', [producto_id]
    );
    const diferencia = parseInt(stock_nuevo) - parseInt(antes.stock);

    await client.query(
      'UPDATE productos SET stock=$1 WHERE id=$2',
      [parseInt(stock_nuevo), producto_id]
    );

    await client.query(
      'INSERT INTO movimientos_inventario (producto_id, usuario_id, tipo, cantidad, nota) VALUES ($1,$2,$3,$4,$5)',
      [producto_id, req.usuario.id, 'ajuste', Math.abs(diferencia),
       nota || `Ajuste manual: de ${antes.stock} a ${stock_nuevo}`]
    );

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/inventario/movimientos — historial de movimientos (solo admin)
router.get('/movimientos', verificarToken, soloRoles('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        m.*,
        p.nombre AS producto,
        u.nombre AS usuario
      FROM movimientos_inventario m
      JOIN productos p ON p.id = m.producto_id
      JOIN usuarios  u ON u.id = m.usuario_id
      ORDER BY m.fecha DESC
      LIMIT 200
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;