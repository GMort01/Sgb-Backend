const recursoService = require('../services/recursoService');

const coleccionesValidas = new Set([
    'General',
    'Reserva',
    'Referencia',
    'Hemeroteca',
    'Mapoteca',
    'Tecnoteca',
]);
const estadosValidos = new Set(['Disponible', 'Prestado', 'Reservado', 'Perdido', 'Baja']);

class RecursoController {
    async getRecursos(req, res) {
        try {
            const recursos = await recursoService.listarRecursos();
            res.status(200).json({ success: true, data: recursos });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    async crearRecurso(req, res) {
        const { titulo, autor, coleccion, ejemplares = 1, estado = 'Disponible' } = req.body ?? {};
        if (
            typeof titulo !== 'string'
            || !titulo.trim()
            || titulo.trim().length > 200
            || (autor !== undefined && (typeof autor !== 'string' || autor.length > 160))
            || !coleccionesValidas.has(coleccion)
            || !Number.isInteger(ejemplares)
            || ejemplares < 1
            || ejemplares > 999
            || !estadosValidos.has(estado)
        ) {
            return res.status(400).json({ success: false, message: 'Los datos del recurso no son válidos.' });
        }

        try {
            const recurso = await recursoService.crearRecurso({
                titulo: titulo.trim(),
                autor: autor?.trim() || undefined,
                coleccion,
                ejemplares,
                estado,
            });
            return res.status(201).json({ success: true, data: recurso });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

module.exports = new RecursoController();