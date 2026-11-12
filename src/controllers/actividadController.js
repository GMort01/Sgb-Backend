const actividadService = require('../services/actividadService');

class ActividadController {
    async obtenerTodas(req, res) {
        const usuarioId = req.user.rol === 'Bibliotecario'
            ? (req.query.usuarioId === undefined ? 0 : Number(req.query.usuarioId))
            : req.user.id;
        if (!Number.isSafeInteger(usuarioId) || usuarioId < 0) {
            return res.status(400).json({ success: false, message: 'El identificador de usuario no es válido.' });
        }
        try {
            const actividades = await actividadService.obtenerTodas(usuarioId);
            return res.status(200).json({ success: true, data: actividades });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async crear(req, res) {
        const { titulo, descripcion, fecha, hora, lugar, cupos = 20 } = req.body ?? {};
        if (
            typeof titulo !== 'string' || !titulo.trim() || titulo.trim().length > 120
            || typeof descripcion !== 'string' || !descripcion.trim() || descripcion.trim().length > 500
            || typeof lugar !== 'string' || !lugar.trim() || lugar.trim().length > 120
            || typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)
            || Number.isNaN(Date.parse(`${fecha}T00:00:00Z`))
            || typeof hora !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)
            || !Number.isInteger(cupos) || cupos < 1 || cupos > 500
        ) {
            return res.status(400).json({ success: false, message: 'Los datos de la actividad no son válidos.' });
        }

        try {
            const actividad = await actividadService.crear({
                titulo: titulo.trim(),
                descripcion: descripcion.trim(),
                fecha,
                hora,
                lugar: lugar.trim(),
                cupos,
            });
            return res.status(201).json({ success: true, data: actividad });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async inscribir(req, res) {
        const actividadId = Number(req.params.id);
        const usuarioId = req.user.id;
        if (
            !Number.isSafeInteger(actividadId)
            || actividadId < 1
            || !Number.isSafeInteger(usuarioId)
            || usuarioId < 1
        ) {
            return res.status(400).json({ success: false, message: 'Selecciona una actividad y usuario válidos.' });
        }
        try {
            const resultado = await actividadService.inscribir(actividadId, usuarioId);
            return res.status(201).json({ success: true, data: resultado });
        } catch (error) {
            if (error.status) {
                const messages = {
                    ACTIVITY_NOT_FOUND: 'La actividad ya no está disponible.',
                    USER_NOT_FOUND: 'No se encontró el usuario estudiantil.',
                    ACTIVITY_FULL: 'La actividad ya no tiene cupos disponibles.',
                    ALREADY_REGISTERED: 'Este estudiante ya está inscrito en la actividad.',
                };
                return res.status(error.status).json({ success: false, message: messages[error.message] || error.message });
            }
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

module.exports = new ActividadController();
