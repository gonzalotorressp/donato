import { readApiJson } from './apiJson';

export async function fetchPricePolicies(
  id: string, token: string, context: string | null | undefined,
  force: boolean, onProgress: (message: string) => void,
) {
  const query = new URLSearchParams({ id });
  if (context) query.set('context', context);
  if (force) query.set('force', '1');
  const startedAt = Date.now();
  for (let attempt = 0; attempt < 200; attempt++) {
    const response = await fetch('/api/sigma/politicas-articulo?' + query, {
      headers: { Authorization: 'Bearer ' + token }, cache: 'no-store',
    });
    const result = await readApiJson(response, 'No se pudieron consultar las políticas');
    if (response.status !== 202) return result;
    if (result.policiesReady) query.delete('force');
    const seconds = Math.max(1, Math.min(600, Number(result.retryAfter) || 3));
    if (Date.now() - startedAt + seconds * 1000 > 10 * 60 * 1000) break;
    onProgress((result.message || 'Actualizando políticas') + '. Reintento automático en ' + seconds + ' segundos.');
    await new Promise(resolve => setTimeout(resolve, seconds * 1000));
  }
  throw new Error('Sigma sigue ocupado. Volvé a consultar en unos minutos; se conservó el avance de la descarga');
}
