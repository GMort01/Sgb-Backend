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
    const demoPassword = process.env.TEST_DEMO_USER_PASSWORD || 'Demo123!';
    process.env.DEMO_USER_PASSWORD = demoPassword;

    const app = require('../src/app');
    const db = require('../src/config/database');
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);

    t.after(async () => {
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

    const foreignKeys = await db.query(
        `SELECT conname FROM pg_constraint
         WHERE conrelid = 'public.prestamos'::REGCLASS AND contype = 'f'`,
    );
    assert.equal(foreignKeys.rowCount, 3);
});
