const multaRepository = require('../repositories/multaRepository');

class MultaService {
    obtenerTodas(usuarioId) {
        return multaRepository.obtenerTodas(usuarioId);
    }

    crear(multa) {
        return multaRepository.crear(multa);
    }

    marcarPagada(id) {
        return multaRepository.marcarPagada(id);
    }
}

module.exports = new MultaService();
