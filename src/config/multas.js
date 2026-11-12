function tarifaDiariaMora() {
    const raw = process.env.OVERDUE_FINE_DAILY_RATE;
    const tarifa = raw === undefined || raw.trim() === '' ? 2000 : Number(raw);
    if (!Number.isSafeInteger(tarifa) || tarifa <= 0) {
        throw new Error('OVERDUE_FINE_DAILY_RATE debe ser un entero positivo en pesos.');
    }
    return tarifa;
}

module.exports = { tarifaDiariaMora };
