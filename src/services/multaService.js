const multaRepository = require('../repositories/multaRepository');
const { tarifaDiariaMora } = require('../config/multas');

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

    generarMultasPorMora() {
        return multaRepository.generarMultasPorMora(tarifaDiariaMora());
    }

}

module.exports = new MultaService();
