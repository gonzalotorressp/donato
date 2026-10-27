import { requireAuthenticatedUser } from '../../server/supabase-auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });
  const user = await requireAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Sesión requerida' });
  const id = String(req.query.id || '').trim();
  if (!/^[0-9]{1,12}$/.test(id)) return res.status(400).json({ error: 'Artículo inválido' });
  const token = process.env.SIGMA_API_TOKEN;
  if (!token) return res.status(503).json({ error: 'Falta configuración de Sigma' });
  try {
    const url = new URL('https://secure.sig2k.com/sigmasaas/sanpablo@sigma/sigma/api/v10/ExportArticulosPrecios');
    for (const [key, value] of Object.entries({ id, lista: '4', empres: '0001', sucurs: '0004' })) url.searchParams.set(key, value);
    const response = await fetch(url, { headers: { 'X-Auth-Token': token, accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) return res.status(502).json({ error: 'Sigma respondió HTTP ' + response.status });
    const rows = await response.json();
    const item = Array.isArray(rows) ? rows.find(row => String(row.id) === id) : null;
    if (!item) return res.status(404).json({ error: 'Precio no encontrado' });
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({ id, lista: '4', empresa: '0001', sucursal: '0004', precioSinIva: item.precio, moneda: item.moneda });
  } catch (error) {
    return res.status(502).json({ error: 'No se pudo consultar el precio en Sigma' });
  }
}
