const authService = require('../services/authService');

class AuthController {
    async iniciarSesion(req, res) {
        const { correo, password } = req.body ?? {};
        if (
            typeof correo !== 'string'
            || !correo.trim()
            || typeof password !== 'string'
            || !password
        ) {
            return res.status(400).json({ success: false, message: 'Ingresa un correo y una contraseña válidos.' });
        }
        try {
            const sesion = await authService.iniciarSesion(correo.trim(), password);
            if (!sesion) {
                return res.status(401).json({ success: false, message: 'Correo o contraseña incorrectos.' });
            }
            return res.status(200).json({ success: true, data: sesion });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async perfil(req, res) {
        try {
            const usuario = await authService.obtenerPerfil(req.user.id);
            if (!usuario) {
                return res.status(401).json({ success: false, message: 'La cuenta de esta sesión ya no existe.' });
            }
            return res.status(200).json({ success: true, data: usuario });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

module.exports = new AuthController();
