async function cleanupTestData(db, {
    userPattern,
    resourcePattern,
    finePattern,
    activityPattern,
}) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');
        await client.query(
            `DELETE FROM public.multas
             WHERE concepto LIKE $1
                OR usuario_id IN (
                    SELECT id FROM public.usuarios WHERE identificacion LIKE $2
                )
                OR prestamo_id IN (
                    SELECT p.id
                    FROM public.prestamos p
                    LEFT JOIN public.recursos r ON r.id = p.recurso_id
                    WHERE p.usuario_id IN (
                        SELECT id FROM public.usuarios WHERE identificacion LIKE $2
                    ) OR r.titulo LIKE $3
                )`,
            [finePattern, userPattern, resourcePattern],
        );
        await client.query(
            `DELETE FROM public.reservas
             WHERE usuario_id IN (
                    SELECT id FROM public.usuarios WHERE identificacion LIKE $1
                )
                OR recurso_id IN (
                    SELECT id FROM public.recursos WHERE titulo LIKE $2
                )`,
            [userPattern, resourcePattern],
        );
        await client.query(
            `DELETE FROM public.inscripciones_actividades
             WHERE actividad_id IN (
                    SELECT id FROM public.actividades WHERE titulo LIKE $1
                )
                OR usuario_id IN (
                    SELECT id FROM public.usuarios WHERE identificacion LIKE $2
                )`,
            [activityPattern, userPattern],
        );
        await client.query(
            `DELETE FROM public.prestamos
             WHERE usuario_id IN (
                    SELECT id FROM public.usuarios WHERE identificacion LIKE $1
                )
                OR recurso_id IN (
                    SELECT id FROM public.recursos WHERE titulo LIKE $2
                )`,
            [userPattern, resourcePattern],
        );
        await client.query('DELETE FROM public.actividades WHERE titulo LIKE $1', [activityPattern]);
        await client.query('DELETE FROM public.recursos WHERE titulo LIKE $1', [resourcePattern]);
        await client.query('DELETE FROM public.usuarios WHERE identificacion LIKE $1', [userPattern]);
        await client.query('COMMIT');
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch (rollbackError) {
            throw new AggregateError(
                [error, rollbackError],
                'La limpieza de pruebas falló y tampoco se pudo revertir.',
            );
        }
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { cleanupTestData };
