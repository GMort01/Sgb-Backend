const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dbPath = process.env.DB_PATH || path.resolve(__dirname, '../../biblioteca.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new sqlite3.Database(dbPath);

const run = (sql, values = []) => new Promise((resolve, reject) => {
    db.run(sql, values, function (error) {
        if (error) reject(error);
        else resolve(this);
    });
});

const all = (sql, values = []) => new Promise((resolve, reject) => {
    db.all(sql, values, (error, rows) => {
        if (error) reject(error);
        else resolve(rows);
    });
});

async function ensureResourceColumn(name, definition) {
    const columns = await all('PRAGMA table_info(recursos)');
    if (!columns.some((column) => column.name === name)) {
        await run(`ALTER TABLE recursos ADD COLUMN ${name} ${definition}`);
    }
}

async function ensureColumn(table, name, definition) {
    const columns = await all(`PRAGMA table_info(${table})`);
    if (!columns.some((column) => column.name === name)) {
        await run(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
}

async function initializeDatabase() {
    await run(`
        CREATE TABLE IF NOT EXISTS recursos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            titulo TEXT NOT NULL,
            coleccion TEXT NOT NULL,
            disponible BOOLEAN DEFAULT 1,
            autor TEXT,
            ejemplares INTEGER NOT NULL DEFAULT 1,
            estado TEXT NOT NULL DEFAULT 'Disponible'
        )
    `);

    await ensureResourceColumn('autor', 'TEXT');
    await ensureResourceColumn('ejemplares', 'INTEGER NOT NULL DEFAULT 1');
    await ensureResourceColumn('estado', "TEXT NOT NULL DEFAULT 'Disponible'");
    await run(`
        UPDATE recursos
        SET estado = CASE WHEN disponible = 1 THEN 'Disponible' ELSE 'Prestado' END
        WHERE estado = 'Disponible' AND disponible = 0
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS prestamos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario TEXT NOT NULL,
            usuario_id INTEGER,
            codigo_recurso TEXT NOT NULL,
            recurso_id INTEGER,
            fecha_salida TEXT NOT NULL,
            fecha_devolucion TEXT NOT NULL,
            renovaciones_restantes INTEGER NOT NULL DEFAULT 1,
            estado TEXT NOT NULL DEFAULT 'Activo'
        )
    `);
    await run(`
        CREATE TABLE IF NOT EXISTS reservas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario TEXT NOT NULL,
            usuario_id INTEGER,
            codigo_recurso TEXT NOT NULL,
            recurso_id INTEGER,
            fecha_reserva TEXT NOT NULL,
            posicion INTEGER NOT NULL DEFAULT 1
        )
    `);
    await run(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            identificacion TEXT NOT NULL UNIQUE,
            codigo TEXT NOT NULL UNIQUE,
            nombres TEXT NOT NULL,
            apellidos TEXT NOT NULL,
            correo TEXT NOT NULL UNIQUE,
            rol TEXT NOT NULL
        )
    `);
    await run(`
        CREATE TABLE IF NOT EXISTS multas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario TEXT NOT NULL,
            concepto TEXT NOT NULL,
            monto REAL NOT NULL CHECK (monto > 0),
            fecha TEXT NOT NULL DEFAULT (date('now')),
            estado TEXT NOT NULL DEFAULT 'Pendiente'
        )
    `);
    await ensureColumn('prestamos', 'usuario_id', 'INTEGER');
    await ensureColumn('prestamos', 'recurso_id', 'INTEGER');
    await ensureColumn('reservas', 'usuario_id', 'INTEGER');
    await ensureColumn('reservas', 'recurso_id', 'INTEGER');
    await run(`
        CREATE TABLE IF NOT EXISTS actividades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            titulo TEXT NOT NULL,
            descripcion TEXT NOT NULL,
            fecha TEXT NOT NULL,
            hora TEXT NOT NULL,
            lugar TEXT NOT NULL,
            cupos INTEGER NOT NULL DEFAULT 20
        )
    `);
    await run(`
        CREATE TABLE IF NOT EXISTS inscripciones_actividades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actividad_id INTEGER NOT NULL,
            usuario_id INTEGER NOT NULL,
            fecha_inscripcion TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE (actividad_id, usuario_id),
            FOREIGN KEY (actividad_id) REFERENCES actividades(id),
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        )
    `);

    const [{ count }] = await all('SELECT COUNT(*) AS count FROM recursos');
    if (count === 0) {
        await run(
            'INSERT INTO recursos (titulo, coleccion, disponible, autor, ejemplares, estado) VALUES (?, ?, 1, ?, 1, ?)',
            ['Cien Años de Soledad', 'General', 'Gabriel García Márquez', 'Disponible'],
        );
        await run(
            'INSERT INTO recursos (titulo, coleccion, disponible, autor, ejemplares, estado) VALUES (?, ?, 1, ?, 1, ?)',
            ['Cálculo Multivariable', 'Reserva', null, 'Disponible'],
        );
        console.log('Base de datos cargada con recursos de ejemplo.');
    }

    let [{ count: userCount }] = await all('SELECT COUNT(*) AS count FROM usuarios');
    if (userCount === 0) {
        await run(
            `INSERT INTO usuarios (identificacion, codigo, nombres, apellidos, correo, rol)
             VALUES (?, ?, ?, ?, ?, ?)`,
            ['DEMO-1001', 'EST-001', 'Valeria', 'Demo', 'valeria.demo@example.test', 'Estudiante'],
        );
        await run(
            `INSERT INTO usuarios (identificacion, codigo, nombres, apellidos, correo, rol)
             VALUES (?, ?, ?, ?, ?, ?)`,
            ['DEMO-1002', 'EST-002', 'Mateo', 'Prueba', 'mateo.demo@example.test', 'Estudiante'],
        );
        await run(
            `INSERT INTO usuarios (identificacion, codigo, nombres, apellidos, correo, rol)
             VALUES (?, ?, ?, ?, ?, ?)`,
            ['DEMO-2001', 'BIB-001', 'Lucia', 'Bibliotecaria', 'lucia.demo@example.test', 'Bibliotecario'],
        );
        console.log('Usuarios de demostracion creados.');
    }

    const [{ count: activityCount }] = await all('SELECT COUNT(*) AS count FROM actividades');
    if (activityCount === 0) {
        await run(
            `INSERT INTO actividades (titulo, descripcion, fecha, hora, lugar, cupos)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                'Club de lectura: nuevas voces',
                'Conversatorio abierto para compartir lecturas y descubrir autores contemporaneos.',
                '2026-11-05',
                '16:00',
                'Sala de lectura',
                24,
            ],
        );
        await run(
            `INSERT INTO actividades (titulo, descripcion, fecha, hora, lugar, cupos)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                'Taller de busqueda academica',
                'Aprende a encontrar fuentes confiables y organizar referencias para tus trabajos.',
                '2026-11-12',
                '10:00',
                'Aula multimedia',
                18,
            ],
        );
        await run(
            `INSERT INTO actividades (titulo, descripcion, fecha, hora, lugar, cupos)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                'Semana de la biblioteca',
                'Recorrido guiado por las colecciones y servicios de la biblioteca.',
                '2026-11-19',
                '14:00',
                'Punto de encuentro: recepcion',
                30,
            ],
        );
    }

    const [{ count: loanCount }] = await all('SELECT COUNT(*) AS count FROM prestamos');
    if (loanCount === 0) {
        const [student] = await all("SELECT id, nombres, apellidos FROM usuarios WHERE rol = 'Estudiante' ORDER BY id LIMIT 1");
        const [resource] = await all(
            "SELECT id, titulo, ejemplares FROM recursos WHERE estado NOT IN ('Perdido', 'Baja') ORDER BY id LIMIT 1",
        );
        if (student && resource) {
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + 7);
            const isoDate = (date) => date.toISOString().slice(0, 10);
            await run(
                `INSERT INTO prestamos
                    (usuario, usuario_id, codigo_recurso, recurso_id, fecha_salida, fecha_devolucion, renovaciones_restantes, estado)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'Activo')`,
                [
                    `${student.nombres} ${student.apellidos}`,
                    student.id,
                    `REC-${resource.id}`,
                    resource.id,
                    isoDate(new Date()),
                    isoDate(dueDate),
                    1,
                ],
            );
            if (resource.ejemplares > 0) {
                await run('UPDATE recursos SET ejemplares = ejemplares - 1 WHERE id = ?', [resource.id]);
            }
        }
    }

    const [{ count: reservationCount }] = await all('SELECT COUNT(*) AS count FROM reservas');
    if (reservationCount === 0) {
        const [student] = await all("SELECT id, nombres, apellidos FROM usuarios WHERE rol = 'Estudiante' ORDER BY id DESC LIMIT 1");
        const [resource] = await all(
            "SELECT id, titulo FROM recursos WHERE ejemplares = 0 AND estado NOT IN ('Perdido', 'Baja') ORDER BY id LIMIT 1",
        );
        if (student && resource) {
            await run(
                `INSERT INTO reservas (usuario, usuario_id, codigo_recurso, recurso_id, fecha_reserva, posicion)
                 VALUES (?, ?, ?, ?, ?, 1)`,
                [
                    `${student.nombres} ${student.apellidos}`,
                    student.id,
                    `REC-${resource.id}`,
                    resource.id,
                    new Date().toISOString().slice(0, 10),
                ],
            );
        }
    }

    const [{ count: fineCount }] = await all('SELECT COUNT(*) AS count FROM multas');
    if (fineCount === 0) {
        const [student] = await all("SELECT nombres, apellidos FROM usuarios WHERE rol = 'Estudiante' ORDER BY id LIMIT 1");
        if (student) {
            await run(
                'INSERT INTO multas (usuario, concepto, monto, fecha, estado) VALUES (?, ?, ?, ?, ?)',
                [
                    `${student.nombres} ${student.apellidos}`,
                    'Retraso en devolucion (ejemplo de demostracion)',
                    2500,
                    new Date().toISOString().slice(0, 10),
                    'Pendiente',
                ],
            );
        }
    }

    const [{ count: enrollmentCount }] = await all('SELECT COUNT(*) AS count FROM inscripciones_actividades');
    if (enrollmentCount === 0) {
        const [student] = await all("SELECT id FROM usuarios WHERE rol = 'Estudiante' ORDER BY id LIMIT 1");
        const [activity] = await all('SELECT id FROM actividades ORDER BY fecha LIMIT 1');
        if (student && activity) {
            await run(
                'INSERT INTO inscripciones_actividades (actividad_id, usuario_id) VALUES (?, ?)',
                [activity.id, student.id],
            );
        }
    }
}

db.ready = initializeDatabase();

module.exports = db;
