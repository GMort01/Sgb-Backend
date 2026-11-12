const multaService = require('../services/multaService');

function parseId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

class MultaController {
    async obtenerTodas(req, res) {
        try {
            const multas = await multaService.obtenerTodas(
                req.user.rol === 'Bibliotecario' ? undefined : req.user.id,
            );
            return res.status(200).json({ success: true, data: multas });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async crear(req, res) {
        const { usuarioId, concepto, monto, fecha } = req.body ?? {};
        const fechaMulta = fecha ?? new Date().toISOString().slice(0, 10);
        if (
            !Number.isSafeInteger(usuarioId)
            || usuarioId < 1
            || typeof concepto !== 'string'
            || !concepto.trim()
            || concepto.trim().length > 240
            || typeof monto !== 'number'
            || !Number.isSafeInteger(monto)
            || monto <= 0
            || monto > 100000000
            || typeof fechaMulta !== 'string'
            || !/^\d{4}-\d{2}-\d{2}$/.test(fechaMulta)
            || Number.isNaN(Date.parse(`${fechaMulta}T00:00:00Z`))
        ) {
            return res.status(400).json({ success: false, message: 'Los datos de la multa no son válidos.' });
        }

        try {
            const multa = await multaService.crear({
                usuarioId,
                concepto: concepto.trim(),
                monto,
                fecha: fechaMulta,
            });
            return res.status(201).json({ success: true, data: multa });
        } catch (error) {
            if (error.status === 404) {
                return res.status(404).json({ success: false, message: 'No se encontró el usuario seleccionado.' });
            }
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async marcarPagada(req, res) {
        const id = parseId(req.params.id);
        if (id === null) {
            return res.status(400).json({ success: false, message: 'El identificador de la multa no es válido.' });
        }

        try {
            const usuarioId = req.user.rol === 'Bibliotecario' ? undefined : req.user.id;
            const multa = await multaService.marcarPagada(id, usuarioId);
            if (!multa) {
                return res.status(409).json({
                    success: false,
                    message: 'La multa no existe, ya fue pagada o no pertenece a tu cuenta.',
                });
            }
            return res.status(200).json({
                success: true,
                data: multa,
                ...(usuarioId === undefined ? {} : { simulatedPayment: true }),
            });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

module.exports = new MultaController();
