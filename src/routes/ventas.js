const router = require('express').Router();
const pool   = require('../config/db');
const { verificarToken, soloRoles } = require('../middlewares/auth');

// POST /api/ventas — registrar una nueva venta
router.post('/', verificarToken, soloRoles('admin', 'vendedor'), async (req, res) => {
  const { items, metodo_pago, pagos } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Debe incluir al menos un producto' });
  }

  // Pago dividido: valida la lista de pagos en vez del metodo_pago único
  let pagosValidados = null;
  if (pagos) {
    if (!Array.isArray(pagos) || pagos.length === 0) {
      return res.status(400).json({ error: 'La lista de pagos es inválida' });
    }
    for (const p of pagos) {
      if (!['efectivo', 'tarjeta', 'fri'].includes(p.metodo_pago)) {
        return res.status(400).json({ error: `Método de pago inválido: ${p.metodo_pago}` });
      }
      if (!(parseFloat(p.monto) > 0)) {
        return res.status(400).json({ error: 'Cada pago debe tener un monto mayor a 0' });
      }
    }
    pagosValidados = pagos.map(p => ({ metodo_pago: p.metodo_pago, monto: parseFloat(p.monto) }));
  } else if (!['efectivo', 'tarjeta', 'fri'].includes(metodo_pago)) {
    return res.status(400).json({ error: 'Método de pago inválido' });
  }

  // Paso 1: validar disponibilidad ANTES de abrir la transacción
  for (const item of items) {
    const { rows: [prod] } = await pool.query(
      'SELECT tipo, stock, nombre FROM productos WHERE id=$1 AND activo=true',
      [item.producto_id]
    );
    if (!prod) {
      return res.status(400).json({ error: `Producto ID ${item.producto_id} no encontrado` });
    }

    if (prod.tipo === 'simple') {
      if (prod.stock < item.cantidad) {
        return res.status(400).json({
          error: `Stock insuficiente: "${prod.nombre}". Disponible: ${prod.stock}, solicitado: ${item.cantidad}`,
        });
      }
    } else {
      const { rows: receta } = await pool.query(`
        SELECT r.cantidad, ing.nombre, ing.stock
        FROM recetas r
        JOIN productos ing ON ing.id = r.ingrediente_id
        WHERE r.producto_id = $1
      `, [item.producto_id]);

      if (receta.length === 0) {
        return res.status(400).json({
          error: `El producto compuesto "${prod.nombre}" no tiene receta definida`,
        });
      }

      for (const ing of receta) {
        const necesario = parseFloat(ing.cantidad) * item.cantidad;
        if (parseFloat(ing.stock) < necesario) {
          return res.status(400).json({
            error: `Ingrediente insuficiente: "${ing.nombre}". Necesita ${necesario}, hay ${ing.stock}`,
          });
        }
      }
    }
  }

  // Paso 2: registrar en transacción
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const total = items.reduce((s, i) => s + i.cantidad * parseFloat(i.precio_unitario), 0);

    if (pagosValidados) {
      const sumaPagos = pagosValidados.reduce((s, p) => s + p.monto, 0);
      if (Math.abs(sumaPagos - total) > 0.01) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `La suma de los pagos (Q${sumaPagos.toFixed(2)}) no coincide con el total (Q${total.toFixed(2)})`,
        });
      }
    }

    const metodoGuardado = pagosValidados
      ? (pagosValidados.length > 1 ? 'mixto' : pagosValidados[0].metodo_pago)
      : metodo_pago;

    const { rows } = await client.query(
      'INSERT INTO ventas (usuario_id, total, metodo_pago) VALUES ($1,$2,$3) RETURNING id',
      [req.usuario.id, total.toFixed(2), metodoGuardado]
    );
    const venta_id = rows[0].id;

    const pagosAGuardar = pagosValidados || [{ metodo_pago, monto: total }];
    for (const p of pagosAGuardar) {
      await client.query(
        'INSERT INTO venta_pagos (venta_id, metodo_pago, monto) VALUES ($1,$2,$3)',
        [venta_id, p.metodo_pago, p.monto.toFixed(2)]
      );
    }

    for (const item of items) {
      await client.query(
        'INSERT INTO detalle_ventas (venta_id, producto_id, cantidad, precio_unitario) VALUES ($1,$2,$3,$4)',
        [venta_id, item.producto_id, item.cantidad, parseFloat(item.precio_unitario)]
      );

      const { rows: [prod] } = await client.query(
        'SELECT tipo FROM productos WHERE id=$1', [item.producto_id]
      );

      if (prod.tipo === 'compuesto') {
        const { rows: receta } = await client.query(
          'SELECT ingrediente_id, cantidad FROM recetas WHERE producto_id=$1',
          [item.producto_id]
        );
        for (const ing of receta) {
          await client.query(
            'UPDATE productos SET stock = stock - $1 WHERE id=$2',
            [parseFloat(ing.cantidad) * item.cantidad, ing.ingrediente_id]
          );
        }
      } else {
        await client.query(
          'UPDATE productos SET stock = stock - $1 WHERE id=$2',
          [item.cantidad, item.producto_id]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ ok: true, venta_id, total: total.toFixed(2) });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/ventas/recientes — últimas 10 ventas (admin y vendedor)
router.get('/recientes', verificarToken, soloRoles('admin', 'vendedor'), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        v.id, v.total, v.metodo_pago, v.fecha,
        u.nombre AS vendedor,
        COUNT(dv.id)::int AS num_items,
        COALESCE((
          SELECT json_agg(json_build_object('metodo_pago', vp.metodo_pago, 'monto', vp.monto))
          FROM venta_pagos vp WHERE vp.venta_id = v.id
        ), '[]') AS pagos
      FROM ventas v
      JOIN usuarios u ON u.id = v.usuario_id
      JOIN detalle_ventas dv ON dv.venta_id = v.id
      GROUP BY v.id, u.nombre
      ORDER BY v.fecha DESC
      LIMIT 10
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ventas — listar ventas recientes (solo admin)
router.get('/', verificarToken, soloRoles('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT v.*, u.nombre AS vendedor,
        COALESCE((
          SELECT json_agg(json_build_object('metodo_pago', vp.metodo_pago, 'monto', vp.monto))
          FROM venta_pagos vp WHERE vp.venta_id = v.id
        ), '[]') AS pagos
      FROM ventas v
      JOIN usuarios u ON u.id = v.usuario_id
      ORDER BY v.fecha DESC
      LIMIT 100
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ventas/reporte?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&metodo=
router.get('/reporte', verificarToken, soloRoles('admin'), async (req, res) => {
  const { desde, hasta, metodo } = req.query;
  const params = [desde || '2000-01-01', hasta || new Date().toISOString().slice(0,10)];
  let metodoFiltro = '';
  if (metodo && ['efectivo','tarjeta','fri','mixto'].includes(metodo)) {
    params.push(metodo);
    metodoFiltro = `AND v.metodo_pago = $${params.length}`;
  }
  try {
    const { rows } = await pool.query(`
      SELECT
        v.id, v.fecha, v.total::numeric, v.metodo_pago,
        u.nombre AS vendedor,
        (SELECT COUNT(*) FROM detalle_ventas dv WHERE dv.venta_id = v.id)::int AS num_items,
        COALESCE((
          SELECT json_agg(json_build_object('metodo_pago', vp.metodo_pago, 'monto', vp.monto))
          FROM venta_pagos vp WHERE vp.venta_id = v.id
        ), '[]') AS pagos
      FROM ventas v
      JOIN usuarios u ON u.id = v.usuario_id
      WHERE v.fecha::date >= $1::date
        AND v.fecha::date <= $2::date
        ${metodoFiltro}
      ORDER BY v.fecha DESC
    `, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ventas/:id — detalle de una venta (solo admin)
router.get('/:id', verificarToken, soloRoles('admin'), async (req, res) => {
  try {
    const { rows: [venta] } = await pool.query(`
      SELECT v.*, u.nombre AS vendedor
      FROM ventas v JOIN usuarios u ON u.id = v.usuario_id
      WHERE v.id=$1
    `, [req.params.id]);
    if (!venta) return res.status(404).json({ error: 'Venta no encontrada' });

    const { rows: detalle } = await pool.query(`
      SELECT dv.*, p.nombre AS producto, p.imagen_url
      FROM detalle_ventas dv
      JOIN productos p ON p.id = dv.producto_id
      WHERE dv.venta_id=$1
    `, [req.params.id]);

    res.json({ ...venta, detalle });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;