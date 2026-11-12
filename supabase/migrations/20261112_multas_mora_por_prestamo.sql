ALTER TABLE public.multas
    ADD COLUMN IF NOT EXISTS prestamo_id INTEGER REFERENCES public.prestamos(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_multas_prestamo_fecha
    ON public.multas (prestamo_id, fecha)
    WHERE prestamo_id IS NOT NULL;
