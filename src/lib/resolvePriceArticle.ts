import type { SupabaseClient } from '@supabase/supabase-js';

export async function resolvePriceArticle(client: SupabaseClient, input: string): Promise<string> {
  const value = input.trim();
  if (!/^\d{1,14}$/.test(value)) throw new Error('Ingresá un código Sigma o EAN válido');
  // Short Sigma codes cannot be EANs. For overlapping lengths, look up both
  // the article code and barcodes, rejecting ambiguous matches.
  if (value.length < 8) return value;
  const { data, error } = await client.rpc('donato_price_resolve_article', { p_codigo: value });
  if (error || !Array.isArray(data)) throw new Error('No se pudo resolver el código o EAN en el maestro de artículos');
  const codes = [...new Set(data.map((row: { articulo_codigo: unknown }) => String(row.articulo_codigo).trim()))];
  if (codes.length > 1) throw new Error('El código o EAN coincide con varios artículos. Revisá el código o escaneá otro EAN');
  if (codes.length === 1) {
    if (!/^\d{1,12}$/.test(codes[0])) throw new Error('El EAN no tiene un código Sigma válido asociado');
    return codes[0];
  }
  if (value.length <= 12) return value;
  throw new Error('EAN no encontrado en el maestro de artículos');
}
