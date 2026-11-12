const { all, run } = require('./transaction');

class RecursoRepository {
    obtenerTodos() {
        return all(
            `SELECT id, titulo, autor, coleccion, ejemplares, ejemplares_totales AS "ejemplaresTotales",
                estado, isbn, resumen, fecha_publicacion AS "fechaPublicacion",
                dimensiones, encuadernacion, issn, periodicidad, formato,
                tipo_equipo AS "tipoEquipo", numero_equipo AS "numeroEquipo",
                marca, modelo, cargador, funda
             FROM recursos ORDER BY id DESC`,
        );
    }

    async crear(recurso) {
        const result = await run(
            `INSERT INTO recursos (
                titulo, autor, coleccion, ejemplares, estado, disponible,
                ejemplares_totales, isbn, resumen, fecha_publicacion, dimensiones,
                encuadernacion, issn, periodicidad, formato, tipo_equipo,
                numero_equipo, marca, modelo, cargador, funda
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             RETURNING id`,
            [
                recurso.titulo,
                recurso.autor || null,
                recurso.coleccion,
                recurso.ejemplares,
                recurso.estado,
                recurso.estado === 'Disponible',
                recurso.ejemplares,
                recurso.isbn || null,
                recurso.resumen || null,
                recurso.fechaPublicacion || null,
                recurso.dimensiones || null,
                recurso.encuadernacion || null,
                recurso.issn || null,
                recurso.periodicidad || null,
                recurso.formato || null,
                recurso.tipoEquipo || null,
                recurso.numeroEquipo || null,
                recurso.marca || null,
                recurso.modelo || null,
                Boolean(recurso.cargador),
                Boolean(recurso.funda),
            ],
        );
        return { id: result.rows[0].id, ...recurso, ejemplaresTotales: recurso.ejemplares };
    }

    async actualizarEstado(id, estado) {
        const result = await run(
            `UPDATE recursos SET estado = ?, disponible = ?
             WHERE id = ?
             RETURNING id, titulo, autor, coleccion, ejemplares,
                ejemplares_totales AS "ejemplaresTotales", estado`,
            [estado, estado === 'Disponible', id],
        );
        return result.rows[0] ?? null;
    }
}

module.exports = new RecursoRepository();
