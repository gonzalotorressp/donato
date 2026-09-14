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

export async function getClosureForUser(request, cierreId) {
  const headers = apiHeaders(request);
  if (!headers) return null;

  const url = new URL(`${supabaseUrl}/rest/v1/donato_cierres_caja`);
  url.searchParams.set('id', `eq.${cierreId}`);
  url.searchParams.set(
    'select',
    'id,fecha,usuario_sigma_codigo,usuario_sigma_nombre,caja_codigo,estado,supervisor_user_id,carga_ciega_cerrada_at,submitted_at,declaracion_ciega,declaracion_ciega_inicial,revision_supervisor_count,diferencias_supervisor,conceptos_ok,caja_ok,tolerancia_caja_aplicada'
  );

  const response = await fetch(url, { headers });
  if (!response.ok) return null;
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
