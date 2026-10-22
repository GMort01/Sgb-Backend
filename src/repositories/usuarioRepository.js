const db = require('../config/database');

class UsuarioRepository {
    obtenerTodos() {
        return new Promise((resolve, reject) => {
            db.all(
                'SELECT id, identificacion, codigo, nombres, apellidos, correo, rol FROM usuarios ORDER BY apellidos, nombres',
                [],
                (error, rows) => {
                    if (error) reject(error);
                    else resolve(rows);
                },
            );
        });
    }

    crear(usuario) {
        return new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO usuarios (identificacion, codigo, nombres, apellidos, correo, rol)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    usuario.identificacion,
                    usuario.codigo,
                    usuario.nombres,
                    usuario.apellidos,
                    usuario.correo,
                    usuario.rol,
                ],
                function (error) {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve({ id: this.lastID, ...usuario });
                },
            );
        });
    }
}

module.exports = new UsuarioRepository();
