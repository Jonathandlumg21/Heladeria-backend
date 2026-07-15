const router = require('express').Router();
const pool   = require('../config/db');
const bcrypt = require('bcryptjs');
const { verificarToken, soloRoles } = require('../middlewares/auth');

// GET /api/usuarios — listar todos los usuarios (solo admin)
router.get('/', verificarToken, soloRoles('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nombre, email, rol, activo, creado_en FROM usuarios ORDER BY nombre'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/usuarios/categorias — listar categorías
router.get('/categorias', verificarToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM categorias ORDER BY nombre');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/usuarios/categorias — crear categoría (solo admin)
router.post('/categorias', verificarToken, soloRoles('admin'), async (req, res) => {
  const { nombre } = req.body;
  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: 'El nombre es requerido' });
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO categorias (nombre) VALUES ($1) RETURNING *',
      [nombre.trim()]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Ya existe una categoría con ese nombre' });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/usuarios/categorias/:id — eliminar categoría (solo admin)
router.delete('/categorias/:id', verificarToken, soloRoles('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM categorias WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/usuarios — crear usuario (solo admin)
router.post('/', verificarToken, soloRoles('admin'), async (req, res) => {
  try {
    const { nombre, email, password, rol } = req.body;
    if (!nombre || !email || !password || !rol) {
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }
    if (!['admin', 'vendedor', 'bodeguero', 'propietario'].includes(rol)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }

    const existe = await pool.query(
      'SELECT id FROM usuarios WHERE email=$1', [email]
    );
    if (existe.rows.length > 0) {
      return res.status(400).json({ error: 'El email ya está registrado' });
    }

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol)
       VALUES ($1,$2,$3,$4)
       RETURNING id, nombre, email, rol, activo`,
      [nombre, email, hash, rol]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/usuarios/:id — editar usuario (solo admin)
router.put('/:id', verificarToken, soloRoles('admin'), async (req, res) => {
  try {
    const { nombre, email, rol, activo } = req.body;
    const { rows } = await pool.query(`
      UPDATE usuarios
      SET nombre=$1, email=$2, rol=$3, activo=$4
      WHERE id=$5
      RETURNING id, nombre, email, rol, activo
    `, [nombre, email, rol, activo !== false, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/usuarios/:id/password — cambiar contraseña (solo admin)
router.patch('/:id/password', verificarToken, soloRoles('admin'), async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'UPDATE usuarios SET password_hash=$1 WHERE id=$2',
      [hash, req.params.id]
    );
    res.json({ ok: true, mensaje: 'Contraseña actualizada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/usuarios/:id/toggle — activar/desactivar usuario (solo admin)
router.patch('/:id/toggle', verificarToken, soloRoles('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      'UPDATE usuarios SET activo = NOT activo WHERE id=$1 RETURNING id, nombre, activo',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;