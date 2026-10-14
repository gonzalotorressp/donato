import { requireAuthenticatedUser, userHasCapability } from '../../server/supabase-auth.js';

const validCode = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const validDeposit = (value) => /^\\d{1,3}$/.test(String(value || ''));

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });
  try {
    const user = await requireAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Sesión requerida' });
    if (!(await userHasCapability(req, 'donato.admin'))) return res.status(403).json({ error: 'Sin permiso para consultar stock Sigma' });

    const codigo = String(req.query.codigo || '');
    const deposito = String(req.query.deposito || '03');
    if (!validCode(codigo) || !validDeposit(deposito)) return res.status(400).json({ error: 'Código interno o depósito inválido' });
    const base = process.env.SIGMA_BASE_URL;
    const token = process.env.SIGMA_API_TOKEN;
    if (!base || !token) return res.status(503).json({ error: 'Falta configuración de Sigma en el servidor' });

    const url = new URL(base.replace(/\\/$/, '') + '/ventas_stock');
    url.searchParams.set('codigo', codigo);
    url.searchParams.set('deposito', deposito);
    const response = await fetch(url, { headers: { 'X-Auth-Token': token, accept: 'application/json' }, signal: AbortSignal.timeout(18000) });
    const body = await response.text();
    if (!response.ok) return res.status(502).json({ error: 'Sigma rechazó la consulta', statusSigma: response.status });
    let parsed;
    try { parsed = JSON.parse(body); } catch { return res.status(502).json({ error: 'Sigma devolvió un formato no válido' }); }
    const records = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.data) ? parsed.data : Array.isArray(parsed?.items) ? parsed.items : [parsed];
    const stock = records.find(x => String(x?.codigo) === codigo && String(x?.deposito).padStart(2, '0') === deposito.padStart(2, '0')) || records[0];
    if (!stock || !Number.isFinite(Number(stock.stockFisico))) return res.status(502).json({ error: 'Sigma no devolvió stock físico verificable', formato: typeof parsed });
    return res.status(200).json({ codigoInterno: Number(codigo), deposito, stockFisico: Number(stock.stockFisico), stockDisponible: Number(stock.stockDisponible), capturadoAt: new Date().toISOString(), fuente: 'SIGMA_API', modo: 'consulta_sin_guardar' });
  } catch (error) {
    return res.status(502).json({ error: 'No se pudo consultar Sigma', detalle: error?.name === 'TimeoutError' ? 'Tiempo de espera agotado' : 'Error de conexión' });
  }
}
