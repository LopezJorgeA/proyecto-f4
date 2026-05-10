import { createSupabaseAdmin } from '../lib/supabase/admin';

type SeedDocument = {
  content: string;
};

const empresaADocs: SeedDocument[] = [
  { content: 'Política de devoluciones de Empresa A: aceptamos devoluciones dentro de 30 días posteriores a la compra, siempre que el producto no haya sido usado y se presente el ticket original.' },
  { content: 'Horario de atención de Empresa A: lunes a viernes de 9:00 a 18:00 horas, sábados de 10:00 a 14:00 horas. Cerrado los domingos y días festivos oficiales.' },
  { content: 'Métodos de pago aceptados en Empresa A: tarjetas de crédito Visa, Mastercard y American Express, transferencia SPEI, efectivo en tienda y pagos a meses sin intereses con bancos participantes.' },
  { content: 'Garantía de productos en Empresa A: todos los productos cuentan con garantía de fábrica de 12 meses. Para hacer válida la garantía es necesario presentar el ticket de compra y el producto en su empaque original.' },
  { content: 'Envíos de Empresa A: realizamos envíos a toda la república mexicana con un costo fijo de 150 pesos. Envíos gratis en compras mayores a 1,500 pesos. Tiempo de entrega de 3 a 5 días hábiles.' },
];

const empresaBDocs: SeedDocument[] = [
  { content: 'Política de devoluciones de Empresa B: aceptamos devoluciones dentro de 15 días posteriores a la compra. El producto debe estar sellado y con etiquetas originales para proceder con el reembolso.' },
  { content: 'Horario de atención de Empresa B: atención 24/7 a través de chat en línea y teléfono. Oficinas físicas abiertas de lunes a sábado de 8:00 a 20:00 horas.' },
  { content: 'Métodos de pago aceptados en Empresa B: únicamente pagos digitales, incluyendo tarjetas de crédito y débito, PayPal, Mercado Pago y criptomonedas seleccionadas como Bitcoin y Ethereum.' },
  { content: 'Programa de lealtad de Empresa B: por cada 100 pesos de compra se acumula 1 punto. Los puntos pueden canjearse por descuentos, productos exclusivos o experiencias premium del catálogo de recompensas.' },
  { content: 'Envíos internacionales de Empresa B: enviamos a más de 50 países con tarifas dinámicas según destino y peso. Tiempo de entrega de 7 a 21 días hábiles dependiendo de la ubicación y trámites aduanales.' },
];

async function seed() {
  const supabase = createSupabaseAdmin();

  console.log('Limpiando datos previos...');
  await supabase.from('documents').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('tenants').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  console.log('Insertando tenants...');
  const { data: tenants, error: tenantsError } = await supabase
    .from('tenants')
    .insert([
      { name: 'Empresa A' },
      { name: 'Empresa B' },
    ])
    .select();

  if (tenantsError || !tenants) {
    throw new Error(`Error insertando tenants: ${tenantsError?.message}`);
  }

  const empresaA = tenants.find((t) => t.name === 'Empresa A');
  const empresaB = tenants.find((t) => t.name === 'Empresa B');

  if (!empresaA || !empresaB) {
    throw new Error('No se pudieron localizar los tenants creados');
  }

  console.log(`Empresa A: ${empresaA.id}`);
  console.log(`Empresa B: ${empresaB.id}`);

  console.log('Insertando documentos de Empresa A...');
  const { error: docsAError } = await supabase
    .from('documents')
    .insert(empresaADocs.map((d) => ({ ...d, tenant_id: empresaA.id })));

  if (docsAError) {
    throw new Error(`Error insertando documentos A: ${docsAError.message}`);
  }

  console.log('Insertando documentos de Empresa B...');
  const { error: docsBError } = await supabase
    .from('documents')
    .insert(empresaBDocs.map((d) => ({ ...d, tenant_id: empresaB.id })));

  if (docsBError) {
    throw new Error(`Error insertando documentos B: ${docsBError.message}`);
  }

  console.log('\nSeed completado correctamente.');
  console.log(`\nIDs para tus tests y queries:`);
  console.log(`  Empresa A: ${empresaA.id}`);
  console.log(`  Empresa B: ${empresaB.id}`);
}

seed().catch((err) => {
  console.error('Seed falló:', err);
  process.exit(1);
});