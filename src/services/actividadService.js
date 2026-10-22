const actividadRepository = require('../repositories/actividadRepository');

class ActividadService {
    obtenerTodas(usuarioId) {
        return actividadRepository.obtenerTodas(usuarioId);
    }

    crear(actividad) {
        return actividadRepository.crear(actividad);
    }

    inscribir(actividadId, usuarioId) {
        return actividadRepository.inscribir(actividadId, usuarioId);
    }
}

module.exports = new ActividadService();
