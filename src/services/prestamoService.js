const prestamoRepository = require('../repositories/prestamoRepository');

class PrestamoService {
    obtenerActivos(usuarioId) {
        return prestamoRepository.obtenerActivos(usuarioId);
    }

    obtenerTodos(usuarioId) {
        return prestamoRepository.obtenerTodos(usuarioId);
    }

    obtenerReservas(usuarioId) {
        return prestamoRepository.obtenerReservas(usuarioId);
    }

    renovar(id, usuarioId) {
        return prestamoRepository.renovar(id, usuarioId);
    }

    solicitar(usuarioId, recursoId, bibliotecarioId) {
        return prestamoRepository.solicitar(usuarioId, recursoId, bibliotecarioId);
    }

    reservar(usuarioId, recursoId) {
        return prestamoRepository.reservar(usuarioId, recursoId);
    }

    cancelarReserva(id, usuarioId) {
        return prestamoRepository.cancelarReserva(id, usuarioId);
    }

    devolver(id, bibliotecarioId) {
        return prestamoRepository.devolver(id, bibliotecarioId);
    }
}

module.exports = new PrestamoService();
