const supabaseUrl = process.env.VITE_SUPABASE_URL;
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

function bearer(request) {
  const header = request.headers?.authorization || request.headers?.Authorization || '';
  return String(header).startsWith('Bearer ') ? String(header).slice(7) : null;
}

export async function requireAuthenticatedUser(request) {
  if (!supabaseUrl || !publishableKey) throw new Error('Falta configuración Supabase');
  const token = bearer(request);
  if (!token) return null;

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publishableKey, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  return response.json();
}

export async function getClosureForUser(request, cierreId) {
  const token = bearer(request);
  if (!token || !supabaseUrl || !publishableKey) return null;
  const url = new URL(`${supabaseUrl}/rest/v1/donato_cierres_caja`);
  url.searchParams.set('id', `eq.${cierreId}`);
  url.searchParams.set('select', 'id,fecha,usuario_sigma_codigo,caja_codigo,estado,carga_ciega_cerrada_at,submitted_at');
  const response = await fetch(url, {
    headers: { apikey: publishableKey, Authorization: `Bearer ${token}`, accept: 'application/json' },
  });
  if (!response.ok) return null;
  const rows = await response.json();
  return Array.isArray(rows) ? rows[0] || null : null;
}
