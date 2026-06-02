const jwt = require('jsonwebtoken');

const verificarToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }
  const token = authHeader.split(' ')[1];
  try {
    req.usuario = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
};

const soloRoles = (...roles) => (req, res, next) => {
  if (!req.usuario) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  if (!roles.includes(req.usuario.rol)) {
    return res.status(403).json({
      error: `Acceso denegado. Rol requerido: ${roles.join(' o ')}`,
    });
  }
  next();
};

module.exports = { verificarToken, soloRoles };