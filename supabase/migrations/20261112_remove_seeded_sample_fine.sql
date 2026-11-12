-- Remove only the sample overdue fine created by the original setup.sql.
-- Real fines entered by library staff are left untouched.
BEGIN;

DELETE FROM public.multas AS multa
USING public.usuarios AS usuario
WHERE multa.usuario_id = usuario.id
  AND usuario.correo = 'valeria.demo@example.test'
  AND multa.concepto = 'Retraso en devolución (ejemplo de demostración)'
  AND multa.monto = 2500
  AND multa.estado = 'Pendiente'
RETURNING multa.id;

COMMIT;
