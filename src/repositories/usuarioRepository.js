const { all, run } = require('./transaction');

class UsuarioRepository {
    obtenerTodos() {
        return all(
            'SELECT id, identificacion, codigo, nombres, apellidos, correo, rol, plan, semestre FROM usuarios ORDER BY apellidos, nombres',
        );
    }

    async crear(usuario) {
        const result = await run(
            `INSERT INTO usuarios
                (identificacion, codigo, nombres, apellidos, correo, rol, plan, semestre, password_hash)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             RETURNING id`,
            [
                usuario.identificacion,
                usuario.codigo,
                usuario.nombres,
                usuario.apellidos,
                usuario.correo,
                usuario.rol,
                usuario.plan || null,
                usuario.semestre || null,
                usuario.passwordHash,
            ],
        );
        const { passwordHash, ...perfil } = usuario;
        return { id: result.rows[0].id, ...perfil };
    }
}

module.exports = new UsuarioRepository();
