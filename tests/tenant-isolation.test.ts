import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const TENANT_A = '2929e880-f7e3-4d12-adf8-34da1807234b';
const TENANT_B = '72743cfc-7f09-4464-bade-fbc2c80b8f8f';
const NONEXISTENT_TENANT = '00000000-0000-0000-0000-000000000000';

// Pregunta genérica que matchea documentos en ambos tenants (OR semantics en search_tenant_documents)
const QUERY = 'política horario';

type TestResult = { name: string; passed: boolean; details: string };
const results: TestResult[] = [];

function assert(name: string, condition: boolean, details: string) {
  results.push({ name, passed: condition, details });
  const icon = condition ? '✅' : '❌';
  console.log(`${icon} ${name}`);
  console.log(`   ${details}\n`);
}

async function runTests() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    console.error('Missing Supabase env vars');
    process.exit(1);
  }

  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log('🔒 Test de aislamiento de tenants\n');
  console.log('='.repeat(50) + '\n');

  // Test 1: Empresa A solo ve sus documentos
  const { data: docsA, error: errorA } = await supabase.rpc('search_tenant_documents', {
    p_tenant_id: TENANT_A,
    query_text: QUERY,
    max_results: 10,
  });

  if (errorA) {
    console.error('Error consultando como Empresa A:', errorA);
    process.exit(1);
  }

  const allFromA =
    docsA?.every((d: { tenant_id: string }) => d.tenant_id === TENANT_A) ?? false;
  assert(
    'Empresa A solo ve documentos con tenant_id = TENANT_A',
    allFromA && (docsA?.length ?? 0) > 0,
    `Encontrados ${docsA?.length ?? 0} documentos. Todos pertenecen a A: ${allFromA}`,
  );

  // Test 2: Empresa B solo ve sus documentos
  const { data: docsB, error: errorB } = await supabase.rpc('search_tenant_documents', {
    p_tenant_id: TENANT_B,
    query_text: QUERY,
    max_results: 10,
  });

  if (errorB) {
    console.error('Error consultando como Empresa B:', errorB);
    process.exit(1);
  }

  const allFromB =
    docsB?.every((d: { tenant_id: string }) => d.tenant_id === TENANT_B) ?? false;
  assert(
    'Empresa B solo ve documentos con tenant_id = TENANT_B',
    allFromB && (docsB?.length ?? 0) > 0,
    `Encontrados ${docsB?.length ?? 0} documentos. Todos pertenecen a B: ${allFromB}`,
  );

  // Test 3: Tenant inexistente no ve nada
  const { data: docsNone, error: errorNone } = await supabase.rpc('search_tenant_documents', {
    p_tenant_id: NONEXISTENT_TENANT,
    query_text: QUERY,
    max_results: 10,
  });

  if (errorNone) {
    console.error('Error consultando con tenant inexistente:', errorNone);
    process.exit(1);
  }

  assert(
    'Tenant inexistente no retorna documentos',
    (docsNone?.length ?? 0) === 0,
    `Documentos retornados: ${docsNone?.length ?? 0} (esperado 0)`,
  );

  // Test 4: Sets de A y B son disjuntos
  const idsA = new Set(docsA?.map((d: { id: string }) => d.id) ?? []);
  const idsB = new Set(docsB?.map((d: { id: string }) => d.id) ?? []);
  const intersection = [...idsA].filter((id) => idsB.has(id));

  assert(
    'Documentos de A y B son disjuntos (cero intersección)',
    intersection.length === 0,
    `Intersección: ${intersection.length} documentos compartidos (esperado 0)`,
  );

  // Test 5 (bonus): Validación de RLS sin GUC seteado
  // SELECT directo sin RPC. Debe retornar 0 filas porque RLS bloquea
  // cuando current_setting('request.tenant_id') es NULL.
  const { data: directQuery, error: directError } = await supabase
    .from('documents')
    .select('*')
    .limit(10);

  if (directError) {
    console.error('Error en query directa:', directError);
  }

  assert(
    'Query directa sin GUC seteado retorna 0 filas (RLS funcionando)',
    (directQuery?.length ?? 0) === 0,
    `Documentos visibles sin contexto de tenant: ${directQuery?.length ?? 0} (esperado 0)`,
  );

  // Resumen
  console.log('='.repeat(50));
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log(`\n${passed}/${total} tests pasaron\n`);

  if (passed < total) {
    console.error('❌ Algunos tests fallaron');
    process.exit(1);
  }

  console.log('✅ Todos los tests de aislamiento pasaron');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Error inesperado:', err);
  process.exit(1);
});
