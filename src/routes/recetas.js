const router = require('express').Router();
const pool   = require('../config/db');
const { verificarToken, soloRoles } = require('../middlewares/auth');

// GET /api/recetas/:producto_id — ver receta de un producto
router.get('/:producto_id', verificarToken, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        r.id,
        r.ingrediente_id,
        r.cantidad,
        p.nombre  AS ingrediente,
        p.unidad  AS unidad_ingrediente,
        p.stock   AS stock_actual
      FROM recetas r
      JOIN productos p ON p.id = r.ingrediente_id
      WHERE r.producto_id = $1
      ORDER BY p.nombre
    `, [req.params.producto_id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/recetas/:producto_id — guardar receta completa (reemplaza la anterior)
router.put('/:producto_id', verificarToken, soloRoles('admin'), async (req, res) => {
  const { ingredientes } = req.body;

  if (!Array.isArray(ingredientes) || ingredientes.length === 0) {
    return res.status(400).json({ error: 'Debe incluir al menos un ingrediente' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM recetas WHERE producto_id=$1', [req.params.producto_id]);
    for (const ing of ingredientes) {
      await client.query(
        'INSERT INTO recetas (producto_id, ingrediente_id, cantidad) VALUES ($1,$2,$3)',
        [req.params.producto_id, ing.ingrediente_id, parseFloat(ing.cantidad)]
      );
    }
    await client.query(
      "UPDATE productos SET tipo='compuesto' WHERE id=$1",
      [req.params.producto_id]
    );
    await client.query('COMMIT');
    res.json({ ok: true, mensaje: 'Receta guardada correctamente' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/recetas/:producto_id — eliminar receta (vuelve a simple)
router.delete('/:producto_id', verificarToken, soloRoles('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM recetas WHERE producto_id=$1', [req.params.producto_id]);
    await pool.query("UPDATE productos SET tipo='simple' WHERE id=$1", [req.params.producto_id]);
    res.json({ ok: true, mensaje: 'Receta eliminada. Producto marcado como simple.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;