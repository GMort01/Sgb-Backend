const { all, get, transaction } = require('./transaction');

const reservaSelect = `
    SELECT
        id,
        usuario,
        usuario_id AS "usuarioId",
        codigo_recurso AS "codigoRecurso",
        recurso_id AS "recursoId",
        fecha_reserva AS "fechaReserva",
        posicion,
        estado,
        vence_en AS "venceEn"
    FROM reservas
`;

const prestamoSelect = `
    SELECT
        id,
        usuario,
        usuario_id AS "usuarioId",
        codigo_recurso AS "codigoRecurso",
        recurso_id AS "recursoId",
        fecha_salida AS "fechaSalida",
        fecha_devolucion AS "fechaDevolucion",
        renovaciones_restantes AS "renovacionesRestantes",
        medio_entrega AS "medioEntrega",
        bibliotecario_id AS "bibliotecarioId",
        estado
    FROM prestamos
`;

function reglasPrestamo(recurso) {
    const coleccion = recurso.coleccion;
    const dias = coleccion === 'General' ? 15
        : coleccion === 'Reserva' ? 5
            : coleccion === 'Referencia' ? 3
                : coleccion === 'Hemeroteca' || coleccion === 'Mapoteca' ? 1
                    : 7;
    const fechaDevolucion = coleccion === 'Mapoteca'
        ? "(((CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::DATE + 1) + TIME '21:00')::TEXT"
        : `((CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota') + INTERVAL '${dias} days')::TEXT`;
    const renovaciones = coleccion === 'General' ? 5
        : coleccion === 'Referencia' ? 2
            : coleccion === 'Hemeroteca' ? 1
                : coleccion === 'Tecnoteca' ? 2 : 0;
    return {
        fechaDevolucion,
        renovaciones,
        medioEntrega: coleccion === 'Mapoteca' ? 'USB - solo lectura' : 'Regular',
    };
}

async function compactarEspera(query, recursoId, posicion) {
    await query.run(
        `UPDATE reservas SET posicion = posicion - 1
         WHERE recurso_id = ? AND estado = 'Espera' AND posicion > ?`,
        [recursoId, posicion],
    );
}

async function asignarApartadosEnEspera(query, recursoId) {
    const recurso = await query.get(
        'SELECT id, ejemplares FROM recursos WHERE id = ? FOR UPDATE',
        [recursoId],
    );
    if (!recurso) return [];

    const apartados = [];
    while (recurso.ejemplares > 0) {
        const siguiente = await query.get(
            `${reservaSelect}
             WHERE recurso_id = ? AND estado = 'Espera'
             ORDER BY posicion, fecha_reserva, id
             LIMIT 1 FOR UPDATE`,
            [recursoId],
        );
        if (!siguiente) return apartados;

        const multaPendiente = await query.get(
            "SELECT id FROM multas WHERE usuario_id = ? AND estado = 'Pendiente' LIMIT 1",
            [siguiente.usuarioId],
        );
        if (multaPendiente) {
            await query.run('DELETE FROM reservas WHERE id = ?', [siguiente.id]);
            await compactarEspera(query, recursoId, siguiente.posicion);
            continue;
        }

        const descontado = await query.run(
            'UPDATE recursos SET ejemplares = ejemplares - 1 WHERE id = ? AND ejemplares > 0',
            [recursoId],
        );
        if (descontado.changes !== 1) return apartados;
        await query.run(
            `UPDATE reservas SET estado = 'Apartada', posicion = 0,
                vence_en = CURRENT_TIMESTAMP + INTERVAL '48 hours'
             WHERE id = ?`,
            [siguiente.id],
        );
        apartados.push(await query.get(`${reservaSelect} WHERE id = ?`, [siguiente.id]));
        await compactarEspera(query, recursoId, siguiente.posicion);
        recurso.ejemplares -= 1;
    }
    return apartados;
}

async function expirarApartadosVencidos() {
    return transaction(async (query) => {
        const vencidas = await query.all(
            `SELECT id, recurso_id AS "recursoId"
             FROM reservas
             WHERE estado = 'Apartada' AND vence_en <= CURRENT_TIMESTAMP
             ORDER BY vence_en, id`,
        );
        let expiradas = 0;
        for (const candidate of vencidas) {
            await query.get('SELECT id FROM recursos WHERE id = ? FOR UPDATE', [candidate.recursoId]);
            const reserva = await query.get(
                `SELECT id FROM reservas
                 WHERE id = ? AND estado = 'Apartada' AND vence_en <= CURRENT_TIMESTAMP
                 FOR UPDATE`,
                [candidate.id],
            );
            if (!reserva) continue;

            await query.run('DELETE FROM reservas WHERE id = ?', [reserva.id]);
            await query.run('UPDATE recursos SET ejemplares = ejemplares + 1 WHERE id = ?', [candidate.recursoId]);
            await asignarApartadosEnEspera(query, candidate.recursoId);
            expiradas += 1;
        }
        return expiradas;
    });
}

class PrestamoRepository {
    obtenerActivos(usuarioId) {
        return all(
            `${prestamoSelect} WHERE estado = 'Activo' AND (CAST(? AS INTEGER) IS NULL OR usuario_id = ?) ORDER BY fecha_devolucion`,
            [usuarioId ?? null, usuarioId ?? null],
        );
    }

    obtenerTodos(usuarioId) {
        return all(
            `${prestamoSelect} WHERE (CAST(? AS INTEGER) IS NULL OR usuario_id = ?) ORDER BY fecha_devolucion, id DESC`,
            [usuarioId ?? null, usuarioId ?? null],
        );
    }

    obtenerReservas(usuarioId) {
        return all(
            `SELECT
                id,
                usuario,
                usuario_id AS "usuarioId",
                codigo_recurso AS "codigoRecurso",
                recurso_id AS "recursoId",
                fecha_reserva AS "fechaReserva",
                posicion,
                estado,
                vence_en AS "venceEn"
             FROM reservas
             WHERE (CAST(? AS INTEGER) IS NULL OR usuario_id = ?)
             ORDER BY recurso_id, CASE WHEN estado = 'Apartada' THEN 0 ELSE 1 END,
                posicion, fecha_reserva, id`,
            [usuarioId ?? null, usuarioId ?? null],
        );
    }

    expirarApartadosVencidos() {
        return expirarApartadosVencidos();
    }

    solicitar(usuarioId, recursoId, bibliotecarioId) {
        return transaction(async (query) => {
            const user = await query.get(
                'SELECT id, nombres, apellidos, rol FROM usuarios WHERE id = ? FOR UPDATE',
                [usuarioId],
            );
            if (!user || !['Estudiante', 'Profesor'].includes(user.rol)) {
                throw Object.assign(new Error('USER_NOT_FOUND'), { status: 404 });
            }

            const resource = await query.get(
                'SELECT id, titulo, coleccion, tipo_equipo, ejemplares, estado FROM recursos WHERE id = ? FOR UPDATE',
                [recursoId],
            );
            if (!resource || ['Perdido', 'Baja'].includes(resource.estado)) {
                throw Object.assign(new Error('RESOURCE_NOT_AVAILABLE'), { status: 404 });
            }
            const unpaidFine = await query.get(
                "SELECT id FROM multas WHERE usuario_id = ? AND estado = 'Pendiente' LIMIT 1",
                [usuarioId],
            );
            if (unpaidFine) {
                throw Object.assign(new Error('USER_HAS_UNPAID_FINE'), { status: 403 });
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
                `SELECT id, estado FROM reservas WHERE usuario_id = ? AND recurso_id = ?`,
                [usuarioId, recursoId],
            );
            const recogerApartado = resource.coleccion === 'General'
                && existingReservation?.estado === 'Apartada';
            if (existingReservation && !recogerApartado) {
                throw Object.assign(new Error('ALREADY_RESERVED'), { status: 409 });
            }

            const nombreUsuario = `${user.nombres} ${user.apellidos}`;
            const codigoRecurso = `REC-${resource.id}`;
            const mapoteca = resource.coleccion === 'Mapoteca';
            const reglas = reglasPrestamo(resource);
            if (mapoteca || resource.ejemplares > 0 || recogerApartado) {
                if (mapoteca) {
                    const activeMapLoan = await query.get(
                        "SELECT id FROM prestamos WHERE recurso_id = ? AND estado = 'Activo'",
                        [recursoId],
                    );
                    if (activeMapLoan) {
                        throw Object.assign(new Error('RESOURCE_NOT_AVAILABLE'), { status: 409 });
                    }
                } else if (!recogerApartado) {
                    const stock = await query.run(
                        'UPDATE recursos SET ejemplares = ejemplares - 1 WHERE id = ? AND ejemplares > 0',
                        [recursoId],
                    );
                    if (stock.changes !== 1) {
                        throw Object.assign(new Error('RESOURCE_JUST_BORROWED'), { status: 409 });
                    }
                }
                const inserted = await query.run(
                    `INSERT INTO prestamos
                        (usuario, usuario_id, codigo_recurso, recurso_id, fecha_salida, fecha_devolucion,
                            renovaciones_restantes, estado, medio_entrega, bibliotecario_id)
                     VALUES (?, ?, ?, ?, (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::TEXT, ${reglas.fechaDevolucion}, ?, 'Activo', ?, ?)
                     RETURNING id`,
                    [
                        nombreUsuario,
                        usuarioId,
                        codigoRecurso,
                        recursoId,
                        reglas.renovaciones,
                        reglas.medioEntrega,
                        bibliotecarioId,
                    ],
                );
                if (recogerApartado) {
                    await query.run('DELETE FROM reservas WHERE id = ?', [existingReservation.id]);
                }
                return {
                    tipo: 'prestamo',
                    data: await query.get(`${prestamoSelect} WHERE id = ?`, [inserted.rows[0].id]),
                };
            }

            if (!(resource.coleccion === 'General'
                || (resource.coleccion === 'Tecnoteca' && resource.tipo_equipo === 'Tableta'))) {
                throw Object.assign(new Error('RESERVATION_NOT_ALLOWED'), { status: 409 });
            }

            const row = await query.get(
                `SELECT COALESCE(MAX(posicion), 0) + 1 AS posicion
                 FROM reservas WHERE recurso_id = ? AND estado = 'Espera'`,
                [recursoId],
            );
            const inserted = await query.run(
                `INSERT INTO reservas (usuario, usuario_id, codigo_recurso, recurso_id, fecha_reserva, posicion, estado)
                 VALUES (?, ?, ?, ?, (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::DATE::TEXT, ?, 'Espera')
                 RETURNING id`,
                [nombreUsuario, usuarioId, codigoRecurso, recursoId, row.posicion],
            );
            return {
                tipo: 'reserva',
                data: await query.get(
                    `SELECT id, usuario, usuario_id AS "usuarioId",
                        codigo_recurso AS "codigoRecurso", recurso_id AS "recursoId",
                        fecha_reserva AS "fechaReserva", posicion, estado,
                        vence_en AS "venceEn"
                     FROM reservas WHERE id = ?`,
                    [inserted.rows[0].id],
                ),
            };
        });
    }

    reservar(usuarioId, recursoId) {
        return transaction(async (query) => {
            const user = await query.get(
                "SELECT id, nombres, apellidos, rol FROM usuarios WHERE id = ? AND rol IN ('Estudiante', 'Profesor') FOR UPDATE",
                [usuarioId],
            );
            if (!user) throw Object.assign(new Error('USER_NOT_FOUND'), { status: 404 });
            const resource = await query.get(
                'SELECT id, coleccion, tipo_equipo, ejemplares, estado FROM recursos WHERE id = ? FOR UPDATE',
                [recursoId],
            );
            if (!resource || ['Perdido', 'Baja'].includes(resource.estado)) {
                throw Object.assign(new Error('RESOURCE_NOT_AVAILABLE'), { status: 404 });
            }
            const unpaidFine = await query.get(
                "SELECT id FROM multas WHERE usuario_id = ? AND estado = 'Pendiente' LIMIT 1",
                [usuarioId],
            );
            if (unpaidFine) throw Object.assign(new Error('USER_HAS_UNPAID_FINE'), { status: 403 });
            if (!(resource.coleccion === 'General'
                || (resource.coleccion === 'Tecnoteca' && resource.tipo_equipo === 'Tableta'))) {
                throw Object.assign(new Error('RESERVATION_NOT_ALLOWED'), { status: 409 });
            }
            const apartadoGeneral = resource.coleccion === 'General' && resource.ejemplares > 0;
            if (resource.ejemplares > 0 && !apartadoGeneral) {
                throw Object.assign(new Error('RESOURCE_AVAILABLE'), { status: 409 });
            }
            const existing = await query.get(
                `SELECT id FROM prestamos WHERE usuario_id = ? AND recurso_id = ? AND estado = 'Activo'
                 UNION ALL
                 SELECT id FROM reservas WHERE usuario_id = ? AND recurso_id = ? LIMIT 1`,
                [usuarioId, recursoId, usuarioId, recursoId],
            );
            if (existing) throw Object.assign(new Error('ALREADY_RESERVED'), { status: 409 });

            const { posicion } = await query.get(
                `SELECT COALESCE(MAX(posicion), 0) + 1 AS posicion
                 FROM reservas WHERE recurso_id = ? AND estado = 'Espera'`,
                [recursoId],
            );
            const inserted = await query.run(
                `INSERT INTO reservas
                    (usuario, usuario_id, codigo_recurso, recurso_id, fecha_reserva, posicion, estado, vence_en)
                 VALUES (?, ?, ?, ?, (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::DATE::TEXT, ?,
                    ?, CASE WHEN ? THEN CURRENT_TIMESTAMP + INTERVAL '48 hours' ELSE NULL END)
                 RETURNING id`,
                [
                    `${user.nombres} ${user.apellidos}`,
                    usuarioId,
                    `REC-${resource.id}`,
                    resource.id,
                    apartadoGeneral ? 0 : posicion,
                    apartadoGeneral ? 'Apartada' : 'Espera',
                    apartadoGeneral,
                ],
            );
            if (apartadoGeneral) {
                const descontado = await query.run(
                    'UPDATE recursos SET ejemplares = ejemplares - 1 WHERE id = ? AND ejemplares > 0',
                    [recursoId],
                );
                if (descontado.changes !== 1) {
                    throw Object.assign(new Error('RESOURCE_JUST_BORROWED'), { status: 409 });
                }
            }
            return query.get(
                `${reservaSelect} WHERE id = ?`,
                [inserted.rows[0].id],
            );
        });
    }

    cancelarReserva(id, usuarioId) {
        return transaction(async (query) => {
            const candidate = await query.get(
                'SELECT recurso_id AS "recursoId" FROM reservas WHERE id = ? AND usuario_id = ?',
                [id, usuarioId],
            );
            if (!candidate) return false;
            await query.get('SELECT id FROM recursos WHERE id = ? FOR UPDATE', [candidate.recursoId]);
            const reservation = await query.get(
                `SELECT id, recurso_id AS "recursoId", posicion, estado
                 FROM reservas WHERE id = ? AND usuario_id = ? FOR UPDATE`,
                [id, usuarioId],
            );
            if (!reservation) return false;
            await query.run('DELETE FROM reservas WHERE id = ?', [id]);
            if (reservation.estado === 'Apartada') {
                await query.run('UPDATE recursos SET ejemplares = ejemplares + 1 WHERE id = ?', [reservation.recursoId]);
            } else {
                await compactarEspera(query, reservation.recursoId, reservation.posicion);
            }
            await asignarApartadosEnEspera(query, reservation.recursoId);
            return true;
        });
    }

    renovar(id, usuarioId) {
        return transaction(async (query) => {
            const candidate = await query.get(
                'SELECT recurso_id AS "recursoId" FROM prestamos WHERE id = ? AND estado = \'Activo\'',
                [id],
            );
            if (!candidate) return null;
            await query.get('SELECT id FROM recursos WHERE id = ? FOR UPDATE', [candidate.recursoId]);
            const loan = await query.get(
                `SELECT prestamos.id, prestamos.recurso_id AS "recursoId",
                    prestamos.renovaciones_restantes AS "renovacionesRestantes",
                    recursos.coleccion, recursos.tipo_equipo
                 FROM prestamos JOIN recursos ON recursos.id = prestamos.recurso_id
                 WHERE prestamos.id = ? AND prestamos.estado = 'Activo'
                    AND (CAST(? AS INTEGER) IS NULL OR prestamos.usuario_id = ?)
                 FOR UPDATE OF prestamos`,
                [id, usuarioId ?? null, usuarioId ?? null],
            );
            if (!loan) return null;
            const reservation = await query.get(
                'SELECT id FROM reservas WHERE recurso_id = ? LIMIT 1',
                [loan.recursoId],
            );
            if (reservation || loan.renovacionesRestantes < 1) return null;
            const days = loan.coleccion === 'General' ? 15
                : loan.coleccion === 'Referencia' ? 3
                    : loan.coleccion === 'Hemeroteca' ? 1
                        : loan.coleccion === 'Tecnoteca' ? 7 : 0;
            if (!days) return null;
            await query.run(
                `UPDATE prestamos
                 SET fecha_devolucion = (fecha_devolucion::TIMESTAMP + INTERVAL '${days} days')::TEXT,
                     renovaciones_restantes = renovaciones_restantes - 1
                 WHERE id = ?`,
                [id],
            );
            return query.get(`${prestamoSelect} WHERE id = ?`, [id]);
        });
    }

    devolver(id, bibliotecarioId) {
        return transaction(async (query) => {
            const candidate = await query.get(
                'SELECT recurso_id AS "recursoId" FROM prestamos WHERE id = ? AND estado = \'Activo\'',
                [id],
            );
            if (!candidate) return null;
            await query.get('SELECT id FROM recursos WHERE id = ? FOR UPDATE', [candidate.recursoId]);
            const loan = await query.get(`${prestamoSelect} WHERE id = ? AND estado = 'Activo' FOR UPDATE`, [id]);
            if (!loan) return null;

            await query.run("UPDATE prestamos SET estado = 'Devuelto' WHERE id = ?", [id]);
            const reservation = await query.get(
                `${reservaSelect}
                 WHERE recurso_id = ? AND estado = 'Espera' ORDER BY posicion, fecha_reserva, id
                 LIMIT 1 FOR UPDATE`,
                [loan.recursoId],
            );

            let promotedLoan = null;
            let reservaPromovida = null;
            const resource = await query.get(
                'SELECT coleccion, tipo_equipo FROM recursos WHERE id = ?',
                [loan.recursoId],
            );
            const reservationUserHasFine = reservation
                ? await query.get(
                    "SELECT id FROM multas WHERE usuario_id = ? AND estado = 'Pendiente' LIMIT 1",
                    [reservation.usuarioId],
                )
                : null;
            if (resource?.coleccion === 'General') {
                await query.run('UPDATE recursos SET ejemplares = ejemplares + 1 WHERE id = ?', [loan.recursoId]);
                [reservaPromovida] = await asignarApartadosEnEspera(query, loan.recursoId);
            } else if (reservation && !reservationUserHasFine) {
                const reglas = reglasPrestamo(resource);
                const inserted = await query.run(
                    `INSERT INTO prestamos
                        (usuario, usuario_id, codigo_recurso, recurso_id, fecha_salida, fecha_devolucion,
                            renovaciones_restantes, estado, medio_entrega, bibliotecario_id)
                     VALUES (?, ?, ?, ?, (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::TEXT, ${reglas.fechaDevolucion}, ?, 'Activo', ?, ?)
                     RETURNING id`,
                    [
                        reservation.usuario,
                        reservation.usuarioId,
                        reservation.codigoRecurso,
                        reservation.recursoId,
                        reglas.renovaciones,
                        reglas.medioEntrega,
                        bibliotecarioId,
                    ],
                );
                await query.run('DELETE FROM reservas WHERE id = ?', [reservation.id]);
                await compactarEspera(query, loan.recursoId, reservation.posicion);
                promotedLoan = await query.get(`${prestamoSelect} WHERE id = ?`, [inserted.rows[0].id]);
            } else if (resource?.coleccion !== 'Mapoteca') {
                await query.run('UPDATE recursos SET ejemplares = ejemplares + 1 WHERE id = ?', [loan.recursoId]);
            }

            return {
                prestamo: await query.get(`${prestamoSelect} WHERE id = ?`, [id]),
                promovido: promotedLoan,
                reservaPromovida,
            };
        });
    }
}

module.exports = new PrestamoRepository();
