const assert = require('node:assert/strict');
const { test } = require('node:test');
const { tarifaDiariaMora } = require('../../src/config/multas');
const {
    reglasPrestamo,
    admiteReservas,
    puedeRenovarPrestamo,
} = require('../../src/domain/circulacion');

function withFineRate(value, callback) {
    const previous = process.env.OVERDUE_FINE_DAILY_RATE;
    if (value === undefined) delete process.env.OVERDUE_FINE_DAILY_RATE;
    else process.env.OVERDUE_FINE_DAILY_RATE = value;
    try {
        callback();
    } finally {
        if (previous === undefined) delete process.env.OVERDUE_FINE_DAILY_RATE;
        else process.env.OVERDUE_FINE_DAILY_RATE = previous;
    }
}

test('default overdue fine rate is COP 2,000 per day', () => {
    withFineRate(undefined, () => assert.equal(tarifaDiariaMora(), 2000));
});

test('overdue fine rate accepts an explicit COP 2,000 setting', () => {
    withFineRate('2000', () => assert.equal(tarifaDiariaMora(), 2000));
});

test('overdue fine rate rejects zero, negative, fractional, and nonnumeric values', () => {
    for (const value of ['0', '-2000', '2000.5', 'invalid']) {
        withFineRate(value, () => {
            assert.throws(() => tarifaDiariaMora(), /entero positivo/);
        });
    }
});

test('General collection allows five renewals over a 15-day loan', () => {
    const rules = reglasPrestamo({ coleccion: 'General' });
    assert.equal(rules.diasRenovacion, 15);
    assert.equal(rules.renovaciones, 5);
});

test('Reserva collection has a five-day loan and no renewals', () => {
    const rules = reglasPrestamo({ coleccion: 'Reserva' });
    assert.equal(rules.diasRenovacion, 5);
    assert.equal(rules.renovaciones, 0);
});

test('Referencia collection allows at most two renewals', () => {
    const rules = reglasPrestamo({ coleccion: 'Referencia' });
    assert.equal(rules.diasRenovacion, 3);
    assert.equal(rules.renovaciones, 2);
});

test('Hemeroteca collection allows one renewal', () => {
    const rules = reglasPrestamo({ coleccion: 'Hemeroteca' });
    assert.equal(rules.diasRenovacion, 1);
    assert.equal(rules.renovaciones, 1);
});

test('Tecnoteca tablets allow reservations and at most two renewals', () => {
    const tablet = { coleccion: 'Tecnoteca', tipo_equipo: 'Tableta' };
    const rules = reglasPrestamo(tablet);
    assert.equal(rules.diasRenovacion, 7);
    assert.equal(rules.renovaciones, 2);
    assert.equal(admiteReservas(tablet), true);
    assert.equal(admiteReservas({ coleccion: 'Tecnoteca', tipo_equipo: 'Laptop' }), false);
});

test('Mapoteca loans are USB-only and cannot be renewed or reserved', () => {
    const mapoteca = { coleccion: 'Mapoteca' };
    const rules = reglasPrestamo(mapoteca);
    assert.equal(rules.renovaciones, 0);
    assert.equal(rules.medioEntrega, 'USB - solo lectura');
    assert.equal(admiteReservas(mapoteca), false);
});

test('renewal requires an active, unblocked loan with renewals remaining and no reservation', () => {
    const eligibleLoan = {
        estado: 'Activo',
        renovacionesRestantes: 1,
        tieneReserva: false,
        usuarioBloqueado: false,
        diasRenovacion: 15,
    };
    assert.equal(puedeRenovarPrestamo(eligibleLoan), true);

    for (const invalidState of [
        { estado: 'Devuelto' },
        { renovacionesRestantes: 0 },
        { tieneReserva: true },
        { usuarioBloqueado: true },
        { diasRenovacion: 0 },
    ]) {
        assert.equal(puedeRenovarPrestamo({ ...eligibleLoan, ...invalidState }), false);
    }
});
