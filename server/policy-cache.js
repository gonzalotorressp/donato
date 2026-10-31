// Cache credentials stay on the server; no service-role key is required.
export async function policyCacheRpc(request, action, values = {}) {
  const base = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const secret = process.env.DONATO_POLICY_CACHE_SECRET;
  if (!base || !key || !secret) throw new Error('Falta configuración de caché de políticas');
  const response = await fetch(`${base}/rest/v1/rpc/donato_policy_cache`, {
    method: 'POST',
    headers: { apikey: key, Authorization: request.headers.authorization || request.headers.Authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ p_action: action, p_secret: secret, ...values }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Caché de políticas no disponible (HTTP ${response.status})`);
  return response.json();
}

export async function sigmaJson(url, token, signal, label) {
  const response = await fetch(url, {
    headers: { 'X-Auth-Token': token, accept: 'application/json' }, signal,
  });
  if (!response.ok) throw new Error(response.status === 429
    ? 'Sigma limitó las consultas (HTTP 429). Esperá un momento y volvé a intentar'
    : `${label}: Sigma respondió HTTP ${response.status}`);
  let data;
  try { data = await response.json(); }
  catch { throw new Error(`${label}: Sigma devolvió una respuesta no JSON`); }
  if (!Array.isArray(data)) throw new Error(`${label}: formato de Sigma no reconocido`);
  return data;
}

export async function getPolicies(request, token, force, signal) {
  const snapshot = await policyCacheRpc(request, 'claim', { p_force: force });
  if (snapshot.cached) {
    if (!Array.isArray(snapshot.rows) || !snapshot.updatedAt) throw new Error('Caché de políticas inválida');
    return snapshot;
  }
  if (!snapshot.lease) {
    const error = new Error('Las políticas se están actualizando. Volvé a consultar en unos segundos');
    error.status = 503;
    throw error;
  }
  let published = false;
  try {
    const rows = [];
    for (let page = 1; page <= 10; page++) {
      const url = new URL('https://secure.sig2k.com/sigmasaas/sanpablo@sigma/sigma/api/v10/ExportPoliticasDescuento');
      url.searchParams.set('page', String(page));
      url.searchParams.set('pagesize', '1000');
      const batch = await sigmaJson(url, token, AbortSignal.any([signal, AbortSignal.timeout(15000)]), 'Políticas');
      rows.push(...batch);
      if (batch.length < 1000) {
        const saved = await policyCacheRpc(request, 'publish', { p_lease: snapshot.lease, p_payload: rows });
        published = true;
        return { rows, complete: true, updatedAt: saved.updatedAt, cached: false };
      }
    }
    throw new Error('La exportación de políticas excedió el límite de páginas. Se conservó la última caché completa');
  } finally {
    if (!published) {
      try { await policyCacheRpc(request, 'release', { p_lease: snapshot.lease }); }
      catch { console.error('No se pudo liberar la actualización de políticas; el bloqueo vencerá automáticamente'); }
    }
  }
}
