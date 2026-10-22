const db = require('../config/database');

class MultaRepository {
    obtenerTodas() {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT id, usuario, concepto, monto, fecha, estado
                 FROM multas
                 ORDER BY CASE estado WHEN 'Pendiente' THEN 0 ELSE 1 END, fecha DESC, id DESC`,
                [],
                (error, rows) => {
                    if (error) reject(error);
                    else resolve(rows);
                },
            );
        });
    }

    crear(multa) {
        return new Promise((resolve, reject) => {
            db.run(
                'INSERT INTO multas (usuario, concepto, monto, fecha, estado) VALUES (?, ?, ?, ?, ?)',
                [multa.usuario, multa.concepto, multa.monto, multa.fecha, 'Pendiente'],
                function (error) {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve({ id: this.lastID, ...multa, estado: 'Pendiente' });
                },
            );
        });
    }

    marcarPagada(id) {
        return new Promise((resolve, reject) => {
            db.run(
                "UPDATE multas SET estado = 'Pagada' WHERE id = ? AND estado = 'Pendiente'",
                [id],
                function (error) {
                    if (error) {
                        reject(error);
                        return;
                    }
                    if (this.changes === 0) {
                        resolve(null);
                        return;
                    }
                    db.get('SELECT id, usuario, concepto, monto, fecha, estado FROM multas WHERE id = ?', [id], (selectError, row) => {
                        if (selectError) reject(selectError);
                        else resolve(row);
                    });
                },
            );
        });
    }
}

module.exports = new MultaRepository();
