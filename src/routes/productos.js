const router = require('express').Router();
const pool   = require('../config/db');
const upload = require('../config/multer');
const { verificarToken, soloRoles } = require('../middlewares/auth');

// GET /api/productos — lista todos los productos activos
router.get('/', verificarToken, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*, c.nombre AS categoria
      FROM productos p
      LEFT JOIN categorias c ON c.id = p.categoria_id
      WHERE p.activo = true
      ORDER BY c.nombre, p.nombre
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/productos/pos/disponibles — para el POS con disponibilidad real
router.get('/pos/disponibles', verificarToken, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        p.id, p.nombre, p.imagen_url, p.precio, p.tipo,
        c.nombre AS categoria,
        CASE
          WHEN p.tipo = 'simple' THEN p.stock
          ELSE COALESCE(FLOOR(MIN(ing.stock / NULLIF(r.cantidad, 0)))::int, 0)
        END AS unidades_disponibles,
        CASE
          WHEN p.tipo = 'compuesto' THEN (
            SELECT ing2.nombre
            FROM recetas r2
            JOIN productos ing2 ON ing2.id = r2.ingrediente_id
            WHERE r2.producto_id = p.id
            ORDER BY (ing2.stock / r2.cantidad) ASC
            LIMIT 1
          )
          ELSE NULL
        END AS ingrediente_limitante
      FROM productos p
      LEFT JOIN recetas r     ON r.producto_id = p.id
      LEFT JOIN productos ing ON ing.id = r.ingrediente_id
      LEFT JOIN categorias c  ON c.id = p.categoria_id
      WHERE p.activo = true
      GROUP BY p.id, p.nombre, p.imagen_url, p.precio, p.tipo, p.stock, c.nombre
      ORDER BY c.nombre, p.nombre
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/productos/:id — obtener un producto por ID
router.get('/:id', verificarToken, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*, c.nombre AS categoria
      FROM productos p
      LEFT JOIN categorias c ON c.id = p.categoria_id
      WHERE p.id = $1
    `, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/productos — crear producto con imagen (solo admin)
router.post('/', verificarToken, soloRoles('admin'),
  upload.single('imagen'), async (req, res) => {
  try {
    const { nombre, precio, stock, stock_minimo, unidad, categoria_id, tipo } = req.body;
    if (!nombre || !precio) {
      return res.status(400).json({ error: 'Nombre y precio son requeridos' });
    }
    const imagen_url = req.file ? req.file.path : null;
    const { rows } = await pool.query(`
      INSERT INTO productos
        (nombre, precio, stock, stock_minimo, unidad, imagen_url, tipo, categoria_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
    `, [
      nombre,
      parseFloat(precio),
      parseInt(stock) || 0,
      parseInt(stock_minimo) || 5,
      unidad || 'unidades',
      imagen_url,
      tipo || 'simple',
      categoria_id || null,
    ]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/productos/:id — editar producto (solo admin)
router.put('/:id', verificarToken, soloRoles('admin'), async (req, res) => {
  try {
    const { nombre, precio, stock_minimo, unidad, categoria_id, tipo, activo } = req.body;
    const { rows } = await pool.query(`
      UPDATE productos
      SET nombre=$1, precio=$2, stock_minimo=$3, unidad=$4,
          categoria_id=$5, tipo=$6, activo=$7
      WHERE id=$8
      RETURNING *
    `, [nombre, parseFloat(precio), parseInt(stock_minimo), unidad,
        categoria_id || null, tipo, activo !== false, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/productos/:id/imagen — actualizar imagen (solo admin)
router.patch('/:id/imagen', verificarToken, soloRoles('admin'),
  upload.single('imagen'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se envió ninguna imagen' });
   const imagen_url = req.file.path;
    const { rows } = await pool.query(
      'UPDATE productos SET imagen_url=$1 WHERE id=$2 RETURNING *',
      [imagen_url, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/productos/:id — desactivar producto (solo admin)
router.delete('/:id', verificarToken, soloRoles('admin'), async (req, res) => {
  try {
    await pool.query('UPDATE productos SET activo=false WHERE id=$1', [req.params.id]);
    res.json({ ok: true, mensaje: 'Producto desactivado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;