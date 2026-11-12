const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
require('dotenv').config();
const { test } = require('node:test');

async function request(base, route, { token, ...options } = {}) {
    const headers = { ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const body = options.body && typeof options.body !== 'string'
        ? JSON.stringify(options.body)
        : options.body;
    const response = await fetch(`${base}${route}`, { ...options, headers, body });
    return { status: response.status, body: await response.json() };
}

function assertCreated(response, label) {
    assert.equal(response.status, 201, `${label}: ${JSON.stringify(response.body)}`);
    return response.body.data;
}

test('Sprint 2 acceptance criteria: circulation states, renewal guards, fines, jobs and FIFO', {
    skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to an isolated Supabase test database.',
}, async (t) => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.PORT = '0';
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-with-more-than-32-characters';
    process.env.OVERDUE_FINE_DAILY_RATE = '2000';
    const password = 'ClaveSprint2!234';
    const demoPassword = process.env.TEST_DEMO_USER_PASSWORD || 'Demo123!';
    process.env.DEMO_USER_PASSWORD = demoPassword;

    const app = require('../src/app');
    const db = require('../src/config/database');
    const prestamoService = require('../src/services/prestamoService');
    const multaService = require('../src/services/multaService');
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    let databaseReady = false;

    t.after(async () => {
        for (const timer of [
            app.locals.reservationExpiryTimer,
            app.locals.overdueLoanTimer,
            app.locals.overdueFineTimer,
        ]) {
            if (timer) clearInterval(timer);
        }
        if (app.locals.server?.listening) {
            await new Promise((resolve) => app.locals.server.close(resolve));
        }
        if (databaseReady) {
            const userPattern = `S2-${suffix}-%`;
            const resourcePattern = `S2 ${suffix} %`;
            await db.query(
                `DELETE FROM public.multas
                 WHERE usuario_id IN (
                    SELECT id FROM public.usuarios WHERE identificacion LIKE $1
                 ) OR prestamo_id IN (
                    SELECT id FROM public.prestamos WHERE usuario_id IN (
                        SELECT id FROM public.usuarios WHERE identificacion LIKE $1
                    )
                 )`,
                [userPattern],
            );
            await db.query(
                `DELETE FROM public.reservas
                 WHERE usuario_id IN (
                    SELECT id FROM public.usuarios WHERE identificacion LIKE $1
                 ) OR recurso_id IN (
                    SELECT id FROM public.recursos WHERE titulo LIKE $2
                 )`,
                [userPattern, resourcePattern],
            );
            await db.query(
                `DELETE FROM public.prestamos
                 WHERE usuario_id IN (
                    SELECT id FROM public.usuarios WHERE identificacion LIKE $1
                 ) OR recurso_id IN (
                    SELECT id FROM public.recursos WHERE titulo LIKE $2
                 )`,
                [userPattern, resourcePattern],
            );
            await db.query('DELETE FROM public.recursos WHERE titulo LIKE $1', [resourcePattern]);
            await db.query('DELETE FROM public.usuarios WHERE identificacion LIKE $1', [userPattern]);
        }
        await db.end();
    });

    await db.ready;
    databaseReady = true;
    for (let attempt = 0; !app.locals.server?.listening && attempt < 40; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(app.locals.server?.listening, 'API starts after database initialization');
    const base = `http://127.0.0.1:${app.locals.server.address().port}/api`;
    const librarianLogin = await request(base, '/auth/login', {
        method: 'POST',
        body: { correo: 'lucia.demo@example.test', password: demoPassword },
    });
    assert.equal(librarianLogin.status, 200);
    const librarianToken = librarianLogin.body.data.token;

    const people = [];
    for (let index = 0; index < 18; index += 1) {
        people.push(assertCreated(await request(base, '/usuarios', {
            token: librarianToken,
            method: 'POST',
            body: {
                identificacion: `S2-${suffix}-${index}`,
                codigo: `S2-${suffix}-${index}`,
                nombres: 'Sprint',
                apellidos: `Usuario ${index}`,
                correo: `s2.${suffix}.${index}@example.test`,
                rol: 'Estudiante',
                plan: 'Ingeniería de Software',
                semestre: 2,
                password,
            },
        }), `test student ${index}`));
    }

    const tokens = new Map();
    const tokenFor = async (person) => {
        if (!tokens.has(person.id)) {
            const login = await request(base, '/auth/login', {
                method: 'POST',
                body: { correo: person.correo, password },
            });
            assert.equal(login.status, 200);
            tokens.set(person.id, login.body.data.token);
        }
        return tokens.get(person.id);
    };

    let resourceNumber = 0;
    const createResource = async (coleccion = 'General', extra = {}) => {
        resourceNumber += 1;
        const resource = {
            titulo: `S2 ${suffix} ${resourceNumber}`,
            coleccion,
            ejemplares: coleccion === 'Mapoteca' ? 0
                : coleccion === 'Reserva' || coleccion === 'Tecnoteca' ? 10 : 5,
            ...(coleccion === 'General' || coleccion === 'Reserva'
                ? {
                    autor: 'Autor de prueba',
                    isbn: `978${String(1_000_000_000 + resourceNumber).padStart(10, '0')}`,
                    resumen: 'Recurso para pruebas de aceptación.',
                    fechaPublicacion: '2024-01-01',
                    dimensiones: '15 x 23 cm',
                    encuadernacion: 'Tapa blanda',
                }
                : {}),
            ...(coleccion === 'Mapoteca' ? { formato: 'shape' } : {}),
            ...(coleccion === 'Tecnoteca'
                ? {
                    tipoEquipo: 'Tableta',
                    numeroEquipo: `S2-${suffix}-${resourceNumber}`,
                    marca: 'Prueba',
                    modelo: 'T1',
                    cargador: true,
                    funda: true,
                }
                : {}),
            ...extra,
        };
        return assertCreated(await request(base, '/recursos', {
            token: librarianToken,
            method: 'POST',
            body: resource,
        }), `resource ${resourceNumber}`);
    };

    const checkout = async (person, resource) => {
        const result = assertCreated(await request(base, '/prestamos', {
            token: librarianToken,
            method: 'POST',
            body: { usuarioId: person.id, recursoId: resource.id },
        }), `checkout ${person.id}/${resource.id}`);
        assert.equal(result.tipo, 'prestamo');
        return result.data;
    };

    const reserve = async (person, resource) => {
        const result = assertCreated(await request(base, '/reservas', {
            token: await tokenFor(person),
            method: 'POST',
            body: { recursoId: resource.id },
        }), `reservation ${person.id}/${resource.id}`);
        return result.data.data;
    };

    const resourceState = async (resourceId) => {
        const response = await request(base, '/recursos');
        assert.equal(response.status, 200);
        return response.body.data.find((item) => item.id === resourceId).estado;
    };

    const tablet = await createResource('Tecnoteca');
    const tabletLoans = [];
    for (const person of people.slice(0, 10)) tabletLoans.push(await checkout(person, tablet));
    const blockedQueueUser = people[10];
    const firstEligibleQueueUser = people[11];
    const nextQueueUser = people[12];
    const waitingBlockedUser = await reserve(blockedQueueUser, tablet);
    const waitingFirst = await reserve(firstEligibleQueueUser, tablet);
    const waitingNext = await reserve(nextQueueUser, tablet);
    assert.equal(waitingBlockedUser.posicion, 1);
    assert.equal(waitingFirst.posicion, 2);
    assert.equal(waitingNext.posicion, 3);

    const queueFine = assertCreated(await request(base, '/multas', {
        token: librarianToken,
        method: 'POST',
        body: {
            usuarioId: blockedQueueUser.id,
            concepto: `Bloqueo de cola ${suffix}`,
            monto: 2000,
            fecha: new Date().toISOString().slice(0, 10),
        },
    }), 'fine for blocked queue member');
    assert.equal(queueFine.estado, 'Pendiente');

    const returnedTablet = await request(base, `/prestamos/${tabletLoans[0].id}/devolver`, {
        token: librarianToken,
        method: 'PATCH',
    });
    assert.equal(returnedTablet.status, 200, returnedTablet.body.message);
    assert.equal(returnedTablet.body.data.reservaPromovida.usuarioId, firstEligibleQueueUser.id);
    assert.equal(returnedTablet.body.data.reservaPromovida.estado, 'Apartada');
    assert.ok(Math.abs((Date.parse(returnedTablet.body.data.reservaPromovida.venceEn) - Date.now()) / 3_600_000 - 48) < 0.1);
    const tabletQueue = (await request(base, '/reservas', { token: librarianToken })).body.data
        .filter((item) => item.recursoId === tablet.id);
    assert.ok(!tabletQueue.some((item) => item.usuarioId === blockedQueueUser.id), 'blocked head is removed and skipped');
    assert.equal(tabletQueue.find((item) => item.usuarioId === nextQueueUser.id).posicion, 1);

    await db.query('UPDATE public.recursos SET ejemplares = 1 WHERE id = $1', [tablet.id]);
    const noCutting = assertCreated(await request(base, '/prestamos', {
        token: librarianToken,
        method: 'POST',
        body: { usuarioId: people[13].id, recursoId: tablet.id },
    }), 'request while a tablet queue exists');
    assert.equal(noCutting.tipo, 'reserva', 'a direct loan cannot bypass queued requests');
    const tabletAfterQueueAssignment = (await request(base, '/reservas', { token: librarianToken })).body.data
        .filter((item) => item.recursoId === tablet.id);
    assert.equal(tabletAfterQueueAssignment.find((item) => item.usuarioId === nextQueueUser.id).estado, 'Apartada');
    assert.equal(tabletAfterQueueAssignment.find((item) => item.usuarioId === people[13].id).posicion, 1);

    await db.query(
        "UPDATE public.reservas SET vence_en = CURRENT_TIMESTAMP - INTERVAL '1 minute' "
            + 'WHERE id = $1',
        [returnedTablet.body.data.reservaPromovida.id],
    );
    assert.equal(await prestamoService.expirarApartadosVencidos(), 1);
    const afterTabletExpiry = (await request(base, '/reservas', { token: librarianToken })).body.data
        .filter((item) => item.recursoId === tablet.id);
    assert.equal(afterTabletExpiry.find((item) => item.usuarioId === people[13].id).estado, 'Apartada');

    const generalQueue = await createResource();
    const generalLoans = [];
    for (const person of people.slice(0, 5)) generalLoans.push(await checkout(person, generalQueue));
    const generalFirst = await reserve(people[14], generalQueue);
    const generalSecond = await reserve(people[15], generalQueue);
    assert.equal(generalFirst.posicion, 1);
    assert.equal(generalSecond.posicion, 2);
    const renewalWithQueue = await request(base, `/prestamos/${generalLoans[0].id}/renovar`, {
        token: librarianToken,
        method: 'PATCH',
    });
    assert.equal(renewalWithQueue.status, 409);

    const generalReturn = await request(base, `/prestamos/${generalLoans[0].id}/devolver`, {
        token: librarianToken,
        method: 'PATCH',
    });
    assert.equal(generalReturn.status, 200, generalReturn.body.message);
    assert.equal(generalReturn.body.data.reservaPromovida.usuarioId, people[14].id);
    assert.equal(generalReturn.body.data.reservaPromovida.estado, 'Apartada');
    assert.equal(await resourceState(generalQueue.id), 'Reservado');
    await db.query(
        "UPDATE public.reservas SET vence_en = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE id = $1",
        [generalReturn.body.data.reservaPromovida.id],
    );
    assert.equal(await prestamoService.expirarApartadosVencidos(), 1);
    const generalAfterExpiry = (await request(base, '/reservas', { token: librarianToken })).body.data
        .find((item) => item.recursoId === generalQueue.id);
    assert.equal(generalAfterExpiry.usuarioId, people[15].id);
    assert.equal(generalAfterExpiry.estado, 'Apartada');

    const stateResource = await createResource();
    const stateLoans = [];
    for (const person of people.slice(0, 5)) stateLoans.push(await checkout(person, stateResource));
    assert.equal(await resourceState(stateResource.id), 'Prestado');
    const stateReturn = await request(base, `/prestamos/${stateLoans[0].id}/devolver`, {
        token: librarianToken,
        method: 'PATCH',
    });
    assert.equal(stateReturn.status, 200);
    assert.equal(await resourceState(stateResource.id), 'Disponible');

    for (const estado of ['Disponible', 'Prestado', 'Reservado']) {
        const supportedState = await request(base, `/recursos/${stateResource.id}/estado`, {
            token: librarianToken,
            method: 'PATCH',
            body: { estado },
        });
        assert.equal(supportedState.status, 200);
        assert.equal(supportedState.body.data.estado, estado);
    }

    let stateUpdate = await request(base, `/recursos/${stateResource.id}/estado`, {
        token: librarianToken,
        method: 'PATCH',
        body: { estado: 'Perdido' },
    });
    assert.equal(stateUpdate.status, 200);
    assert.equal(stateUpdate.body.data.estado, 'Perdido');
    assert.equal((await request(base, '/prestamos', {
        token: librarianToken,
        method: 'POST',
        body: { usuarioId: people[16].id, recursoId: stateResource.id },
    })).status, 404);
    assert.equal((await request(base, '/reservas', {
        token: await tokenFor(people[16]),
        method: 'POST',
        body: { recursoId: stateResource.id },
    })).status, 404);
    stateUpdate = await request(base, `/recursos/${stateResource.id}/estado`, {
        token: librarianToken,
        method: 'PATCH',
        body: { estado: 'Baja' },
    });
    assert.equal(stateUpdate.status, 200);
    assert.equal(stateUpdate.body.data.estado, 'Baja administrativa', 'legacy Baja input maps to the canonical status');
    assert.equal((await request(base, '/prestamos', {
        token: librarianToken,
        method: 'POST',
        body: { usuarioId: people[16].id, recursoId: stateResource.id },
    })).status, 404);
    assert.equal((await request(base, `/recursos/${stateResource.id}/estado`, {
        token: librarianToken,
        method: 'PATCH',
        body: { estado: 'Desconocido' },
    })).status, 400);

    const zeroRenewalResource = await createResource('Reserva');
    const zeroRenewalLoan = await checkout(people[16], zeroRenewalResource);
    assert.equal((await request(base, `/prestamos/${zeroRenewalLoan.id}/renovar`, {
        token: librarianToken,
        method: 'PATCH',
    })).status, 409);
    const mapoteca = await createResource('Mapoteca');
    const mapotecaLoan = await checkout(people[16], mapoteca);
    assert.equal((await request(base, `/prestamos/${mapotecaLoan.id}/renovar`, {
        token: librarianToken,
        method: 'PATCH',
    })).status, 409);

    const pendingFinePerson = people[17];
    const pendingFineLoan = await checkout(pendingFinePerson, await createResource());
    const manualFine = assertCreated(await request(base, '/multas', {
        token: librarianToken,
        method: 'POST',
        body: {
            usuarioId: pendingFinePerson.id,
            concepto: `Multa manual ${suffix}`,
            monto: 3000,
            fecha: new Date().toISOString().slice(0, 10),
        },
    }), 'pending fine');
    assert.equal((await request(base, `/prestamos/${pendingFineLoan.id}/renovar`, {
        token: librarianToken,
        method: 'PATCH',
    })).status, 409);
    assert.equal((await request(base, '/prestamos', {
        token: librarianToken,
        method: 'POST',
        body: { usuarioId: pendingFinePerson.id, recursoId: (await createResource()).id },
    })).status, 403);
    assert.equal((await request(base, '/reservas', {
        token: await tokenFor(pendingFinePerson),
        method: 'POST',
        body: { recursoId: (await createResource()).id },
    })).status, 403);

    const overduePerson = people[16];
    const overdueResource = await createResource();
    const overdueLoan = await checkout(overduePerson, overdueResource);
    await db.query(
        `UPDATE public.prestamos
         SET fecha_devolucion = ((CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota') - INTERVAL '2 days')::TEXT
         WHERE id = $1`,
        [overdueLoan.id],
    );
    assert.ok((await prestamoService.marcarPrestamosVencidos()) >= 1);
    assert.equal((await db.query('SELECT estado FROM public.prestamos WHERE id = $1', [overdueLoan.id])).rows[0].estado, 'Vencido');
    assert.equal((await request(base, `/prestamos/${overdueLoan.id}/renovar`, {
        token: librarianToken,
        method: 'PATCH',
    })).status, 409);
    assert.equal((await request(base, '/prestamos', {
        token: librarianToken,
        method: 'POST',
        body: { usuarioId: overduePerson.id, recursoId: (await createResource()).id },
    })).status, 403);
    assert.equal((await request(base, '/reservas', {
        token: await tokenFor(overduePerson),
        method: 'POST',
        body: { recursoId: (await createResource()).id },
    })).status, 403);

    await multaService.generarMultasPorMora();
    await multaService.generarMultasPorMora();
    let generated = await db.query(
        'SELECT COUNT(*)::INTEGER AS count, SUM(monto)::INTEGER AS total FROM public.multas WHERE prestamo_id = $1',
        [overdueLoan.id],
    );
    assert.equal(generated.rows[0].count, 2);
    assert.equal(generated.rows[0].total, 4000);
    const returnedOverdue = await request(base, `/prestamos/${overdueLoan.id}/devolver`, {
        token: librarianToken,
        method: 'PATCH',
    });
    assert.equal(returnedOverdue.status, 200, returnedOverdue.body.message);
    generated = await db.query(
        'SELECT COUNT(*)::INTEGER AS count, SUM(monto)::INTEGER AS total FROM public.multas WHERE prestamo_id = $1',
        [overdueLoan.id],
    );
    assert.equal(generated.rows[0].count, 2, 'return accrual does not duplicate daily charges');
    assert.equal(generated.rows[0].total, 4000);

    const studentFines = await request(base, '/multas', { token: await tokenFor(overduePerson) });
    const overdueFines = studentFines.body.data.filter((item) => item.concepto === `Mora diaria por préstamo ${overdueLoan.id}`);
    assert.equal(overdueFines.length, 2);
    const paidFine = await request(base, `/multas/${overdueFines[0].id}/pagar`, {
        token: await tokenFor(overduePerson),
        method: 'PATCH',
    });
    assert.equal(paidFine.status, 200);
    assert.equal(paidFine.body.data.estado, 'Pagada');
    const updatedFines = await request(base, '/multas', { token: await tokenFor(overduePerson) });
    assert.equal(updatedFines.body.data.find((item) => item.id === overdueFines[0].id).estado, 'Pagada');

    const paidManualFine = await request(base, `/multas/${manualFine.id}/pagar`, {
        token: await tokenFor(pendingFinePerson),
        method: 'PATCH',
    });
    assert.equal(paidManualFine.status, 200);
    assert.equal(paidManualFine.body.data.estado, 'Pagada');
    assertCreated(await request(base, '/prestamos', {
        token: librarianToken,
        method: 'POST',
        body: { usuarioId: pendingFinePerson.id, recursoId: (await createResource()).id },
    }), 'loan after pending fine is paid');
});
