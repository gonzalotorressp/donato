import { requireAuthenticatedUser, userHasCapability } from '../../server/supabase-auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });
  try {
    const user = await requireAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Sesión requerida' });
    if (!(await userHasCapability(req, 'donato.admin'))) return res.status(403).json({ error: 'Sin permiso' });
    const token = process.env.SIGMA_API_TOKEN;
    if (!token) return res.status(503).json({ error: 'Falta token Sigma' });
    const url = new URL('https://secure.sig2k.com/sigmasaas/sanpablo@sigma/sigma/api/v10/ExportArticulosPrecios');
    url.searchParams.set('id', '154');
    url.searchParams.set('lista', '4');
    url.searchParams.set('empres', '0001');
    url.searchParams.set('sucurs', '0004');
    const response = await fetch(url, { headers: { 'X-Auth-Token': token, accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { mensaje: raw.slice(0, 350) }; }
    return res.status(200).json({ prueba: 'ExportArticulosPrecios', parametros: { id:'154', lista:'4', empres:'0001', sucurs:'0004' }, httpSigma: response.status, resultado: data });
  } catch (error) {
    return res.status(502).json({ error: 'Error consultando Sigma v10', detalle: error instanceof Error ? error.message : String(error) });
  }
}
