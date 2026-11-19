const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env.test') });
const { after, before, describe, it } = require('node:test');
const { cleanupTestData } = require('../../test-support/cleanup');

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

async function assertCreated(response, label) {
    assert.equal(response.status, 201, `${label}: ${JSON.stringify(response.body)}`);
    return response.body.data;
}

const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const integrationPassword = 'IntegrationTest123!';
const seedPassword = process.env.TEST_DEMO_USER_PASSWORD || 'Demo123!';
let app;
let db;
let databaseReady = false;
let base;
let librarianToken;
let studentToken;
let secondStudentToken;
let borrower;
let reservationOwner;
let loanResource;
let administrativeResource;

describe('Integration: API de biblioteca sobre Supabase de pruebas', {
    skip: !process.env.TEST_DATABASE_URL && 'Configura TEST_DATABASE_URL en .env.test.',
}, () => {
    before(async () => {
        process.env.NODE_ENV = 'test';
        process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
        process.env.PORT = '0';
        process.env.JWT_SECRET = 'test-secret-with-more-than-32-characters';
        process.env.DEMO_USER_PASSWORD = seedPassword;
        process.env.OVERDUE_FINE_DAILY_RATE = '2000';
        process.env.CORS_ORIGINS = 'https://portal.example.test';

        app = require('../../src/app');
        db = require('../../src/config/database');
        await db.ready;
        databaseReady = true;

        for (let attempt = 0; !app.locals.server?.listening && attempt < 40; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        assert.ok(app.locals.server?.listening, 'API starts after test database initialization');
        assert.equal(app.locals.reservationExpiryTimer, undefined);
        assert.equal(app.locals.overdueLoanTimer, undefined);
        assert.equal(app.locals.overdueFineTimer, undefined);
        base = `http://127.0.0.1:${app.locals.server.address().port}/api`;

        const librarianLogin = await request(base, '/auth/login', {
            method: 'POST',
            body: { correo: 'lucia.demo@example.test', password: seedPassword },
        });
        assert.equal(librarianLogin.status, 200, JSON.stringify(librarianLogin.body));
        librarianToken = librarianLogin.body.data.token;

        const createStudent = async (index) => assertCreated(await request(base, '/usuarios', {
            token: librarianToken,
            method: 'POST',
            body: {
                identificacion: `API-${suffix}-${index}`,
                codigo: `API-${suffix}-${index}`,
                nombres: 'Prueba',
                apellidos: `Integración ${index}`,
                correo: `api.${suffix}.${index}@example.test`,
                rol: 'Estudiante',
                plan: 'Ingeniería de Software',
                semestre: 2,
                password: integrationPassword,
            },
        }), `create integration student ${index}`);

        borrower = await createStudent(1);
        reservationOwner = await createStudent(2);

        const createResource = async (kind) => assertCreated(await request(base, '/recursos', {
            token: librarianToken,
            method: 'POST',
            body: {
                titulo: `API ${suffix} ${kind}`,
                coleccion: 'General',
                ejemplares: 5,
                autor: 'Biblioteca de prueba',
                isbn: '9780000009001',
                resumen: 'Recurso temporal para una prueba de integración.',
                fechaPublicacion: '2024-01-01',
                dimensiones: '15 x 23 cm',
                encuadernacion: 'Tapa blanda',
            },
        }), `create integration resource ${kind}`);

        loanResource = await createResource('prestamo');
        administrativeResource = await createResource('baja');

        const loginStudent = async (student) => {
            const login = await request(base, '/auth/login', {
                method: 'POST',
                body: { correo: student.correo, password: integrationPassword },
            });
            assert.equal(login.status, 200, JSON.stringify(login.body));
            return login.body.data.token;
        };
        studentToken = await loginStudent(borrower);
        secondStudentToken = await loginStudent(reservationOwner);
    });

    after(async () => {
        try {
            if (app?.locals.server?.listening) {
                await new Promise((resolve) => app.locals.server.close(resolve));
            }
            if (databaseReady) {
                await cleanupTestData(db, {
                    userPattern: `API-${suffix}-%`,
                    resourcePattern: `API ${suffix} %`,
                    finePattern: `%${suffix}%`,
                    activityPattern: `%${suffix}%`,
                });
            }
        } finally {
            if (db) await db.end();
        }
    });

    it('POST /api/auth/login autentica un estudiante y devuelve un JWT', async () => {
        const response = await request(base, '/auth/login', {
            method: 'POST',
            body: { correo: borrower.correo, password: integrationPassword },
        });
        assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.equal(response.body.success, true);
        assert.ok(response.body.data.token);
        assert.equal(response.body.data.usuario.id, borrower.id);
    });

    it('GET /api/recursos entrega el catálogo sin autenticación', async () => {
        const response = await request(base, '/recursos');
        assert.equal(response.status, 200);
        assert.equal(response.body.success, true);
        assert.ok(response.body.data.some((resource) => resource.id === loanResource.id));
    });

    it('POST /api/prestamos registra un préstamo para el usuario seleccionado', async () => {
        const response = await request(base, '/prestamos', {
            token: librarianToken,
            method: 'POST',
            body: { usuarioId: borrower.id, recursoId: loanResource.id },
        });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        assert.equal(response.body.data.tipo, 'prestamo');
        assert.equal(response.body.data.data.usuarioId, borrower.id);
        assert.equal(response.body.data.data.recursoId, loanResource.id);
    });

    it('POST y GET /api/reservas crean y consultan un apartado para otro estudiante', async () => {
        const created = await request(base, '/reservas', {
            token: secondStudentToken,
            method: 'POST',
            body: { recursoId: loanResource.id },
        });
        assert.equal(created.status, 201, JSON.stringify(created.body));
        assert.equal(created.body.data.data.estado, 'Apartada');

        const listed = await request(base, '/reservas', { token: secondStudentToken });
        assert.equal(listed.status, 200);
        assert.ok(listed.body.data.some((reservation) => reservation.id === created.body.data.data.id));
    });

    it('PATCH /api/recursos/:id/estado aplica la baja administrativa', async () => {
        const response = await request(base, `/recursos/${administrativeResource.id}/estado`, {
            token: librarianToken,
            method: 'PATCH',
            body: { estado: 'Baja' },
        });
        assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.equal(response.body.data.estado, 'Baja administrativa');
    });
});
