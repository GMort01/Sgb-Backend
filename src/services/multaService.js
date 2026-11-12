const multaRepository = require('../repositories/multaRepository');

class MultaService {
    obtenerTodas(usuarioId) {
        return multaRepository.obtenerTodas(usuarioId);
    }

    crear(multa) {
        return multaRepository.crear(multa);
    }

    marcarPagada(id, usuarioId) {
        return multaRepository.marcarPagada(id, usuarioId);
    }
}

module.exports = new MultaService();
