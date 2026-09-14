import { argentinaToday, buildBlindJourneys, fetchTodayReports } from '../../server/sigma.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const fecha = typeof request.query?.fecha === 'string' ? request.query.fecha : argentinaToday();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      response.status(400).json({ error: 'Fecha inválida' });
      return;
    }

    const [sales, accounting] = await fetchTodayReports(fecha);
    const jornadas = buildBlindJourneys(sales, accounting, fecha);
    response.setHeader('Cache-Control', 'no-store');
    response.status(200).json({ fecha, jornadas });
  } catch (error) {
    console.error('Error jornadas Donato', error);
    response.status(500).json({ error: error instanceof Error ? error.message : 'Error consultando Sigma' });
  }
}
