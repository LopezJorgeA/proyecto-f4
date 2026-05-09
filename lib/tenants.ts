import { createSupabaseAdmin } from './supabase/admin';
import { Errors } from './errors';

/**
 * Verifica que el tenant existe.
 * Usa el cliente admin (bypasea RLS) porque la policy de tenants permite
 * lectura abierta, pero queremos garantizar que esta validación nunca
 * falle por contexto de RLS.
 */
export async function assertTenantExists(tenantId: string): Promise<void> {
  const supabase = createSupabaseAdmin();

  const { data, error } = await supabase
    .from('tenants')
    .select('id')
    .eq('id', tenantId)
    .maybeSingle();

  if (error) {
    throw Errors.databaseError(`Error verificando tenant: ${error.message}`);
  }

  if (!data) {
    throw Errors.tenantNotFound(tenantId);
  }
}