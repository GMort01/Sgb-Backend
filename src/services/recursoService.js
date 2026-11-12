const recursoRepository = require('../repositories/recursoRepository');
const prestamoService = require('./prestamoService');

class RecursoService {
    async listarRecursos() {
        await prestamoService.expirarApartadosVencidos();
        return await recursoRepository.obtenerTodos();
    }

    async crearRecurso(recurso) {
        return recursoRepository.crear(recurso);
    }

    actualizarEstado(id, estado) {
        return recursoRepository.actualizarEstado(id, estado);
    }
}

module.exports = new RecursoService();