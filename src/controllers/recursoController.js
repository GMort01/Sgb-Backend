const recursoService = require('../services/recursoService');

const coleccionesValidas = new Set([
    'General',
    'Reserva',
    'Referencia',
    'Hemeroteca',
    'Mapoteca',
    'Tecnoteca',
]);
const estadosValidos = new Set([
    'Disponible',
    'Prestado',
    'Reservado',
    'Perdido',
    'Baja administrativa',
    'Baja',
]);
const formatosMapoteca = new Set(['jpg', 'pdf', 'shape', 'dwg']);
const tiposEquipo = new Set(['Laptop', 'Tableta']);

function isText(value, maxLength) {
    return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength;
}

function isIsoDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isIsbn(value) {
    return typeof value === 'string'
        && /^(?:\d{9}[\dX]|\d{13})$/i.test(value.replace(/[\s-]/g, ''));
}

function isIssn(value) {
    return typeof value === 'string' && /^\d{4}-\d{3}[\dX]$/i.test(value.trim());
}

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
        const {
            titulo,
            autor,
            coleccion,
            ejemplares,
            estado = 'Disponible',
            isbn,
            resumen,
            fechaPublicacion,
            dimensiones,
            encuadernacion,
            issn,
            periodicidad,
            formato,
            tipoEquipo,
            numeroEquipo,
            marca,
            modelo,
            cargador,
            funda,
        } = req.body ?? {};
        const minimoEjemplares = coleccion === 'General' ? 5
            : coleccion === 'Reserva' ? 10
                : coleccion === 'Referencia' ? 3
                    : coleccion === 'Hemeroteca' ? 2
                        : coleccion === 'Tecnoteca' && tipoEquipo === 'Laptop' ? 3
                            : coleccion === 'Tecnoteca' && tipoEquipo === 'Tableta' ? 10
                                : 0;
        const ejemplaresValidos = coleccion === 'Mapoteca'
            ? ejemplares === undefined || ejemplares === null || ejemplares === 0
            : Number.isInteger(ejemplares) && ejemplares >= minimoEjemplares && ejemplares <= 999;
        const camposBibliograficosValidos = ['General', 'Reserva'].includes(coleccion)
            ? isIsbn(isbn) && isText(autor, 160)
                && isText(resumen, 2000)
                && isIsoDate(fechaPublicacion) && isText(dimensiones, 100) && isText(encuadernacion, 100)
            : true;
        const camposReferenciaValidos = coleccion !== 'Referencia'
            || isText(dimensiones, 100) && /pulgadas|inches|inch\b|["″]/i.test(dimensiones);
        const camposHemerotecaValidos = coleccion !== 'Hemeroteca'
            || isIssn(issn) && isText(periodicidad, 80);
        const camposMapotecaValidos = coleccion !== 'Mapoteca' || formatosMapoteca.has(formato);
        const camposTecnotecaValidos = coleccion !== 'Tecnoteca'
            || tiposEquipo.has(tipoEquipo) && isText(numeroEquipo, 40)
                && isText(marca, 80) && isText(modelo, 80)
                && typeof cargador === 'boolean' && typeof funda === 'boolean';

        if (
            !isText(titulo, 200)
            || (autor !== undefined && (typeof autor !== 'string' || autor.trim().length > 160))
            || !coleccionesValidas.has(coleccion)
            || !ejemplaresValidos
            || !estadosValidos.has(estado)
            || !camposBibliograficosValidos
            || !camposReferenciaValidos
            || !camposHemerotecaValidos
            || !camposMapotecaValidos
            || !camposTecnotecaValidos
        ) {
            return res.status(400).json({
                success: false,
                message: 'Los datos del recurso no son válidos para la colección seleccionada o no alcanzan su mínimo de ejemplares.',
            });
        }

        try {
            const recurso = await recursoService.crearRecurso({
                titulo: titulo.trim(),
                autor: autor?.trim() || undefined,
                coleccion,
                ejemplares: coleccion === 'Mapoteca' ? 0 : ejemplares,
                estado: estado === 'Baja' ? 'Baja administrativa' : estado,
                isbn: isbn?.trim(),
                resumen: resumen?.trim(),
                fechaPublicacion,
                dimensiones: dimensiones?.trim(),
                encuadernacion: encuadernacion?.trim(),
                issn: issn?.trim(),
                periodicidad: periodicidad?.trim(),
                formato,
                tipoEquipo,
                numeroEquipo: numeroEquipo?.trim(),
                marca: marca?.trim(),
                modelo: modelo?.trim(),
                cargador,
                funda,
            });
            return res.status(201).json({ success: true, data: recurso });
        } catch (error) {
            if (error.code === '23505') {
                return res.status(409).json({ success: false, message: 'El número de equipo ya está registrado.' });
            }
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async actualizarEstado(req, res) {
        const id = Number(req.params.id);
        const estadoSolicitado = req.body?.estado;
        if (!Number.isSafeInteger(id) || id < 1 || !estadosValidos.has(estadoSolicitado)) {
            return res.status(400).json({ success: false, message: 'El recurso o el estado no son válidos.' });
        }

        const estado = estadoSolicitado === 'Baja' ? 'Baja administrativa' : estadoSolicitado;
        try {
            const recurso = await recursoService.actualizarEstado(id, estado);
            if (!recurso) {
                return res.status(404).json({ success: false, message: 'No se encontró el recurso seleccionado.' });
            }
            return res.status(200).json({ success: true, data: recurso });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

module.exports = new RecursoController();