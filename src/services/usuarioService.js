const usuarioRepository = require('../repositories/usuarioRepository');
const bcrypt = require('bcryptjs');

class UsuarioService {
    obtenerTodos() {
        return usuarioRepository.obtenerTodos();
    }

    crear(usuario) {
        return bcrypt.hash(usuario.password, 12).then((passwordHash) => {
            const { password, ...perfil } = usuario;
            return usuarioRepository.crear({ ...perfil, passwordHash });
        });
    }
}

module.exports = new UsuarioService();
