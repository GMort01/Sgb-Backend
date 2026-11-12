const db = require('../config/database');

function parameterize(sql) {
    let parameter = 0;
    return sql.replace(/\?/g, () => `$${++parameter}`);
}

async function query(client, sql, values = []) {
    return client.query(parameterize(sql), values);
}

async function all(sql, values = []) {
    const result = await query(db, sql, values);
    return result.rows;
}

async function get(sql, values = []) {
    const result = await query(db, sql, values);
    return result.rows[0] ?? null;
}

async function run(sql, values = []) {
    const result = await query(db, sql, values);
    return { changes: result.rowCount, rows: result.rows };
}

async function transaction(work) {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const transactionQuery = {
            all: async (sql, values = []) => (await query(client, sql, values)).rows,
            get: async (sql, values = []) => (await query(client, sql, values)).rows[0] ?? null,
            run: async (sql, values = []) => {
                const result = await query(client, sql, values);
                return { changes: result.rowCount, rows: result.rows };
            },
        };
        const result = await work(transactionQuery);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch (rollbackError) {
            throw new AggregateError(
                [error, rollbackError],
                'La transacción falló y también falló su reversión.',
            );
        }
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { all, get, run, transaction };
