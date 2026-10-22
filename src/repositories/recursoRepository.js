const db = require('../config/database');

class RecursoRepository {
    obtenerTodos() {
        return new Promise((resolve, reject) => {
            db.all(
                'SELECT id, titulo, autor, coleccion, ejemplares, estado FROM recursos ORDER BY id DESC',
                [],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                },
            );
        });
    }

    crear(recurso) {
        return new Promise((resolve, reject) => {
            const disponible = recurso.estado === 'Disponible' ? 1 : 0;
            db.run(
                `INSERT INTO recursos (titulo, autor, coleccion, ejemplares, estado, disponible)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    recurso.titulo,
                    recurso.autor || null,
                    recurso.coleccion,
                    recurso.ejemplares,
                    recurso.estado,
                    disponible,
                ],
                function (err) {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve({ id: this.lastID, ...recurso });
                },
            );
        });
    }
}

module.exports = new RecursoRepository();