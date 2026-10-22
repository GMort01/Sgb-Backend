const express = require('express');
const cors = require('cors');
const recursoController = require('./controllers/recursoController');
const prestamoController = require('./controllers/prestamoController');
const usuarioController = require('./controllers/usuarioController');
const multaController = require('./controllers/multaController');
const actividadController = require('./controllers/actividadController');
const db = require('./config/database');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/recursos', (req, res) => recursoController.getRecursos(req, res));
app.post('/api/recursos', (req, res) => recursoController.crearRecurso(req, res));
app.get('/api/prestamos', (req, res) => prestamoController.obtenerActivos(req, res));
app.get('/api/prestamos/todos', (req, res) => prestamoController.obtenerTodos(req, res));
app.post('/api/prestamos', (req, res) => prestamoController.solicitar(req, res));
app.patch('/api/prestamos/:id/renovar', (req, res) => prestamoController.renovar(req, res));
app.patch('/api/prestamos/:id/devolver', (req, res) => prestamoController.devolver(req, res));
app.get('/api/reservas', (req, res) => prestamoController.obtenerReservas(req, res));
app.delete('/api/reservas/:id', (req, res) => prestamoController.cancelarReserva(req, res));
app.get('/api/usuarios/estudiantes', (req, res) => usuarioController.obtenerEstudiantes(req, res));
app.get('/api/usuarios', (req, res) => usuarioController.obtenerTodos(req, res));
app.post('/api/usuarios', (req, res) => usuarioController.crear(req, res));
app.get('/api/multas', (req, res) => multaController.obtenerTodas(req, res));
app.post('/api/multas', (req, res) => multaController.crear(req, res));
app.patch('/api/multas/:id/pagar', (req, res) => multaController.marcarPagada(req, res));
app.get('/api/actividades', (req, res) => actividadController.obtenerTodas(req, res));
app.post('/api/actividades', (req, res) => actividadController.crear(req, res));
app.post('/api/actividades/:id/inscripciones', (req, res) => actividadController.inscribir(req, res));

const PORT = process.env.PORT || 3000;
db.ready
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Servidor ejecutándose en el puerto ${PORT}`);
        });
    })
    .catch((error) => {
        console.error('No se pudo inicializar la base de datos:', error);
        process.exitCode = 1;
        db.close();
});