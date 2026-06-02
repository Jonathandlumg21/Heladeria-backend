const express = require('express');
const cors    = require('cors');
const path    = require('path');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Rutas (las iremos agregando en el Paso 5)
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/productos',  require('./routes/productos'));
app.use('/api/recetas',    require('./routes/recetas'));
app.use('/api/ventas',     require('./routes/ventas'));
app.use('/api/inventario', require('./routes/inventario'));
app.use('/api/usuarios',   require('./routes/usuarios'));
app.use('/api/dashboard',  require('./routes/dashboard'));

app.get('/api/health', (req, res) =>
  res.json({ ok: true, timestamp: new Date() })
);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Error interno del servidor' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});