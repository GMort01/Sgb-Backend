-- Add pickup holds for General Collection while preserving existing wait-list entries.
BEGIN;

ALTER TABLE public.reservas
    ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'Espera';

ALTER TABLE public.reservas
    ADD COLUMN IF NOT EXISTS vence_en TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.reservas'::REGCLASS
          AND conname = 'reservas_estado_valido'
    ) THEN
        ALTER TABLE public.reservas
            ADD CONSTRAINT reservas_estado_valido
            CHECK (estado IN ('Espera', 'Apartada'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.reservas'::REGCLASS
          AND conname = 'reservas_estado_vencimiento_coherentes'
    ) THEN
        ALTER TABLE public.reservas
            ADD CONSTRAINT reservas_estado_vencimiento_coherentes
            CHECK (
                (estado = 'Espera' AND vence_en IS NULL)
                OR (estado = 'Apartada' AND vence_en IS NOT NULL)
            );
    END IF;
END
$$;

DROP INDEX IF EXISTS public.idx_reservas_recurso_posicion;
CREATE INDEX idx_reservas_recurso_posicion
    ON public.reservas (recurso_id, estado, posicion, fecha_reserva);
CREATE INDEX IF NOT EXISTS idx_reservas_apartadas_vencimiento
    ON public.reservas (vence_en)
    WHERE estado = 'Apartada';

COMMIT;
