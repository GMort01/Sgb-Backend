const prestamoRepository = require('../repositories/prestamoRepository');

class PrestamoService {
    obtenerActivos() {
        return prestamoRepository.obtenerActivos();
    }

    obtenerTodos() {
        return prestamoRepository.obtenerTodos();
    }

    obtenerReservas() {
        return prestamoRepository.obtenerReservas();
    }

    renovar(id) {
        return prestamoRepository.renovar(id);
    }

    solicitar(usuarioId, recursoId) {
        return prestamoRepository.solicitar(usuarioId, recursoId);
    }

    cancelarReserva(id, usuarioId) {
        return prestamoRepository.cancelarReserva(id, usuarioId);
    }

    devolver(id) {
        return prestamoRepository.devolver(id);
    }
}

module.exports = new PrestamoService();
