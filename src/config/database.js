require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

if (!process.env.DATABASE_URL) {
    throw new Error('Define DATABASE_URL en el entorno o en el archivo .env para conectar con Supabase.');
}

const ssl = { rejectUnauthorized: true };
if (process.env.PG_CA_CERT_PATH) {
    const certificatePath = path.resolve(process.env.PG_CA_CERT_PATH);
    try {
        ssl.ca = fs.readFileSync(certificatePath, 'utf8');
    } catch (error) {
        throw new Error(`No se pudo leer el certificado CA indicado por PG_CA_CERT_PATH: ${certificatePath}`, {
            cause: error,
        });
    }
}

const db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

db.on('error', (error) => {
    console.error('Error en una conexión inactiva de PostgreSQL:', error.message);
});

async function initializeDatabase() {
    const requiredTables = [
        'usuarios',
        'recursos',
        'prestamos',
        'reservas',
        'multas',
        'actividades',
        'inscripciones_actividades',
    ];
    const result = await db.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = ANY($1::TEXT[])`,
        [requiredTables],
    );
    const existingTables = new Set(result.rows.map(({ table_name }) => table_name));
    const missingTables = requiredTables.filter((table) => !existingTables.has(table));
    if (missingTables.length) {
        throw new Error(`Faltan tablas en Supabase: ${missingTables.join(', ')}. Ejecuta supabase/setup.sql.`);
    }

    const missingPasswords = await db.query(
        'SELECT COUNT(*)::INTEGER AS count FROM public.usuarios WHERE password_hash IS NULL',
    );
    if (missingPasswords.rows[0].count === 0) return;

    const password = process.env.DEMO_USER_PASSWORD
        || (process.env.NODE_ENV === 'production' ? null : 'Demo123!');
    if (!password || password.length < 8) {
        throw new Error('Define DEMO_USER_PASSWORD (mínimo 8 caracteres) para inicializar las cuentas sin contraseña.');
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await db.query(
        'UPDATE public.usuarios SET password_hash = $1 WHERE password_hash IS NULL',
        [passwordHash],
    );
}

db.ready = initializeDatabase();

module.exports = db;
