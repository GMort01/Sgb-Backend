const jwt = require('jsonwebtoken');

const rolesValidos = new Set(['Estudiante', 'Profesor', 'Bibliotecario']);
const jwtSecret = process.env.JWT_SECRET
    || (process.env.NODE_ENV === 'production' ? null : 'sgb-local-development-secret-change-me');

if (!jwtSecret) {
    throw new Error('JWT_SECRET es obligatorio en producción.');
}
if (process.env.NODE_ENV === 'production' && Buffer.byteLength(jwtSecret) < 32) {
    throw new Error('JWT_SECRET debe tener al menos 32 bytes en producción.');
}

function autenticar(req, res, next) {
    const authorization = req.get('authorization');
    const [scheme, token] = authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ success: false, message: 'Debes iniciar sesión para continuar.' });
    }

    try {
        const claims = jwt.verify(token, jwtSecret, {
            issuer: 'sgb-unimadeira',
            algorithms: ['HS256'],
        });
        const id = Number(claims.sub);
        if (!Number.isSafeInteger(id) || id < 1 || !rolesValidos.has(claims.role)) {
            return res.status(401).json({ success: false, message: 'La sesión no es válida.' });
        }
        req.user = { id, rol: claims.role };
        return next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(401).json({ success: false, message: 'La sesión no es válida o expiró.' });
        }
        return next(error);
    }
}

function permitirRoles(...roles) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.rol)) {
            return res.status(403).json({ success: false, message: 'No tienes permiso para realizar esta operación.' });
        }
        return next();
    };
}

module.exports = { autenticar, permitirRoles, jwtSecret };
