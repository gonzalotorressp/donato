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

