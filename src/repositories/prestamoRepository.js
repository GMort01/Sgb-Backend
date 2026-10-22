const db = require('../config/database');
const { all, get, run, transaction } = require('./transaction');

const prestamoSelect = `
    SELECT
        id,
        usuario,
        usuario_id AS usuarioId,
        codigo_recurso AS codigoRecurso,
        recurso_id AS recursoId,
        fecha_salida AS fechaSalida,
        fecha_devolucion AS fechaDevolucion,
        renovaciones_restantes AS renovacionesRestantes,
        estado
    FROM prestamos
`;

class PrestamoRepository {
    obtenerActivos() {
        return all(`${prestamoSelect} WHERE estado = 'Activo' ORDER BY fecha_devolucion`, []);
    }

    obtenerTodos() {
        return all(`${prestamoSelect} ORDER BY fecha_devolucion, id DESC`, []);
    }

    obtenerReservas() {
        return all(
            `SELECT
                id,
                usuario,
                usuario_id AS usuarioId,
                codigo_recurso AS codigoRecurso,
                recurso_id AS recursoId,
                fecha_reserva AS fechaReserva,
                posicion
             FROM reservas
             ORDER BY posicion, fecha_reserva`,
            [],
        );
    }

    solicitar(usuarioId, recursoId) {
        return transaction(async (query) => {
            const user = await query.get(
                "SELECT id, nombres, apellidos, rol FROM usuarios WHERE id = ?",
                [usuarioId],
            );
            if (!user || user.rol !== 'Estudiante') {
                throw Object.assign(new Error('USER_NOT_FOUND'), { status: 404 });
            }

            const resource = await query.get(
                'SELECT id, titulo, ejemplares, estado FROM recursos WHERE id = ?',
                [recursoId],
            );
            if (!resource || ['Perdido', 'Baja'].includes(resource.estado)) {
                throw Object.assign(new Error('RESOURCE_NOT_AVAILABLE'), { status: 404 });
            }

            const existingLoan = await query.get(
                `SELECT id FROM prestamos
                 WHERE usuario_id = ? AND recurso_id = ? AND estado = 'Activo'`,
                [usuarioId, recursoId],
            );
            if (existingLoan) {
                throw Object.assign(new Error('ALREADY_BORROWED'), { status: 409 });
            }

            const existingReservation = await query.get(
                'SELECT id FROM reservas WHERE usuario_id = ? AND recurso_id = ?',
                [usuarioId, recursoId],
            );
            if (existingReservation) {
                throw Object.assign(new Error('ALREADY_RESERVED'), { status: 409 });
            }

            const nombreUsuario = `${user.nombres} ${user.apellidos}`;
            const codigoRecurso = `REC-${resource.id}`;
            if (resource.ejemplares > 0) {
                const stock = await query.run(
                    'UPDATE recursos SET ejemplares = ejemplares - 1 WHERE id = ? AND ejemplares > 0',
                    [recursoId],
                );
                if (stock.changes !== 1) {
                    throw Object.assign(new Error('RESOURCE_JUST_BORROWED'), { status: 409 });
                }
                const inserted = await query.run(
                    `INSERT INTO prestamos
                        (usuario, usuario_id, codigo_recurso, recurso_id, fecha_salida, fecha_devolucion, renovaciones_restantes, estado)
                     VALUES (?, ?, ?, ?, date('now'), date('now', '+14 days'), 1, 'Activo')`,
                    [nombreUsuario, usuarioId, codigoRecurso, recursoId],
                );
                return { tipo: 'prestamo', data: await query.get(`${prestamoSelect} WHERE id = ?`, [inserted.lastID]) };
            }

            const row = await query.get(
                'SELECT COALESCE(MAX(posicion), 0) + 1 AS posicion FROM reservas WHERE recurso_id = ?',
                [recursoId],
            );
            const inserted = await query.run(
                `INSERT INTO reservas (usuario, usuario_id, codigo_recurso, recurso_id, fecha_reserva, posicion)
                 VALUES (?, ?, ?, ?, date('now'), ?)`,
                [nombreUsuario, usuarioId, codigoRecurso, recursoId, row.posicion],
            );
            return {
                tipo: 'reserva',
                data: await query.get(
                    `SELECT id, usuario, usuario_id AS usuarioId,
                        codigo_recurso AS codigoRecurso, recurso_id AS recursoId,
                        fecha_reserva AS fechaReserva, posicion
                     FROM reservas WHERE id = ?`,
                    [inserted.lastID],
                ),
            };
        });
    }

    cancelarReserva(id, usuarioId) {
        return transaction(async (query) => {
            const reserva = await query.get(
                'SELECT id, recurso_id AS recursoId, posicion FROM reservas WHERE id = ? AND usuario_id = ?',
                [id, usuarioId],
            );
            if (!reserva) return false;
            await query.run('DELETE FROM reservas WHERE id = ?', [id]);
            await query.run(
                'UPDATE reservas SET posicion = posicion - 1 WHERE recurso_id = ? AND posicion > ?',
                [reserva.recursoId, reserva.posicion],
            );
            return true;
        });
    }

    renovar(id) {
        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE prestamos
                 SET fecha_devolucion = date(fecha_devolucion, '+14 days'),
                     renovaciones_restantes = renovaciones_restantes - 1
                 WHERE id = ? AND estado = 'Activo' AND renovaciones_restantes > 0`,
                [id],
                function (error) {
                    if (error) return reject(error);
                    if (this.changes === 0) return resolve(null);
                    db.get(`${prestamoSelect} WHERE id = ?`, [id], (selectError, row) => {
                        if (selectError) reject(selectError);
                        else resolve(row);
                    });
                },
            );
        });
    }

    devolver(id) {
        return transaction(async (query) => {
            const loan = await query.get(`${prestamoSelect} WHERE id = ? AND estado = 'Activo'`, [id]);
            if (!loan) return null;

            await query.run("UPDATE prestamos SET estado = 'Devuelto' WHERE id = ?", [id]);
            const reservation = await query.get(
                `SELECT id, usuario, usuario_id AS usuarioId,
                    codigo_recurso AS codigoRecurso, recurso_id AS recursoId,
                    fecha_reserva AS fechaReserva, posicion
                 FROM reservas WHERE recurso_id = ? ORDER BY posicion, fecha_reserva, id LIMIT 1`,
                [loan.recursoId],
            );

            let promotedLoan = null;
            if (reservation) {
                const inserted = await query.run(
                    `INSERT INTO prestamos
                        (usuario, usuario_id, codigo_recurso, recurso_id, fecha_salida, fecha_devolucion, renovaciones_restantes, estado)
                     VALUES (?, ?, ?, ?, date('now'), date('now', '+14 days'), 1, 'Activo')`,
                    [reservation.usuario, reservation.usuarioId, reservation.codigoRecurso, reservation.recursoId],
                );
                await query.run('DELETE FROM reservas WHERE id = ?', [reservation.id]);
                await query.run(
                    'UPDATE reservas SET posicion = posicion - 1 WHERE recurso_id = ? AND posicion > ?',
                    [loan.recursoId, reservation.posicion],
                );
                promotedLoan = await query.get(`${prestamoSelect} WHERE id = ?`, [inserted.lastID]);
            } else {
                await query.run('UPDATE recursos SET ejemplares = ejemplares + 1 WHERE id = ?', [loan.recursoId]);
            }

            return {
                prestamo: await query.get(`${prestamoSelect} WHERE id = ?`, [id]),
                promovido: promotedLoan,
            };
        });
    }
}

module.exports = new PrestamoRepository();
