const db = require('../config/database');

function execute(method, sql, values = []) {
    return new Promise((resolve, reject) => {
        db[method](sql, values, function (error, result) {
            if (error) {
                reject(error);
                return;
            }
            resolve(method === 'run' ? this : method === 'get' ? result : result);
        });
    });
}

const run = (sql, values) => execute('run', sql, values);
const get = (sql, values) => execute('get', sql, values);
const all = (sql, values) => execute('all', sql, values);

let pendingTransaction = Promise.resolve();

function transaction(work) {
    const result = pendingTransaction.then(async () => {
        await run('BEGIN IMMEDIATE');
        try {
            const result = await work({ run, get, all });
            await run('COMMIT');
            return result;
        } catch (error) {
            await run('ROLLBACK');
            throw error;
        }
    });
    pendingTransaction = result.then(() => undefined, () => undefined);
    return result;
}

module.exports = { all, get, run, transaction };
