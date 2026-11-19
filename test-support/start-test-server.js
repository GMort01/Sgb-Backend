const path = require('node:path');
const dotenv = require('dotenv');

const testEnvPath = path.resolve(__dirname, '..', '.env.test');
const result = dotenv.config({ path: testEnvPath, override: true });
if (result.error) {
    throw new Error(`No se pudo cargar el entorno de pruebas desde ${testEnvPath}.`, {
        cause: result.error,
    });
}
if (!process.env.TEST_DATABASE_URL) {
    throw new Error('Define TEST_DATABASE_URL en .env.test antes de iniciar el servidor de pruebas.');
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DEMO_USER_PASSWORD = process.env.TEST_DEMO_USER_PASSWORD || 'Demo123!';
process.env.PORT = process.env.TEST_PORT || '3000';

require('../src/app');
