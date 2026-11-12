const express = require('express');
const cors = require('cors');
const recursoController = require('./controllers/recursoController');
const prestamoController = require('./controllers/prestamoController');
const usuarioController = require('./controllers/usuarioController');
const multaController = require('./controllers/multaController');
const actividadController = require('./controllers/actividadController');
const authController = require('./controllers/authController');
const prestamoService = require('./services/prestamoService');
const { autenticar, permitirRoles } = require('./middleware/auth');
const db = require('./config/database');

const app = express();
const allowedOrigins = (process.env.CORS_ORIGINS || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5173'))
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

app.use(cors({
    origin(origin, callback) {
        callback(null, !origin || allowedOrigins.includes(origin.replace(/\/+$/, '')));
    },
}));
app.use(express.json());

app.get('/health', async (_req, res) => {
    try {
        await db.query('SELECT 1');
        return res.status(200).json({ status: 'ok' });
    } catch (error) {
        console.error('La comprobación de salud no pudo consultar PostgreSQL:', error.message);
        return res.status(503).json({ status: 'unavailable' });
    }
});

app.post('/api/auth/login', (req, res) => authController.iniciarSesion(req, res));
app.get('/api/auth/me', autenticar, (req, res) => authController.perfil(req, res));
app.get('/api/recursos', (req, res) => recursoController.getRecursos(req, res));
app.post('/api/recursos', autenticar, permitirRoles('Bibliotecario'), (req, res) => recursoController.crearRecurso(req, res));
app.get('/api/prestamos', autenticar, (req, res) => prestamoController.obtenerActivos(req, res));
app.get('/api/prestamos/todos', autenticar, (req, res) => prestamoController.obtenerTodos(req, res));
app.post('/api/prestamos', autenticar, permitirRoles('Bibliotecario'), (req, res) => prestamoController.solicitar(req, res));
app.patch('/api/prestamos/:id/renovar', autenticar, (req, res) => prestamoController.renovar(req, res));
app.patch('/api/prestamos/:id/devolver', autenticar, permitirRoles('Bibliotecario'), (req, res) => prestamoController.devolver(req, res));
app.get('/api/reservas', autenticar, (req, res) => prestamoController.obtenerReservas(req, res));
app.post('/api/reservas', autenticar, permitirRoles('Estudiante', 'Profesor'), (req, res) => prestamoController.reservar(req, res));
app.delete('/api/reservas/:id', autenticar, (req, res) => prestamoController.cancelarReserva(req, res));
app.get('/api/usuarios/estudiantes', autenticar, permitirRoles('Bibliotecario'), (req, res) => usuarioController.obtenerEstudiantes(req, res));
app.get('/api/usuarios', autenticar, permitirRoles('Bibliotecario'), (req, res) => usuarioController.obtenerTodos(req, res));
app.post('/api/usuarios', autenticar, permitirRoles('Bibliotecario'), (req, res) => usuarioController.crear(req, res));
app.get('/api/multas', autenticar, (req, res) => multaController.obtenerTodas(req, res));
app.post('/api/multas', autenticar, permitirRoles('Bibliotecario'), (req, res) => multaController.crear(req, res));
app.patch('/api/multas/:id/pagar', autenticar, permitirRoles('Bibliotecario', 'Estudiante', 'Profesor'), (req, res) => multaController.marcarPagada(req, res));
app.get('/api/actividades', autenticar, (req, res) => actividadController.obtenerTodas(req, res));
app.post('/api/actividades', autenticar, permitirRoles('Bibliotecario'), (req, res) => actividadController.crear(req, res));
app.post('/api/actividades/:id/inscripciones', autenticar, permitirRoles('Estudiante', 'Profesor'), (req, res) => actividadController.inscribir(req, res));

const PORT = process.env.PORT || 3000;
db.ready
    .then(() => {
        app.locals.reservationExpiryTimer = setInterval(() => {
            prestamoService.expirarApartadosVencidos().catch((error) => {
                console.error('No se pudieron expirar los apartados vencidos:', error);
            });
        }, 60_000);
        app.locals.reservationExpiryTimer.unref();
        app.locals.server = app.listen(PORT, () => {
            console.log(`Servidor ejecutándose en el puerto ${app.locals.server.address().port}`);
        });
    })
    .catch((error) => {
        console.error('No se pudo inicializar la base de datos:', error);
        process.exitCode = 1;
        db.end();
});

module.exports = app;