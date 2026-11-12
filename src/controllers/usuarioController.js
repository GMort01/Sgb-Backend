const usuarioService = require('../services/usuarioService');

const rolesValidos = new Set(['Estudiante', 'Profesor', 'Bibliotecario']);
const correoValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class UsuarioController {
    async obtenerEstudiantes(req, res) {
        try {
            const usuarios = await usuarioService.obtenerTodos();
            const estudiantes = usuarios
                .filter((usuario) => usuario.rol === 'Estudiante')
                .map(({ id, codigo, nombres, apellidos, rol }) => ({ id, codigo, nombres, apellidos, rol }));
            return res.status(200).json({ success: true, data: estudiantes });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async obtenerTodos(req, res) {
        try {
            const usuarios = await usuarioService.obtenerTodos();
            return res.status(200).json({ success: true, data: usuarios });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async crear(req, res) {
        const { identificacion, codigo, nombres, apellidos, correo, rol, plan, semestre, password } = req.body ?? {};
        const camposTextoValidos = [identificacion, codigo, nombres, apellidos, correo]
            .every((valor) => typeof valor === 'string' && valor.trim().length > 0);
        if (
            !camposTextoValidos
            || identificacion.trim().length > 30
            || codigo.trim().length > 30
            || nombres.trim().length > 80
            || apellidos.trim().length > 80
            || correo.trim().length > 160
            || !correoValido.test(correo.trim())
            || !rolesValidos.has(rol)
            || typeof password !== 'string'
            || password.length < 8
            || password.length > 128
            || (rol === 'Estudiante' && (
                typeof plan !== 'string' || !plan.trim() || plan.trim().length > 120
                || !Number.isInteger(semestre) || semestre < 1 || semestre > 20
            ))
        ) {
            return res.status(400).json({ success: false, message: 'Los datos del usuario no son válidos. La contraseña debe tener al menos 8 caracteres.' });
        }

        try {
            const usuario = await usuarioService.crear({
                identificacion: identificacion.trim(),
                codigo: codigo.trim(),
                nombres: nombres.trim(),
                apellidos: apellidos.trim(),
                correo: correo.trim().toLowerCase(),
                rol,
                plan: rol === 'Estudiante' ? plan.trim() : null,
                semestre: rol === 'Estudiante' ? semestre : null,
                password,
            });
            return res.status(201).json({ success: true, data: usuario });
        } catch (error) {
            if (error.code === '23505') {
                return res.status(409).json({
                    success: false,
                    message: 'Ya existe un usuario con esa identificación, código o correo.',
                });
            }
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

module.exports = new UsuarioController();
