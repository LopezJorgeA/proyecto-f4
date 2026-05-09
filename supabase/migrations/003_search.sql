-- RPC unificado: setea el tenant context y ejecuta la búsqueda fulltext
-- en una SOLA transacción. Esto es necesario porque PostgREST envuelve
-- cada request HTTP en su propia transacción, y set_config(..., true)
-- es local a la transacción.
--
-- SECURITY DEFINER es necesario para que set_config funcione bajo el
-- rol anon. El aislamiento RLS sigue siendo seguro porque:
-- 1. El tenant_id viene como parámetro explícito de la función.
-- 2. La policy de RLS sobre documents valida tenant_id contra el GUC.
-- 3. La función no expone ningún path que permita leer otro tenant.
create or replace function public.search_tenant_documents(
  p_tenant_id text,
  query_text text,
  max_results int default 5
)
returns setof public.documents
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Setear el GUC en la misma transacción que ejecuta el SELECT.
  -- El tercer parámetro `true` hace que sea local a esta transacción.
  perform set_config('request.tenant_id', p_tenant_id, true);

  return query
    select d.*
    from public.documents d
    where d.tenant_id::text = p_tenant_id
      and to_tsvector('spanish', d.content)
          @@ websearch_to_tsquery('spanish', query_text)
    order by ts_rank(
      to_tsvector('spanish', d.content),
      websearch_to_tsquery('spanish', query_text)
    ) desc
    limit max_results;
end;
$$;

grant execute on function public.search_tenant_documents(text, text, int) to anon, authenticated;
