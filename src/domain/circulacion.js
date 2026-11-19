function reglasPrestamo(recurso) {
    const coleccion = recurso.coleccion;
    const dias = coleccion === 'General' ? 15
        : coleccion === 'Reserva' ? 5
            : coleccion === 'Referencia' ? 3
                : coleccion === 'Hemeroteca' || coleccion === 'Mapoteca' ? 1
                    : 7;
    const fechaDevolucion = coleccion === 'Mapoteca'
        ? "(((CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::DATE + 1) + TIME '21:00')::TEXT"
        : `((CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota') + INTERVAL '${dias} days')::TEXT`;
    const renovaciones = coleccion === 'General' ? 5
        : coleccion === 'Referencia' ? 2
            : coleccion === 'Hemeroteca' ? 1
                : coleccion === 'Tecnoteca' ? 2 : 0;
    return {
        fechaDevolucion,
        diasRenovacion: dias,
        renovaciones,
        medioEntrega: coleccion === 'Mapoteca' ? 'USB - solo lectura' : 'Regular',
    };
}

function admiteReservas(recurso) {
    return recurso.coleccion === 'General'
        || (recurso.coleccion === 'Tecnoteca' && recurso.tipo_equipo === 'Tableta');
}

function puedeRenovarPrestamo({
    estado,
    renovacionesRestantes,
    tieneReserva,
    usuarioBloqueado,
    diasRenovacion,
}) {
    return estado === 'Activo'
        && Number.isSafeInteger(renovacionesRestantes)
        && renovacionesRestantes > 0
        && Number.isSafeInteger(diasRenovacion)
        && diasRenovacion > 0
        && !tieneReserva
        && !usuarioBloqueado;
}

module.exports = { reglasPrestamo, admiteReservas, puedeRenovarPrestamo };
