const { all, run, transaction } = require('./transaction');

class MultaRepository {
    obtenerTodas(usuarioId) {
        return all(
            `SELECT id, usuario, concepto, monto::DOUBLE PRECISION AS monto, fecha, estado
             FROM multas WHERE (CAST(? AS INTEGER) IS NULL OR usuario_id = ?)
             ORDER BY CASE estado WHEN 'Pendiente' THEN 0 ELSE 1 END, fecha DESC, id DESC`,
            [usuarioId ?? null, usuarioId ?? null],
        );
    }

    crear(multa) {
        return transaction(async (query) => {
            const usuario = await query.get(
                "SELECT nombres, apellidos FROM usuarios WHERE id = ? AND rol IN ('Estudiante', 'Profesor')",
                [multa.usuarioId],
            );
            if (!usuario) throw Object.assign(new Error('USER_NOT_FOUND'), { status: 404 });
            const nombre = `${usuario.nombres} ${usuario.apellidos}`;
            const inserted = await query.run(
                `INSERT INTO multas (usuario, usuario_id, concepto, monto, fecha, estado)
                 VALUES (?, ?, ?, ?, ?, 'Pendiente')
                 RETURNING id`,
                [nombre, multa.usuarioId, multa.concepto, multa.monto, multa.fecha],
            );
            return { id: inserted.rows[0].id, usuario: nombre, ...multa, estado: 'Pendiente' };
        });
    }

    marcarPagada(id, usuarioId) {
        return transaction(async (query) => {
            const updated = await query.run(
                `UPDATE multas SET estado = 'Pagada'
                 WHERE id = ? AND estado = 'Pendiente'
                   AND (CAST(? AS INTEGER) IS NULL OR usuario_id = ?)
                 RETURNING id, usuario, concepto, monto::DOUBLE PRECISION AS monto, fecha, estado`,
                [id, usuarioId ?? null, usuarioId ?? null],
            );
            if (updated.changes === 0) return null;
            return updated.rows[0];
        });
    }
}

module.exports = new MultaRepository();
