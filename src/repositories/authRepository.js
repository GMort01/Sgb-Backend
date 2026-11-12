const { get } = require('./transaction');

class AuthRepository {
    buscarPorCorreo(correo) {
        return get(
            `SELECT id, identificacion, codigo, nombres, apellidos, correo, rol,
                plan, semestre, password_hash AS "passwordHash"
             FROM usuarios WHERE correo = ?`,
            [correo],
        );
    }

    buscarPorId(id) {
        return get(
            `SELECT id, identificacion, codigo, nombres, apellidos, correo, rol, plan, semestre
             FROM usuarios WHERE id = ?`,
            [id],
        );
    }
}

module.exports = new AuthRepository();
