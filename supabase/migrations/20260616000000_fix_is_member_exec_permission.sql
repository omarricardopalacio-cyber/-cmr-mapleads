-- Las funciones SECURITY DEFINER son llamadas desde políticas RLS.
-- Aunque el cuerpo se ejecuta como owner, PostgreSQL requiere EXECUTE
-- privilege en el calling user (authenticated).
-- Ver: https://www.postgresql.org/docs/current/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY
GRANT EXECUTE ON FUNCTION public.is_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, UUID, public.app_role) TO authenticated;
