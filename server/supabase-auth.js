const supabaseUrl = process.env.VITE_SUPABASE_URL;
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

function bearer(request) {
  const header = request.headers?.authorization || request.headers?.Authorization || '';
  return String(header).startsWith('Bearer ') ? String(header).slice(7) : null;
}

function apiHeaders(request, extra = {}) {
  const token = bearer(request);
  if (!token || !supabaseUrl || !publishableKey) return null;
  return {
    apikey: publishableKey,
    Authorization: `Bearer ${token}`,
    accept: 'application/json',
    ...extra,
  };
}

export async function requireAuthenticatedUser(request) {
  if (!supabaseUrl || !publishableKey) throw new Error('Falta configuración Supabase');
  const headers = apiHeaders(request);
  if (!headers) return null;

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, { headers });
  if (!response.ok) return null;
  return response.json();
}

const CLOSURE_SELECT = [
  'id',
  'fecha',
  'usuario_sigma_codigo',
  'usuario_sigma_nombre',
  'caja_codigo',
  'cierre_nro',
  'estado',
  'supervisor_user_id',
  'carga_ciega_cerrada_at',
  'submitted_at',
  'declaracion_ciega',
  'declaracion_ciega_inicial',
  'revision_supervisor_count',
  'diferencias_supervisor',
  'conceptos_ok',
  'caja_ok',
  'tolerancia_caja_aplicada',
  'administrativo_ok',
  'reti_pendiente_entrada',
  'reti_pendiente_salida',
  'reti_baseline_cierre_id',
  'reti_conciliacion',
  'corte_desde_at',
  'corte_hasta_at',
  'sigma_snapshot_acumulado',
  'sigma_snapshot_tramo',
  'sigma_baseline_cierre_id',
  'sigma_snapshot_capturado_at',
  'created_at',
].join(',');

export async function getClosureForUser(request, cierreId) {
  const headers = apiHeaders(request);
  if (!headers) return null;

  const url = new URL(`${supabaseUrl}/rest/v1/donato_cierres_caja`);
  url.searchParams.set('id', `eq.${cierreId}`);
  url.searchParams.set('select', CLOSURE_SELECT);

  const response = await fetch(url, { headers });
  if (!response.ok) return null;
  const rows = await response.json();
  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function getClosuresForDate(request, fecha) {
  const headers = apiHeaders(request);
  if (!headers) return [];

  const url = new URL(`${supabaseUrl}/rest/v1/donato_cierres_caja`);
  url.searchParams.set('fecha', `eq.${fecha}`);
  url.searchParams.set('select', CLOSURE_SELECT);
  url.searchParams.set('order', 'usuario_sigma_codigo.asc,cierre_nro.asc,created_at.asc');

  const response = await fetch(url, { headers });
  if (!response.ok) return [];
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

export async function getPreviousFrozenClosure(request, cierre) {
  const headers = apiHeaders(request);
  if (!headers || !cierre?.fecha || cierre?.usuario_sigma_codigo === undefined) return null;

  const url = new URL(`${supabaseUrl}/rest/v1/donato_cierres_caja`);
  url.searchParams.set('fecha', `eq.${cierre.fecha}`);
  url.searchParams.set('usuario_sigma_codigo', `eq.${Number(cierre.usuario_sigma_codigo)}`);
  url.searchParams.set('cierre_nro', `lt.${Number(cierre.cierre_nro || 1)}`);
  url.searchParams.set('estado', 'neq.CANCELADO');
  url.searchParams.set('select', 'id,cierre_nro,corte_hasta_at,sigma_snapshot_acumulado,sigma_snapshot_capturado_at');
  url.searchParams.set('order', 'cierre_nro.desc,created_at.desc');
  url.searchParams.set('limit', '1');

  const response = await fetch(url, { headers });
  if (!response.ok) return null;
  const rows = await response.json();
  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function getPreviousCashboxClosure(request, cierre) {
  const headers = apiHeaders(request);
  if (!headers || !cierre?.fecha || !Number(cierre?.caja_codigo)) return null;

  const url = new URL(`${supabaseUrl}/rest/v1/donato_cierres_caja`);
  url.searchParams.set('fecha', `eq.${cierre.fecha}`);
  url.searchParams.set('caja_codigo', `eq.${Number(cierre.caja_codigo)}`);
  url.searchParams.set('id', `neq.${cierre.id}`);
  url.searchParams.set('estado', 'neq.CANCELADO');
  url.searchParams.set('corte_hasta_at', 'not.is.null');
  url.searchParams.set('select', 'id,corte_hasta_at,sigma_snapshot_acumulado,reti_pendiente_salida');
  url.searchParams.set('order', 'corte_hasta_at.desc,created_at.desc');
  url.searchParams.set('limit', '1');

  const response = await fetch(url, { headers });
  if (!response.ok) return null;
  const rows = await response.json();
  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function saveClosureSigmaCut(request, cierreId, values) {
  const headers = apiHeaders(request, {
    'content-type': 'application/json',
    Prefer: 'return=representation',
  });
  if (!headers) throw new Error('No autorizado');

  const url = new URL(`${supabaseUrl}/rest/v1/donato_cierres_caja`);
  url.searchParams.set('id', `eq.${cierreId}`);
  url.searchParams.set('select', CLOSURE_SELECT);

  const response = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(values),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`No se pudo congelar el corte de Sigma: ${body.slice(0, 500)}`);
  }
  const rows = await response.json();
  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function getDonatoCloseConfig(request) {
  const headers = apiHeaders(request);
  if (!headers) return null;

  const url = new URL(`${supabaseUrl}/rest/v1/donato_cierre_configuracion`);
  url.searchParams.set('id', 'eq.1');
  url.searchParams.set('select', 'tolerancia_conceptos,tolerancia_caja');
  const response = await fetch(url, { headers });
  if (!response.ok) return null;
  const rows = await response.json();
  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function userHasCapability(request, capabilityCode) {
  const headers = apiHeaders(request, { 'content-type': 'application/json' });
  if (!headers) return false;

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/has_capability`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ capability_code: capabilityCode }),
  });
  if (!response.ok) return false;
  return (await response.json()) === true;
}
