const { all, get, transaction } = require('./transaction');
const multaRepository = require('./multaRepository');
const { tarifaDiariaMora } = require('../config/multas');

const estadosNoPrestables = new Set(['Perdido', 'Baja', 'Baja administrativa']);

function admiteReservas(recurso) {
    return recurso.coleccion === 'General'
        || (recurso.coleccion === 'Tecnoteca' && recurso.tipo_equipo === 'Tableta');
}

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
        diasRenovacion: dias,
        renovaciones,
        medioEntrega: coleccion === 'Mapoteca' ? 'USB - solo lectura' : 'Regular',
    };
}

async function usuarioBloqueado(query, usuarioId) {
    const multaPendiente = await query.get(
        "SELECT id FROM multas WHERE usuario_id = ? AND estado = 'Pendiente' LIMIT 1",
        [usuarioId],
    );
    if (multaPendiente) return 'USER_HAS_UNPAID_FINE';
    const prestamoVencido = await query.get(
        `SELECT id FROM prestamos
         WHERE usuario_id = ? AND estado IN ('Activo', 'Vencido')
            AND fecha_devolucion::TIMESTAMP < (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')
         LIMIT 1`,
        [usuarioId],
    );
    return prestamoVencido ? 'USER_HAS_OVERDUE_LOAN' : null;
}

async function sincronizarEstadoRecurso(query, recursoId) {
    const recurso = await query.get(
        `SELECT id, coleccion, tipo_equipo, ejemplares, estado
         FROM recursos WHERE id = ? FOR UPDATE`,
        [recursoId],
    );
    if (!recurso) return null;
    if (estadosNoPrestables.has(recurso.estado)) {
        await query.run('UPDATE recursos SET disponible = FALSE WHERE id = ?', [recursoId]);
        return recurso.estado;
    }

    const circulacion = await query.get(
        `SELECT
            EXISTS (SELECT 1 FROM reservas WHERE recurso_id = ? AND estado = 'Apartada') AS tiene_apartado,
            EXISTS (SELECT 1 FROM reservas WHERE recurso_id = ? AND estado = 'Espera') AS tiene_espera,
            EXISTS (
                SELECT 1 FROM prestamos
                WHERE recurso_id = ? AND estado IN ('Activo', 'Vencido')
            ) AS tiene_prestamo`,
        [recursoId, recursoId, recursoId],
    );

    let estado;
    if (recurso.coleccion === 'Mapoteca') {
        estado = circulacion.tiene_prestamo ? 'Prestado' : 'Disponible';
    } else if (recurso.ejemplares > 0) {
        estado = 'Disponible';
    } else if (circulacion.tiene_apartado) {
        estado = 'Reservado';
    } else if (circulacion.tiene_prestamo) {
        estado = 'Prestado';
    } else if (circulacion.tiene_espera) {
        estado = 'Reservado';
    } else {
        estado = recurso.estado;
    }

    await query.run(
        'UPDATE recursos SET estado = ?, disponible = ? WHERE id = ?',
        [estado, estado === 'Disponible', recursoId],
    );
    return estado;
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
        'SELECT id, coleccion, tipo_equipo, ejemplares, estado FROM recursos WHERE id = ? FOR UPDATE',
        [recursoId],
    );
    if (!recurso || !admiteReservas(recurso) || estadosNoPrestables.has(recurso.estado)) {
        await sincronizarEstadoRecurso(query, recursoId);
        return [];
    }

    const apartados = [];
    while (recurso.ejemplares > 0) {
        const siguiente = await query.get(
            `${reservaSelect}
             WHERE recurso_id = ? AND estado = 'Espera'
             ORDER BY posicion, fecha_reserva, id
             LIMIT 1 FOR UPDATE`,
            [recursoId],
        );
        if (!siguiente) break;

        if (await usuarioBloqueado(query, siguiente.usuarioId)) {
            await query.run('DELETE FROM reservas WHERE id = ?', [siguiente.id]);
            await compactarEspera(query, recursoId, siguiente.posicion);
            continue;
        }

        const descontado = await query.run(
            'UPDATE recursos SET ejemplares = ejemplares - 1 WHERE id = ? AND ejemplares > 0',
            [recursoId],
        );
        if (descontado.changes !== 1) break;
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
    await sincronizarEstadoRecurso(query, recursoId);
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
            await sincronizarEstadoRecurso(query, candidate.recursoId);
            expiradas += 1;
        }
        return expiradas;
    });
}

class PrestamoRepository {
    obtenerActivos(usuarioId) {
        return all(
            `${prestamoSelect} WHERE estado IN ('Activo', 'Vencido')
                AND (CAST(? AS INTEGER) IS NULL OR usuario_id = ?) ORDER BY fecha_devolucion`,
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

    marcarPrestamosVencidos() {
        return transaction(async (query) => {
            const result = await query.run(
                `UPDATE prestamos SET estado = 'Vencido'
                 WHERE estado = 'Activo'
                   AND fecha_devolucion::TIMESTAMP < (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')`,
            );
            return result.changes;
        });
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

            let resource = await query.get(
                'SELECT id, titulo, coleccion, tipo_equipo, ejemplares, estado FROM recursos WHERE id = ? FOR UPDATE',
                [recursoId],
            );
            if (!resource || estadosNoPrestables.has(resource.estado)) {
                throw Object.assign(new Error('RESOURCE_NOT_AVAILABLE'), { status: 404 });
            }
            const bloqueo = await usuarioBloqueado(query, usuarioId);
            if (bloqueo) {
                throw Object.assign(new Error(bloqueo), { status: 403 });
            }

            if (resource.ejemplares > 0 && admiteReservas(resource)) {
                await asignarApartadosEnEspera(query, recursoId);
                resource = await query.get(
                    'SELECT id, titulo, coleccion, tipo_equipo, ejemplares, estado FROM recursos WHERE id = ? FOR UPDATE',
                    [recursoId],
                );
            }

            const existingLoan = await query.get(
                `SELECT id FROM prestamos
                 WHERE usuario_id = ? AND recurso_id = ? AND estado IN ('Activo', 'Vencido')`,
                [usuarioId, recursoId],
            );
            if (existingLoan) {
                throw Object.assign(new Error('ALREADY_BORROWED'), { status: 409 });
            }
            const existingReservation = await query.get(
                `SELECT id, estado FROM reservas WHERE usuario_id = ? AND recurso_id = ?`,
                [usuarioId, recursoId],
            );
            const recogerApartado = admiteReservas(resource)
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
                        "SELECT id FROM prestamos WHERE recurso_id = ? AND estado IN ('Activo', 'Vencido')",
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
                await sincronizarEstadoRecurso(query, recursoId);
                if (recogerApartado) await asignarApartadosEnEspera(query, recursoId);
                return {
                    tipo: 'prestamo',
                    data: await query.get(`${prestamoSelect} WHERE id = ?`, [inserted.rows[0].id]),
                };
            }

            if (!admiteReservas(resource)) {
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
            await sincronizarEstadoRecurso(query, recursoId);
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
            let resource = await query.get(
                'SELECT id, coleccion, tipo_equipo, ejemplares, estado FROM recursos WHERE id = ? FOR UPDATE',
                [recursoId],
            );
            if (!resource || estadosNoPrestables.has(resource.estado)) {
                throw Object.assign(new Error('RESOURCE_NOT_AVAILABLE'), { status: 404 });
            }
            const bloqueo = await usuarioBloqueado(query, usuarioId);
            if (bloqueo) {
                throw Object.assign(new Error(bloqueo), { status: 403 });
            }
            if (!admiteReservas(resource)) {
                throw Object.assign(new Error('RESERVATION_NOT_ALLOWED'), { status: 409 });
            }

            if (resource.ejemplares > 0) {
                await asignarApartadosEnEspera(query, recursoId);
                resource = await query.get(
                    'SELECT id, coleccion, tipo_equipo, ejemplares, estado FROM recursos WHERE id = ? FOR UPDATE',
                    [recursoId],
                );
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
            await sincronizarEstadoRecurso(query, recursoId);
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
            await sincronizarEstadoRecurso(query, reservation.recursoId);
            return true;
        });
    }

    renovar(id, usuarioId) {
        return transaction(async (query) => {
            const candidate = await query.get(
                "SELECT recurso_id AS \"recursoId\" FROM prestamos "
                    + "WHERE id = ? AND estado = 'Activo'",
                [id],
            );
            if (!candidate) return null;
            await query.get('SELECT id FROM recursos WHERE id = ? FOR UPDATE', [candidate.recursoId]);
            const loan = await query.get(
                `SELECT prestamos.id, prestamos.recurso_id AS "recursoId",
                    prestamos.usuario_id AS "usuarioId",
                    prestamos.renovaciones_restantes AS "renovacionesRestantes",
                    recursos.coleccion, recursos.tipo_equipo
                 FROM prestamos JOIN recursos ON recursos.id = prestamos.recurso_id
                 WHERE prestamos.id = ? AND prestamos.estado = 'Activo'
                    AND (CAST(? AS INTEGER) IS NULL OR prestamos.usuario_id = ?)
                 FOR UPDATE OF prestamos`,
                [id, usuarioId ?? null, usuarioId ?? null],
            );
            if (!loan) return null;
            if (await usuarioBloqueado(query, loan.usuarioId)) return null;
            const reservation = await query.get(
                "SELECT id FROM reservas WHERE recurso_id = ? AND estado IN ('Espera', 'Apartada') LIMIT 1",
                [loan.recursoId],
            );
            const reglas = reglasPrestamo(loan);
            const renovacionesRestantes = Math.min(loan.renovacionesRestantes, reglas.renovaciones);
            if (reservation || renovacionesRestantes < 1 || reglas.diasRenovacion < 1) return null;
            await query.run(
                `UPDATE prestamos
                 SET fecha_devolucion = (fecha_devolucion::TIMESTAMP + INTERVAL '${reglas.diasRenovacion} days')::TEXT,
                     renovaciones_restantes = ? - 1
                 WHERE id = ?`,
                [renovacionesRestantes, id],
            );
            return query.get(`${prestamoSelect} WHERE id = ?`, [id]);
        });
    }

    devolver(id, bibliotecarioId) {
        return transaction(async (query) => {
            const candidate = await query.get(
                "SELECT recurso_id AS \"recursoId\" FROM prestamos "
                    + "WHERE id = ? AND estado IN ('Activo', 'Vencido')",
                [id],
            );
            if (!candidate) return null;
            await query.get('SELECT id FROM recursos WHERE id = ? FOR UPDATE', [candidate.recursoId]);
            const loan = await query.get(
                `${prestamoSelect} WHERE id = ? AND estado IN ('Activo', 'Vencido') FOR UPDATE`,
                [id],
            );
            if (!loan) return null;

            await multaRepository.generarMultasParaPrestamo(query, id, tarifaDiariaMora());
            await query.run("UPDATE prestamos SET estado = 'Devuelto' WHERE id = ?", [id]);
            let reservaPromovida = null;
            const resource = await query.get(
                'SELECT coleccion, tipo_equipo, estado FROM recursos WHERE id = ?',
                [loan.recursoId],
            );
            if (resource?.coleccion !== 'Mapoteca') {
                await query.run('UPDATE recursos SET ejemplares = ejemplares + 1 WHERE id = ?', [loan.recursoId]);
                if (admiteReservas(resource)) {
                    [reservaPromovida] = await asignarApartadosEnEspera(query, loan.recursoId);
                }
            }
            await sincronizarEstadoRecurso(query, loan.recursoId);

            return {
                prestamo: await query.get(`${prestamoSelect} WHERE id = ?`, [id]),
                promovido: null,
                reservaPromovida,
            };
        });
    }
}

module.exports = new PrestamoRepository();
