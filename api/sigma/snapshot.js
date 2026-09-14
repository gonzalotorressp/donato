import { argentinaToday, buildUserSnapshot, fetchTodayReports } from '../../server/sigma.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const fecha = typeof request.query?.fecha === 'string' ? request.query.fecha : argentinaToday();
    const usuario = Number(request.query?.usuario);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !Number.isFinite(usuario)) {
      response.status(400).json({ error: 'Parámetros inválidos' });
      return;
    }

    const [sales, accounting] = await fetchTodayReports(fecha);
    const snapshot = buildUserSnapshot(sales, accounting, fecha, usuario);
    response.setHeader('Cache-Control', 'no-store');
    response.status(200).json({ fecha, usuarioCodigo: usuario, snapshot });
  } catch (error) {
    console.error('Error snapshot Donato', error);
    response.status(500).json({ error: error instanceof Error ? error.message : 'Error consultando Sigma' });
  }
}
