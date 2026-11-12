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

function assertDueInDays(date, days) {
    const difference = (Date.parse(`${date.replace(' ', 'T')}Z`) - Date.now()) / 86400000;
    assert.ok(Math.abs(difference - days) < 0.35, `expected due date in ${days} days, got ${date}`);
}

test('Sprint 1 acceptance criteria: catalog, users, loans, seeding and access control', {
    skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to an isolated Supabase test database.',
}, async (t) => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.PORT = '0';
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-with-more-than-32-characters';
    process.env.CORS_ORIGINS = 'https://portal.example.test';
    const demoPassword = process.env.TEST_DEMO_USER_PASSWORD || 'Demo123!';
    process.env.DEMO_USER_PASSWORD = demoPassword;

    const app = require('../src/app');
    const db = require('../src/config/database');
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);

    t.after(async () => {
        if (app.locals.reservationExpiryTimer) {
            clearInterval(app.locals.reservationExpiryTimer);
        }
        if (app.locals.overdueLoanTimer) clearInterval(app.locals.overdueLoanTimer);
        if (app.locals.overdueFineTimer) clearInterval(app.locals.overdueFineTimer);
        if (app.locals.server?.listening) {
            await new Promise((resolve) => app.locals.server.close(resolve));
        }
        await db.end();
    });

    await db.ready;
    for (let attempt = 0; !app.locals.server?.listening && attempt < 40; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(app.locals.server?.listening, 'API starts after database initialization');
    const base = `http://127.0.0.1:${app.locals.server.address().port}/api`;

    const health = await request(`http://127.0.0.1:${app.locals.server.address().port}`, '/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.status, 'ok');

    const allowedPreflight = await fetch(`${base}/auth/login`, {
        method: 'OPTIONS',
        headers: {
            Origin: 'https://portal.example.test',
            'Access-Control-Request-Method': 'POST',
        },
    });
    assert.equal(allowedPreflight.headers.get('access-control-allow-origin'), 'https://portal.example.test');
    const rejectedPreflight = await fetch(`${base}/auth/login`, {
        method: 'OPTIONS',
        headers: {
            Origin: 'https://untrusted.example.test',
            'Access-Control-Request-Method': 'POST',
        },
    });
    assert.equal(rejectedPreflight.headers.get('access-control-allow-origin'), null);

    const catalogResponse = await request(base, '/recursos');
    assert.equal(catalogResponse.status, 200);
    const catalog = catalogResponse.body.data;
    const collection = (name) => catalog.filter((resource) => resource.coleccion === name);
    assert.ok(collection('General').length >= 20);
    assert.ok(collection('General').every((resource) => resource.ejemplaresTotales >= 5));
    assert.ok(collection('Reserva')[0].ejemplaresTotales >= 10);
    assert.ok(collection('Referencia')[0].ejemplaresTotales >= 3);
    assert.ok(collection('Hemeroteca')[0].ejemplaresTotales >= 2);
    assert.equal(collection('Mapoteca')[0].ejemplares, 0);
    const laptops = collection('Tecnoteca').filter((resource) => resource.titulo.startsWith('Laptop de demostración'));
    const tablets = collection('Tecnoteca').filter((resource) => resource.titulo.startsWith('Tableta de demostración'));
    assert.equal(laptops.length, 5);
    assert.ok(laptops.every((resource) => resource.ejemplaresTotales >= 3 && resource.numeroEquipo));
    assert.equal(tablets.length, 10);
    assert.ok(tablets.every((resource) => resource.ejemplaresTotales >= 10 && resource.numeroEquipo));

    assert.equal((await request(base, '/usuarios')).status, 401);
    const librarianLogin = await request(base, '/auth/login', {
        method: 'POST',
        body: { correo: 'lucia.demo@example.test', password: demoPassword },
    });
    assert.equal(librarianLogin.status, 200);
    const librarianToken = librarianLogin.body.data.token;
    const usersResponse = await request(base, '/usuarios', { token: librarianToken });
    assert.equal(usersResponse.status, 200);
    const users = usersResponse.body.data;
    for (const [role, minimum] of [['Estudiante', 50], ['Profesor', 10], ['Bibliotecario', 3]]) {
        assert.ok(users.filter((user) => user.rol === role).length >= minimum, `seed minimum for ${role}`);
    }
    assert.ok(!JSON.stringify(usersResponse.body).includes('password_hash'));
    const borrowers = users.filter((user) => user.rol === 'Estudiante' && user.correo !== 'valeria.demo@example.test');
    const createdUser = assertCreated(await request(base, '/usuarios', {
        token: librarianToken,
        method: 'POST',
        body: {
            identificacion: `TEST-${suffix}`,
            codigo: `TEST-${suffix}`,
            nombres: 'Usuario',
            apellidos: 'Nuevo',
            correo: `usuario.${suffix}@example.test`,
            rol: 'Estudiante',
            plan: 'Ingeniería de Software',
            semestre: 2,
            password: 'ClaveSegura123!',
        },
    }), 'student registration');
    assert.equal(createdUser.plan, 'Ingeniería de Software');
    assert.equal(createdUser.semestre, 2);
    assert.ok(!Object.hasOwn(createdUser, 'password'));
    assert.equal((await request(base, '/auth/login', {
        method: 'POST',
        body: { correo: `usuario.${suffix}@example.test`, password: 'ClaveSegura123!' },
    })).status, 200);
    const borrower = createdUser;

    const validResources = [
        { titulo: `Test general ${suffix}`, coleccion: 'General', ejemplares: 5, autor: 'Autor', isbn: '9780000009001', resumen: 'Resumen de prueba', fechaPublicacion: '2024-01-01', dimensiones: '15 x 23 cm', encuadernacion: 'Tapa dura' },
        { titulo: `Test reserva ${suffix}`, coleccion: 'Reserva', ejemplares: 10, autor: 'Autor', isbn: '9780000009002', resumen: 'Resumen de prueba', fechaPublicacion: '2024-01-01', dimensiones: '15 x 23 cm', encuadernacion: 'Tapa blanda' },
        { titulo: `Test referencia ${suffix}`, coleccion: 'Referencia', ejemplares: 3, dimensiones: '8 x 10 pulgadas' },
        { titulo: `Test hemeroteca ${suffix}`, coleccion: 'Hemeroteca', ejemplares: 2, issn: '1234-9999', periodicidad: 'Mensual' },
        { titulo: `Test mapoteca ${suffix}`, coleccion: 'Mapoteca', formato: 'shape' },
        { titulo: `Test laptop ${suffix}`, coleccion: 'Tecnoteca', tipoEquipo: 'Laptop', ejemplares: 3, numeroEquipo: `TEST-L-${suffix}`, marca: 'Test', modelo: 'L1', cargador: true, funda: false },
        { titulo: `Test tableta ${suffix}`, coleccion: 'Tecnoteca', tipoEquipo: 'Tableta', ejemplares: 10, numeroEquipo: `TEST-T-${suffix}`, marca: 'Test', modelo: 'T1', cargador: true, funda: true },
    ];
    const created = [];
    for (const resource of validResources) {
        const response = await request(base, '/recursos', { token: librarianToken, method: 'POST', body: resource });
        created.push(assertCreated(response, `${resource.coleccion} resource`));
    }
    const underMinimum = await request(base, '/recursos', {
        token: librarianToken,
        method: 'POST',
        body: { ...validResources[0], titulo: `Invalid general ${suffix}`, ejemplares: 4 },
    });
    assert.equal(underMinimum.status, 400);

    const loans = {};
    for (const resource of created) {
        const response = await request(base, '/prestamos', {
            token: librarianToken,
            method: 'POST',
            body: { usuarioId: borrower.id, recursoId: resource.id },
        });
        loans[resource.coleccion] = assertCreated(response, `${resource.coleccion} loan`).data;
    }
    assert.equal(loans.General.renovacionesRestantes, 5);
    assert.equal(loans.Reserva.renovacionesRestantes, 0);
    assert.equal(loans.Referencia.renovacionesRestantes, 2);
    assert.equal(loans.Hemeroteca.renovacionesRestantes, 1);
    assert.equal(loans.Tecnoteca.renovacionesRestantes, 2);
    assert.ok(loans.General.bibliotecarioId);
    assertDueInDays(loans.General.fechaDevolucion, 15);
    assertDueInDays(loans.Reserva.fechaDevolucion, 5);
    assertDueInDays(loans.Referencia.fechaDevolucion, 3);
    assertDueInDays(loans.Hemeroteca.fechaDevolucion, 1);
    assertDueInDays(loans.Tecnoteca.fechaDevolucion, 7);
    assert.equal(loans.Mapoteca.medioEntrega, 'USB - solo lectura');
    assert.ok(loans.Mapoteca.fechaDevolucion.endsWith('21:00:00'));
    assert.equal((await request(base, `/prestamos/${loans.General.id}/renovar`, { token: librarianToken, method: 'PATCH' })).status, 200);
    assert.equal((await request(base, `/prestamos/${loans.Reserva.id}/renovar`, { token: librarianToken, method: 'PATCH' })).status, 409);

    const studentLogin = await request(base, '/auth/login', {
        method: 'POST',
        body: { correo: 'valeria.demo@example.test', password: demoPassword },
    });
    assert.equal(studentLogin.status, 200);
    const studentToken = studentLogin.body.data.token;
    const student = users.find((user) => user.correo === 'valeria.demo@example.test');
    assert.ok(student, 'seed includes the student account used for the overdue-fine test');
    const holdResource = assertCreated(await request(base, '/recursos', {
        token: librarianToken,
        method: 'POST',
        body: { ...validResources[0], titulo: `Test pickup hold ${suffix}`, isbn: '9780000009020' },
    }), 'pickup hold resource');
    const holdResponse = await request(base, '/reservas', {
        token: studentToken,
        method: 'POST',
        body: { recursoId: holdResource.id },
    });
    assert.equal(holdResponse.status, 201, holdResponse.body.message);
    const pickupHold = holdResponse.body.data.data;
    assert.equal(pickupHold.estado, 'Apartada');
    assert.ok(Math.abs((Date.parse(pickupHold.venceEn) - Date.now()) / 3_600_000 - 48) < 0.1);
    const stockAfterHold = (await request(base, '/recursos')).body.data
        .find((resource) => resource.id === holdResource.id).ejemplares;
    assert.equal(stockAfterHold, 4, 'pickup hold reserves exactly one physical copy');
    const checkout = assertCreated(await request(base, '/prestamos', {
        token: librarianToken,
        method: 'POST',
        body: { usuarioId: student.id, recursoId: holdResource.id },
    }), 'pickup checkout');
    assert.equal(checkout.tipo, 'prestamo');
    assert.equal(checkout.data.usuarioId, student.id);
    const stockAfterPickup = (await request(base, '/recursos')).body.data
        .find((resource) => resource.id === holdResource.id).ejemplares;
    assert.equal(stockAfterPickup, 4, 'checking out an already-held copy does not decrement stock twice');
    assert.ok(!(await request(base, '/reservas', { token: studentToken })).body.data
        .some((reservation) => reservation.id === pickupHold.id), 'the pickup hold is consumed by checkout');

    const expiringResource = assertCreated(await request(base, '/recursos', {
        token: librarianToken,
        method: 'POST',
        body: { ...validResources[0], titulo: `Test expiring hold ${suffix}`, isbn: '9780000009021' },
    }), 'expiring hold resource');
    const expiringHoldResponse = await request(base, '/reservas', {
        token: studentToken,
        method: 'POST',
        body: { recursoId: expiringResource.id },
    });
    assert.equal(expiringHoldResponse.status, 201);
    const expiringHold = expiringHoldResponse.body.data.data;
    await db.query(
        "UPDATE public.reservas SET vence_en = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE id = $1",
        [expiringHold.id],
    );
    const catalogAfterExpiry = await request(base, '/recursos');
    assert.equal(catalogAfterExpiry.body.data.find((resource) => resource.id === expiringResource.id).ejemplares, 5);
    assert.ok(!(await request(base, '/reservas', { token: studentToken })).body.data
        .some((reservation) => reservation.id === expiringHold.id), 'expired holds release the copy and are removed');

    const ownFine = assertCreated(await request(base, '/multas', {
        token: librarianToken,
        method: 'POST',
        body: {
            usuarioId: student.id,
            concepto: `Retraso de devolución ${suffix}`,
            monto: 2500,
            fecha: new Date().toISOString().slice(0, 10),
        },
    }), 'student fine');
    assert.equal(ownFine.monto, 2500);
    const studentFines = await request(base, '/multas', { token: studentToken });
    assert.equal(studentFines.status, 200);
    assert.ok(studentFines.body.data.some((fine) => fine.concepto === `Retraso de devolución ${suffix}`));
    assert.ok(studentFines.body.data.every((fine) => fine.usuario === `${student.nombres} ${student.apellidos}`));
    const anotherUserFine = assertCreated(await request(base, '/multas', {
        token: librarianToken,
        method: 'POST',
        body: {
            usuarioId: borrower.id,
            concepto: `Cargo de otra cuenta ${suffix}`,
            monto: 5000,
            fecha: new Date().toISOString().slice(0, 10),
        },
    }), 'fine for another user');
    assert.equal(anotherUserFine.monto, 5000, 'integer COP amounts are stored exactly');
    assert.equal((await request(base, `/multas/${anotherUserFine.id}/pagar`, {
        token: studentToken,
        method: 'PATCH',
    })).status, 409, 'students cannot simulate payment for another user');
    assert.equal((await request(base, '/recursos', { token: studentToken, method: 'POST', body: {} })).status, 403);
    assert.equal((await request(base, '/prestamos', { token: studentToken, method: 'POST', body: {} })).status, 403);
    assert.equal((await request(base, '/usuarios', { token: studentToken })).status, 403);

    const professor = users.find((user) => user.rol === 'Profesor');
    assert.ok(professor, 'seed includes a professor account');
    const professorLogin = await request(base, '/auth/login', {
        method: 'POST',
        body: { correo: professor.correo, password: demoPassword },
    });
    assert.equal(professorLogin.status, 200);
    const activityDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const activity = assertCreated(await request(base, '/actividades', {
        token: librarianToken,
        method: 'POST',
        body: {
            titulo: `Actividad de prueba ${suffix}`,
            descripcion: 'Actividad para validar inscripción de perfiles académicos.',
            fecha: activityDate,
            hora: '10:00',
            lugar: 'Biblioteca',
            cupos: 20,
        },
    }), 'activity');
    assert.equal((await request(base, `/actividades/${activity.id}/inscripciones`, {
        token: professorLogin.body.data.token,
        method: 'POST',
    })).status, 201, 'professors can enroll in academic activities');

    const drained = assertCreated(await request(base, '/recursos', {
        token: librarianToken,
        method: 'POST',
        body: { ...validResources[0], titulo: `Test drained ${suffix}`, isbn: '9780000009010' },
    }), 'drained general resource');
    for (const user of borrowers.slice(1, 6)) {
        assertCreated(await request(base, '/prestamos', {
            token: librarianToken,
            method: 'POST',
            body: { usuarioId: user.id, recursoId: drained.id },
        }), 'stock checkout');
    }
    assert.equal((await request(base, '/reservas', {
        token: studentToken,
        method: 'POST',
        body: { recursoId: drained.id },
    })).status, 403, 'unpaid fines block reservations');
    const reserver = borrowers[6];
    const reserverLogin = await request(base, '/auth/login', {
        method: 'POST',
        body: { correo: reserver.correo, password: demoPassword },
    });
    const reservation = await request(base, '/reservas', {
        token: reserverLogin.body.data.token,
        method: 'POST',
        body: { recursoId: drained.id },
    });
    assert.equal(reservation.status, 201);
    assert.equal(reservation.body.data.data.posicion, 1);
    const simulatedPayment = await request(base, `/multas/${ownFine.id}/pagar`, {
        token: studentToken,
        method: 'PATCH',
    });
    assert.equal(simulatedPayment.status, 200, simulatedPayment.body.message);
    assert.equal(simulatedPayment.body.data.estado, 'Pagada');
    assert.equal(simulatedPayment.body.simulatedPayment, true);
    assert.equal((await request(base, `/multas/${ownFine.id}/pagar`, {
        token: studentToken,
        method: 'PATCH',
    })).status, 409, 'paid fine cannot be paid twice');
    const reservationAfterPayment = await request(base, '/reservas', {
        token: studentToken,
        method: 'POST',
        body: { recursoId: drained.id },
    });
    assert.equal(reservationAfterPayment.status, 201, 'simulated payment releases circulation restrictions');
    assert.equal(reservationAfterPayment.body.data.data.posicion, 2);
    const firstReturnableLoan = (await request(base, '/prestamos/todos', { token: librarianToken })).body.data
        .find((loan) => loan.recursoId === drained.id && loan.usuarioId === borrowers[1].id);
    assert.ok(firstReturnableLoan);
    const returnResponse = await request(base, `/prestamos/${firstReturnableLoan.id}/devolver`, {
        token: librarianToken,
        method: 'PATCH',
    });
    assert.equal(returnResponse.status, 200);
    assert.equal(returnResponse.body.data.reservaPromovida.estado, 'Apartada');
    assert.equal(returnResponse.body.data.reservaPromovida.usuarioId, reserver.id);
    const reservationAfterPromotion = (await request(base, '/reservas', { token: studentToken })).body.data
        .find((item) => item.recursoId === drained.id);
    assert.equal(reservationAfterPromotion.posicion, 1, 'promoting the first person compacts the remaining wait-list positions');

    const foreignKeys = await db.query(
        `SELECT conname FROM pg_constraint
         WHERE conrelid = 'public.prestamos'::REGCLASS AND contype = 'f'`,
    );
    assert.equal(foreignKeys.rowCount, 3);
});
