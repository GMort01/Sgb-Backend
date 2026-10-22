const recursoRepository = require('../repositories/recursoRepository');

class RecursoService {
    async listarRecursos() {
        // En el futuro aquí pones reglas de negocio (ej. validar estado, permisos, etc.)
        return await recursoRepository.obtenerTodos();
    }

    async crearRecurso(recurso) {
        return recursoRepository.crear(recurso);
    }
}

module.exports = new RecursoService();