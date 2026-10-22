const { all, get, run, transaction } = require('./transaction');

class ActividadRepository {
    obtenerTodas(usuarioId) {
        return all(
            `SELECT a.id, a.titulo, a.descripcion, a.fecha, a.hora, a.lugar, a.cupos,
                COUNT(i.id) AS inscritos,
                MAX(CASE WHEN i.usuario_id = ? THEN 1 ELSE 0 END) AS inscrito
             FROM actividades a
             LEFT JOIN inscripciones_actividades i ON i.actividad_id = a.id
             WHERE a.fecha >= date('now')
             GROUP BY a.id
             ORDER BY a.fecha, a.hora`,
            [usuarioId || 0],
        );
    }

    crear(actividad) {
        return run(
            `INSERT INTO actividades (titulo, descripcion, fecha, hora, lugar, cupos)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                actividad.titulo,
                actividad.descripcion,
                actividad.fecha,
                actividad.hora,
                actividad.lugar,
                actividad.cupos,
            ],
        ).then((result) => ({ id: result.lastID, ...actividad, inscritos: 0, inscrito: 0 }));
    }

    inscribir(actividadId, usuarioId) {
        return transaction(async (query) => {
            const actividad = await query.get(
                "SELECT id, cupos FROM actividades WHERE id = ? AND fecha >= date('now')",
                [actividadId],
            );
            if (!actividad) {
                throw Object.assign(new Error('ACTIVITY_NOT_FOUND'), { status: 404 });
            }

            const usuario = await query.get(
                "SELECT id FROM usuarios WHERE id = ? AND rol = 'Estudiante'",
                [usuarioId],
            );
            if (!usuario) {
                throw Object.assign(new Error('USER_NOT_FOUND'), { status: 404 });
            }

            const existing = await query.get(
                'SELECT id FROM inscripciones_actividades WHERE actividad_id = ? AND usuario_id = ?',
                [actividadId, usuarioId],
            );
            if (existing) {
                throw Object.assign(new Error('ALREADY_REGISTERED'), { status: 409 });
            }

            const { inscritos } = await query.get(
                'SELECT COUNT(*) AS inscritos FROM inscripciones_actividades WHERE actividad_id = ?',
                [actividadId],
            );
            if (inscritos >= actividad.cupos) {
                throw Object.assign(new Error('ACTIVITY_FULL'), { status: 409 });
            }

            await query.run(
                'INSERT INTO inscripciones_actividades (actividad_id, usuario_id) VALUES (?, ?)',
                [actividadId, usuarioId],
            );
            return { actividadId, usuarioId };
        });
    }
}

module.exports = new ActividadRepository();
