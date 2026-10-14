-- =====================================================================
-- Solo para Supabase: ejecutar DESPUÉS de schema.sql.
-- Garantiza que los roles de la API pública de Supabase (anon, authenticated,
-- service_role) no tengan ningún acceso al esquema privado "domino".
-- =====================================================================

REVOKE ALL ON SCHEMA domino FROM anon, authenticated, service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA domino FROM anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA domino FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA domino REVOKE ALL ON TABLES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA domino REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
