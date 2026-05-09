import { createSupabaseClient } from './supabase/server';
import { Errors } from './errors';
import { DocumentSchema, type Document } from './schemas';

const MAX_RESULTS = 5;

/**
 * Busca documentos relevantes para una pregunta dentro de un tenant.
 *
 * Usa la RPC search_tenant_documents que consolida set_tenant_context y la
 * búsqueda fulltext en una sola transacción. Esto es necesario porque
 * PostgREST envuelve cada request HTTP en su propia transacción y
 * set_config(..., true) es local a la transacción.
 *
 * Aislamiento garantizado a nivel DB:
 * 1. La RPC filtra explícitamente por tenant_id (defense-in-depth).
 * 2. La RLS policy sobre documents filtra por current_setting('request.tenant_id').
 * 3. Ambas defensas activas en la misma transacción.
 */
export async function searchRelevantDocuments(
  question: string,
  tenantId: string,
): Promise<Document[]> {
  const supabase = createSupabaseClient();

  const { data, error } = await supabase.rpc('search_tenant_documents', {
    p_tenant_id: tenantId,
    query_text: question,
    max_results: MAX_RESULTS,
  });

  if (error) {
    throw Errors.databaseError(`Error en búsqueda: ${error.message}`);
  }

  // Validación con Zod en runtime para detectar drift de schema.
  const rows = (data ?? []) as unknown[];
  return rows.map((row) => DocumentSchema.parse(row));
}
