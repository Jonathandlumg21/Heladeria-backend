require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function setup() {
  const client = await pool.connect();
  try {
    console.log('Creando tablas...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id          SERIAL PRIMARY KEY,
        nombre      VARCHAR(100) NOT NULL,
        email       VARCHAR(100) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        rol         VARCHAR(20) NOT NULL DEFAULT 'vendedor'
                    CHECK (rol IN ('admin','vendedor','bodeguero')),
        activo      BOOLEAN NOT NULL DEFAULT true,
        creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS categorias (
        id     SERIAL PRIMARY KEY,
        nombre VARCHAR(80) UNIQUE NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS productos (
        id           SERIAL PRIMARY KEY,
        nombre       VARCHAR(120) NOT NULL,
        precio       NUMERIC(10,2) NOT NULL DEFAULT 0,
        stock        NUMERIC(10,3) NOT NULL DEFAULT 0,
        stock_minimo NUMERIC(10,3) NOT NULL DEFAULT 5,
        unidad       VARCHAR(30) NOT NULL DEFAULT 'unidades',
        imagen_url   TEXT,
        tipo         VARCHAR(20) NOT NULL DEFAULT 'simple'
                     CHECK (tipo IN ('simple','compuesto')),
        categoria_id INT REFERENCES categorias(id) ON DELETE SET NULL,
        activo       BOOLEAN NOT NULL DEFAULT true
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS recetas (
        producto_id    INT NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
        ingrediente_id INT NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
        cantidad       NUMERIC(10,3) NOT NULL,
        PRIMARY KEY (producto_id, ingrediente_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ventas (
        id          SERIAL PRIMARY KEY,
        usuario_id  INT NOT NULL REFERENCES usuarios(id),
        total       NUMERIC(10,2) NOT NULL,
        metodo_pago VARCHAR(20) NOT NULL
                    CHECK (metodo_pago IN ('efectivo','tarjeta','fri')),
        fecha       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS detalle_ventas (
        id              SERIAL PRIMARY KEY,
        venta_id        INT NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
        producto_id     INT NOT NULL REFERENCES productos(id),
        cantidad        NUMERIC(10,3) NOT NULL,
        precio_unitario NUMERIC(10,2) NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS movimientos_inventario (
        id          SERIAL PRIMARY KEY,
        producto_id INT NOT NULL REFERENCES productos(id),
        usuario_id  INT NOT NULL REFERENCES usuarios(id),
        tipo        VARCHAR(20) NOT NULL CHECK (tipo IN ('entrada','ajuste','venta')),
        cantidad    NUMERIC(10,3) NOT NULL,
        nota        TEXT,
        fecha       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Permitir 'mixto' en ventas.metodo_pago (pago dividido entre varios métodos).
    // metodo_pago es un ENUM nativo de Postgres (tipo "metodo_pago"), no un VARCHAR+CHECK.
    await client.query(`
      ALTER TYPE metodo_pago ADD VALUE IF NOT EXISTS 'mixto'
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS venta_pagos (
        id          SERIAL PRIMARY KEY,
        venta_id    INT NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
        metodo_pago VARCHAR(20) NOT NULL CHECK (metodo_pago IN ('efectivo','tarjeta','fri')),
        monto       NUMERIC(10,2) NOT NULL CHECK (monto > 0)
      )
    `);

    console.log('Tablas creadas.');

    // Crear usuario admin si no existe
    const existe = await client.query(
      "SELECT id FROM usuarios WHERE email='admin@heladeria.com'"
    );
    if (existe.rows.length === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      await client.query(
        "INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ('Administrador','admin@heladeria.com',$1,'admin')",
        [hash]
      );
      console.log('Usuario admin creado: admin@heladeria.com / admin123');
    } else {
      console.log('El usuario admin ya existe.');
    }

    console.log('Setup completado.');
  } finally {
    client.release();
    await pool.end();
  }
}

setup().catch(err => {
  console.error('Error en setup:', err.message);
  process.exit(1);
});