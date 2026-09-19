// Script de un solo uso: crea la tabla gastos_negocio (pedidos y pagos del negocio).
// Uso: node src/migrate_gastos_negocio.js
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function migrar() {
  const client = await pool.connect();
  try {
    await client.query("SET timezone = 'America/Guatemala'");

    await client.query(`
      CREATE TABLE IF NOT EXISTS gastos_negocio (
        id          SERIAL PRIMARY KEY,
        categoria   VARCHAR(20) NOT NULL CHECK (categoria IN ('pedido','pago_negocio')),
        descripcion VARCHAR(200) NOT NULL,
        monto       NUMERIC(10,2) NOT NULL CHECK (monto > 0),
        usuario_id  INT NOT NULL REFERENCES usuarios(id),
        fecha       DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'America/Guatemala')::date,
        creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    console.log('Tabla gastos_negocio creada (o ya existía).');
  } finally {
    client.release();
    await pool.end();
  }
}

migrar().catch(err => {
  console.error('Error en la migración:', err.message);
  process.exit(1);
});
