-- RPC para setear el tenant_id en la sesión de Postgres.
-- SECURITY DEFINER permite que el rol anon pueda invocar set_config.
-- Esta función queda como referencia y para casos donde se quiera
-- setear el contexto manualmente, pero el flujo principal de búsqueda
-- usa search_tenant_documents (003_search.sql) que consolida ambas
-- operaciones en una sola transacción.
create or replace function public.set_tenant_context(tenant_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('request.tenant_id', tenant_id, true);
end;
$$;

grant execute on function public.set_tenant_context(text) to anon, authenticated;
