import type { SupabaseClient } from '@supabase/supabase-js';

export const OFFER_PHOTO_BUCKET = 'donato-ofertas-carteles';

export type OfferArticle = { id: string; descripcion?: string; precioConIva: number | null };
export type OfferReport = {
  id: string; articulo_id: string; descripcion: string | null; creado_at: string;
  estado: string; foto_path: string; precio_cartel: number | null; observacion: string | null;
};

export async function prepareOfferPhoto(file: File): Promise<Blob> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Elegí una foto JPG, PNG o WebP');
  if (file.size > 20 * 1024 * 1024) throw new Error('La foto supera los 20 MB. Sacá otra con menor resolución');
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('No se pudo abrir la foto. Elegí otra imagen'));
      image.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('La foto no tiene dimensiones válidas');
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo preparar la foto');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('No se pudo preparar la foto')), 'image/jpeg', 0.85);
    });
  } finally { image.src = ''; URL.revokeObjectURL(url); }
}

export async function saveExpiredOfferReport(client: SupabaseClient, values: {
  article: OfferArticle; photo: Blob; observedPrice: number | null; note: string;
  policies: unknown[]; policyNote: string;
}) {
  if (!values.photo.size || values.photo.type !== 'image/jpeg' || values.photo.size > 10 * 1024 * 1024) throw new Error('Adjuntá una foto válida del cartel');
  if (!/^\d{1,12}$/.test(values.article.id)) throw new Error('Artículo inválido');
  if (values.observedPrice != null && (!Number.isFinite(values.observedPrice) || values.observedPrice < 0)) throw new Error('Precio del cartel inválido');
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) throw new Error('Iniciá sesión nuevamente');
  const id = crypto.randomUUID();
  const path = `${user.id}/${id}.jpg`;
  const storage = client.storage.from(OFFER_PHOTO_BUCKET);
  const { error: photoError } = await storage.upload(path, values.photo, { contentType: 'image/jpeg', upsert: false });
  if (photoError) throw new Error('No se pudo subir la foto: ' + photoError.message);
  try {
    const { error } = await client.from('donato_ofertas_reportadas').insert({
      id, articulo_id: values.article.id, descripcion: values.article.descripcion || null,
      precio_lista_con_iva: values.article.precioConIva, precio_cartel: values.observedPrice,
      observacion: values.note.trim() || null, foto_path: path,
      politicas_snapshot: { politicas: values.policies, resultado_consulta: values.policyNote },
    });
    if (error) throw new Error('No se pudo guardar el aviso: ' + error.message);
    return id;
  } catch (error) {
    // Only unlinked photos can be removed by RLS, including when an INSERT's
    // response was lost after the database actually committed the report.
    try { await storage.remove([path]); } catch { /* Preserve the original error. */ }
    throw error;
  }
}
