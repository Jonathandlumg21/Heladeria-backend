// Script de un solo uso: crea venta_pagos (si setup.js aún no corrió) y
// rellena una fila por cada venta existente que todavía no tenga desglose.
// Uso: node src/migrate_venta_pagos.js
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

    const { rows: [{ count: antes }] } = await client.query('SELECT COUNT(*)::int FROM venta_pagos');
    console.log(`venta_pagos tiene ${antes} filas antes del backfill.`);

    const { rowCount } = await client.query(`
      INSERT INTO venta_pagos (venta_id, metodo_pago, monto)
      SELECT v.id, v.metodo_pago, v.total
      FROM ventas v
      WHERE v.metodo_pago IN ('efectivo','tarjeta','fri')
        AND NOT EXISTS (SELECT 1 FROM venta_pagos vp WHERE vp.venta_id = v.id)
    `);
    console.log(`Backfill completado: ${rowCount} filas insertadas.`);

    const { rows: sinCubrir } = await client.query(`
      SELECT v.id, v.metodo_pago FROM ventas v
      WHERE NOT EXISTS (SELECT 1 FROM venta_pagos vp WHERE vp.venta_id = v.id)
    `);
    if (sinCubrir.length > 0) {
      console.warn('Ventas sin desglose de pago tras el backfill (revisar manualmente):', sinCubrir);
    } else {
      console.log('Todas las ventas tienen desglose de pago.');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

migrar().catch(err => {
  console.error('Error en la migración:', err.message);
  process.exit(1);
});
