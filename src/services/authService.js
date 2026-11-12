const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const authRepository = require('../repositories/authRepository');
const { jwtSecret } = require('../middleware/auth');

class AuthService {
    async iniciarSesion(correo, password) {
        const usuario = await authRepository.buscarPorCorreo(correo.toLowerCase());
        if (!usuario || !usuario.passwordHash || !await bcrypt.compare(password, usuario.passwordHash)) {
            return null;
        }
        const token = jwt.sign(
            { role: usuario.rol },
            jwtSecret,
            { subject: String(usuario.id), expiresIn: '8h', issuer: 'sgb-unimadeira' },
        );
        const { passwordHash, ...perfil } = usuario;
        return { token, usuario: perfil };
    }

    obtenerPerfil(id) {
        return authRepository.buscarPorId(id);
    }
}

module.exports = new AuthService();
