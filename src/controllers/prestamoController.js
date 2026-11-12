const prestamoService = require('../services/prestamoService');

function parseId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

class PrestamoController {
    async obtenerActivos(req, res) {
        try {
            const prestamos = await prestamoService.obtenerActivos(
                req.user.rol === 'Bibliotecario' ? undefined : req.user.id,
            );
            return res.status(200).json({ success: true, data: prestamos });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async obtenerTodos(req, res) {
        try {
            const prestamos = await prestamoService.obtenerTodos(
                req.user.rol === 'Bibliotecario' ? undefined : req.user.id,
            );
            return res.status(200).json({ success: true, data: prestamos });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async obtenerReservas(req, res) {
        try {
            const reservas = await prestamoService.obtenerReservas(
                req.user.rol === 'Bibliotecario' ? undefined : req.user.id,
            );
            return res.status(200).json({ success: true, data: reservas });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async cancelarReserva(req, res) {
        const id = parseId(req.params.id);
        const usuarioId = req.user.rol === 'Bibliotecario'
            ? Number(req.body?.usuarioId)
            : req.user.id;
        if (id === null || !Number.isSafeInteger(usuarioId) || usuarioId < 1) {
            return res.status(400).json({ success: false, message: 'La reserva o el usuario no son válidos.' });
        }
        try {
            const cancelada = await prestamoService.cancelarReserva(id, usuarioId);
            if (!cancelada) {
                return res.status(404).json({ success: false, message: 'No se encontró la reserva seleccionada.' });
            }
            return res.status(200).json({ success: true, data: { id } });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async solicitar(req, res) {
        const { usuarioId, recursoId } = req.body ?? {};
        if (!Number.isSafeInteger(usuarioId) || usuarioId < 1 || !Number.isSafeInteger(recursoId) || recursoId < 1) {
            return res.status(400).json({ success: false, message: 'Selecciona un usuario y un recurso válidos.' });
        }

        try {
            const resultado = await prestamoService.solicitar(usuarioId, recursoId, req.user.id);
            return res.status(201).json({ success: true, data: resultado });
        } catch (error) {
            if (error.status) {
                const messages = {
                    USER_NOT_FOUND: 'No se encontró el usuario estudiantil seleccionado.',
                    RESOURCE_NOT_AVAILABLE: 'Este recurso no está disponible para préstamo.',
                    ALREADY_BORROWED: 'Este usuario ya tiene un préstamo activo de este recurso.',
                    ALREADY_RESERVED: 'Este usuario ya está en la cola de espera para este recurso.',
                    RESOURCE_JUST_BORROWED: 'El último ejemplar acaba de ser solicitado. Inténtalo de nuevo.',
                    USER_HAS_UNPAID_FINE: 'El usuario tiene multas pendientes y no puede usar los servicios de circulación.',
                    RESERVATION_NOT_ALLOWED: 'Esta colección no admite reservas.',
                };
                return res.status(error.status).json({
                    success: false,
                    message: messages[error.message] || 'No se pudo completar la solicitud.',
                });
            }
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async reservar(req, res) {
        const { recursoId } = req.body ?? {};
        if (!Number.isSafeInteger(recursoId) || recursoId < 1) {
            return res.status(400).json({ success: false, message: 'Selecciona un recurso válido.' });
        }
        try {
            const reserva = await prestamoService.reservar(req.user.id, recursoId);
            return res.status(201).json({ success: true, data: { tipo: 'reserva', data: reserva } });
        } catch (error) {
            if (error.status) {
                const messages = {
                    USER_NOT_FOUND: 'No se encontró el usuario de la sesión.',
                    USER_HAS_UNPAID_FINE: 'Tienes multas pendientes y no puedes usar los servicios de circulación.',
                    RESOURCE_NOT_AVAILABLE: 'Este recurso no está disponible.',
                    RESOURCE_JUST_BORROWED: 'El último ejemplar acaba de ser apartado. Actualiza el catálogo e inténtalo de nuevo.',
                    RESERVATION_NOT_ALLOWED: 'Solo se pueden reservar recursos de Colección General o tabletas.',
                    RESOURCE_AVAILABLE: 'Todavía hay ejemplares disponibles para préstamo.',
                    ALREADY_RESERVED: 'Ya tienes un préstamo o reserva de este recurso.',
                };
                return res.status(error.status).json({ success: false, message: messages[error.message] || 'No se pudo reservar el recurso.' });
            }
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async devolver(req, res) {
        const id = parseId(req.params.id);
        if (id === null) {
            return res.status(400).json({ success: false, message: 'El identificador del préstamo no es válido.' });
        }

        try {
            const resultado = await prestamoService.devolver(id, req.user.id);
            if (!resultado) {
                return res.status(409).json({
                    success: false,
                    message: 'El préstamo no existe o ya fue devuelto.',
                });
            }
            return res.status(200).json({ success: true, data: resultado });
        } catch (error) {
            if (error.status === 404) {
                return res.status(404).json({ success: false, message: 'No se encontró un préstamo activo con ese identificador.' });
            }
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async renovar(req, res) {
        const id = parseId(req.params.id);
        if (id === null) {
            return res.status(400).json({ success: false, message: 'El identificador del préstamo no es válido.' });
        }

        try {
            const prestamo = await prestamoService.renovar(
                id,
                req.user.rol === 'Bibliotecario' ? undefined : req.user.id,
            );
            if (!prestamo) {
                return res.status(409).json({
                    success: false,
                    message: 'El préstamo no existe, ya fue devuelto o no tiene renovaciones disponibles.',
                });
            }
            return res.status(200).json({ success: true, data: prestamo });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

}

module.exports = new PrestamoController();
