export async function readApiJson(response: Response, fallback: string) {
  let data;
  try { data = await response.json(); }
  catch { throw new Error(`${fallback} (HTTP ${response.status}). Volvé a intentar en unos segundos.`); }
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : `${fallback} (HTTP ${response.status})`);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(fallback + ': respuesta inválida');
  return data;
}
