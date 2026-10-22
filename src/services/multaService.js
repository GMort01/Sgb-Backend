const multaRepository = require('../repositories/multaRepository');

class MultaService {
    obtenerTodas() {
        return multaRepository.obtenerTodas();
    }

    crear(multa) {
        return multaRepository.crear(multa);
    }

    marcarPagada(id) {
        return multaRepository.marcarPagada(id);
    }
}

module.exports = new MultaService();
