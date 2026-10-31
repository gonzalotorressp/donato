import type { SupabaseClient } from '@supabase/supabase-js';
import type { PriceCheckStatus } from '../components/PriceStatusButtons';
import { OFFER_PHOTO_BUCKET, type OfferArticle } from './offerReports';
import { discountedPolicyPrice } from './discountedPolicyPrice';

export type PolicyControlDraft = { status: PriceCheckStatus | null; observedPrice: string };
export type OfferDraft = { enabled: boolean; photo: Blob | null; photoId: string | null; price: string; note: string };
export const emptyOfferDraft = (): OfferDraft => ({ enabled: false, photo: null, photoId: null, price: '', note: '' });
type SurveyArticle = OfferArticle & { precioSinIva: number; ivaPorcentual: number | null };
type SurveyPolicy = { id: number; precio: number | null; descuento: number | null };
export type SurveyControl = {
  estado: PriceCheckStatus; precio_observado: number | null;
  politica_id: string | null; politica_snapshot: object | null;
  precio_politica_neto: number | null; precio_politica_con_iva: number | null;
};
export function optionalSurveyPrice(input: string, label: string) {
  const value = input.trim().replace(',', '.');
  if (!value) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(value) || !Number.isFinite(Number(value))) throw new Error(label + ' inválido');
  return Number(value);
}
export function surveyControls(article: SurveyArticle, listStatus: PriceCheckStatus | null, observed: string,
  policies: SurveyPolicy[], drafts: Record<string, PolicyControlDraft>): SurveyControl[] {
  const controls: SurveyControl[] = [];
  if (listStatus) controls.push({ estado: listStatus,
    precio_observado: listStatus === 'error' ? optionalSurveyPrice(observed, 'Precio observado de lista') : null,
    politica_id: null, politica_snapshot: null, precio_politica_neto: null, precio_politica_con_iva: null });
  for (const policy of policies) {
    const draft = drafts[String(policy.id)];
    if (!draft?.status) continue;
    const fixed = policy.precio == null ? null : Number(policy.precio);
    const discounted = fixed == null && policy.descuento != null
      ? discountedPolicyPrice(Number(article.precioSinIva), Number(policy.descuento), article.ivaPorcentual) : null;
    controls.push({ estado: draft.status,
      precio_observado: draft.status === 'error' ? optionalSurveyPrice(draft.observedPrice, 'Precio observado de la política #' + policy.id) : null,
      politica_id: String(policy.id),
      politica_snapshot: { ...policy, ivaPorcentual: article.ivaPorcentual,
        ...(discounted ? { precioListaNeto: article.precioSinIva, precioCalculadoNeto: discounted.net, precioCalculadoConIva: discounted.gross } : {}) },
      precio_politica_neto: fixed,
      precio_politica_con_iva: fixed == null || article.ivaPorcentual == null ? null
        : Math.round((fixed * (1 + article.ivaPorcentual / 100) + Number.EPSILON) * 100) / 100 });
  }
  return controls;
}

export async function savePriceSurvey(client: SupabaseClient, values: {
  id: string; article: SurveyArticle; controls: SurveyControl[]; offer: OfferDraft;
  policies: unknown[]; policyNote: string;
}) {
  if (!values.controls.length && !values.offer.enabled) throw new Error('Marcá al menos un control o informá una oferta');
  const offer = values.offer;
  const observed = offer.enabled ? optionalSurveyPrice(offer.price, 'Precio del cartel') : null;
  if (offer.enabled && (!offer.photo?.size || offer.photo.type !== 'image/jpeg' || offer.photo.size > 10 * 1024 * 1024 || !offer.photoId)) throw new Error('Adjuntá una foto válida del cartel de oferta');
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) throw new Error('Iniciá sesión nuevamente');
  const path = offer.enabled ? `${user.id}/${offer.photoId}.jpg` : null;
  const payload = {
    articulo: { id: values.article.id, descripcion: values.article.descripcion || null, precio_lista_con_iva: values.article.precioConIva },
    controles: values.controls,
    oferta: !offer.enabled ? null : { id: offer.photoId, foto_path: path, precio_cartel: observed,
      observacion: offer.note.trim() || null, politicas_snapshot: { politicas: values.policies, resultado_consulta: values.policyNote } },
  };
  const args = { p_id: values.id, p_payload: payload };
  const { data: existing, error: preflightError } = await client.rpc('donato_guardar_relevamiento_precios', { ...args, p_solo_consultar: true });
  if (preflightError) throw new Error(preflightError.message);
  if (existing?.guardado) return values.id;
  const storage = client.storage.from(OFFER_PHOTO_BUCKET);
  if (path && offer.photo) {
    const { error } = await storage.upload(path, offer.photo, { contentType: 'image/jpeg', upsert: false });
    // A retry may find the same photo uploaded by the previous attempt.
    if (error && String(error.statusCode) !== '409') throw new Error('No se pudo subir la foto: ' + error.message);
  }
  try {
    const { data, error } = await client.rpc('donato_guardar_relevamiento_precios', { ...args, p_solo_consultar: false });
    if (error || !data?.guardado) throw new Error(error?.message || 'No se pudo guardar el relevamiento');
    return values.id;
  } catch (error) {
    if (path) try { await storage.remove([path]); } catch { /* Linked photos remain protected by RLS. */ }
    throw error;
  }
}
