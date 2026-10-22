const usuarioRepository = require('../repositories/usuarioRepository');

class UsuarioService {
    obtenerTodos() {
        return usuarioRepository.obtenerTodos();
    }

    crear(usuario) {
        return usuarioRepository.crear(usuario);
    }
}

module.exports = new UsuarioService();
