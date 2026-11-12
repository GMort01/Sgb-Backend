const prestamoRepository = require('../repositories/prestamoRepository');

class PrestamoService {
    obtenerActivos(usuarioId) {
        return prestamoRepository.obtenerActivos(usuarioId);
    }

    obtenerTodos(usuarioId) {
        return prestamoRepository.obtenerTodos(usuarioId);
    }

    obtenerReservas(usuarioId) {
        return this.expirarApartadosVencidos()
            .then(() => prestamoRepository.obtenerReservas(usuarioId));
    }

    expirarApartadosVencidos() {
        return prestamoRepository.expirarApartadosVencidos();
    }

    renovar(id, usuarioId) {
        return prestamoRepository.renovar(id, usuarioId);
    }

    solicitar(usuarioId, recursoId, bibliotecarioId) {
        return this.expirarApartadosVencidos()
            .then(() => prestamoRepository.solicitar(usuarioId, recursoId, bibliotecarioId));
    }

    reservar(usuarioId, recursoId) {
        return this.expirarApartadosVencidos()
            .then(() => prestamoRepository.reservar(usuarioId, recursoId));
    }

    cancelarReserva(id, usuarioId) {
        return this.expirarApartadosVencidos()
            .then(() => prestamoRepository.cancelarReserva(id, usuarioId));
    }

    devolver(id, bibliotecarioId) {
        return this.expirarApartadosVencidos()
            .then(() => prestamoRepository.devolver(id, bibliotecarioId));
    }
}

module.exports = new PrestamoService();
