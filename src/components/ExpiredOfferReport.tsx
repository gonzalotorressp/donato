import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Camera, ImagePlus } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { OFFER_PHOTO_BUCKET, prepareOfferPhoto, type OfferArticle, type OfferReport } from '../lib/offerReports';
import { emptyOfferDraft, type OfferDraft } from '../lib/priceSurvey';

export function ExpiredOfferReport({ article, value, onChange, disabled = false, onProcessingChange }: {
  article: OfferArticle; value: OfferDraft; onChange: (value: OfferDraft) => void;
  disabled?: boolean; onProcessingChange: (processing: boolean) => void;
}) {
  const id = useId();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const [preview, setPreview] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!value.photo) { setPreview(''); return; }
    const url = URL.createObjectURL(value.photo); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value.photo]);
  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    setProcessing(true); onProcessingChange(true); setError('');
    onChange({ ...value, photo: null, photoId: null });
    try {
      const photo = await prepareOfferPhoto(file);
      if (alive.current) onChange({ ...value, photo, photoId: crypto.randomUUID() });
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'No se pudo preparar la foto'); }
    finally { if (alive.current) { setProcessing(false); onProcessingChange(false); } }
  }
  const busy = disabled || processing;
  return <section style={{ padding: 14, border: '1px solid #dce3ec', borderRadius: 10 }}>
    <button type="button" disabled={busy} aria-expanded={value.enabled} aria-controls={id + '-form'}
      onClick={() => { onChange({ ...emptyOfferDraft(), enabled: !value.enabled }); setError(''); }}>
      <Camera size={18}/> {value.enabled ? 'Cancelar aviso de oferta' : 'Informar oferta no vigente'}
    </button>
    {value.enabled && <div id={id + '-form'} style={{ display: 'grid', gap: 12, marginTop: 12 }}>
      <p style={{ margin: 0 }}>Sacá una foto del cartel que no corresponde a las políticas consultadas. El aviso se guardará con el relevamiento.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" disabled={busy} onClick={() => cameraRef.current?.click()}><Camera size={18}/> Sacar foto</button>
        <button type="button" disabled={busy} onClick={() => galleryRef.current?.click()}><ImagePlus size={18}/> Adjuntar foto</button>
      </div>
      <input ref={cameraRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden disabled={busy}
        onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void choosePhoto(file); }}/>
      <input ref={galleryRef} type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy}
        onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void choosePhoto(file); }}/>
      {processing && <p role="status" style={{ margin: 0 }}>Preparando foto…</p>}
      {preview && <img src={preview} alt={'Foto del cartel de oferta del artículo ' + article.id} style={{ width: '100%', maxWidth: 420, borderRadius: 8 }}/>}
      <small>La foto del cartel es obligatoria si informás una oferta no vigente.</small>
      <label htmlFor={id + '-price'}>Precio del cartel (opcional)
        <input id={id + '-price'} value={value.price} inputMode="decimal" disabled={busy}
          onChange={event => onChange({ ...value, price: event.target.value })} placeholder="Ej.: 1950,00"
          style={{ display: 'block', width: '100%', boxSizing: 'border-box', padding: 10, marginTop: 5 }}/>
      </label>
      <label htmlFor={id + '-note'}>Observación (opcional)
        <textarea id={id + '-note'} value={value.note} maxLength={2000} rows={3} disabled={busy}
          onChange={event => onChange({ ...value, note: event.target.value })}
          style={{ display: 'block', width: '100%', boxSizing: 'border-box', padding: 10, marginTop: 5 }}/>
      </label>
    </div>}
    {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
  </section>;
}

export function OfferReportHistory({ client, refreshKey }: { client: SupabaseClient | null; refreshKey: number }) {
  const [rows, setRows] = useState<OfferReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [photo, setPhoto] = useState<{ id: string; url: string } | null>(null);
  const [photoLoading, setPhotoLoading] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!client) return;
    setLoading(true); setError('');
    try {
      const { data: { user }, error: authError } = await client.auth.getUser();
      if (authError || !user) throw new Error('Iniciá sesión nuevamente');
      const { data, error: queryError } = await client.from('donato_ofertas_reportadas')
        .select('id,articulo_id,descripcion,creado_at,estado,foto_path,precio_cartel,observacion')
        .eq('usuario_id', user.id).order('creado_at', { ascending: false }).limit(10);
      if (queryError) throw queryError;
      setRows(data || []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudieron consultar los avisos'); }
    finally { setLoading(false); }
  }, [client]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  return <section style={{ padding: 14, border: '1px solid #dce3ec', borderRadius: 10 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
      <strong>Mis ofertas informadas</strong><button type="button" disabled={loading} onClick={() => void load()}>{loading ? 'Actualizando…' : 'Actualizar'}</button>
    </div>
    {!loading && !error && !rows.length && <p>Todavía no informaste ofertas no vigentes.</p>}
    {rows.map(row => <div key={row.id} style={{ padding: '10px 0', borderBottom: '1px solid #e2e8f0', fontSize: 13 }}>
      <strong>{row.descripcion || 'Artículo ' + row.articulo_id}</strong>
      <div>{new Date(row.creado_at).toLocaleString('es-AR')} · Pendiente de revisión</div>
      {row.precio_cartel != null && <div>Cartel: {Number(row.precio_cartel).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}</div>}
      {row.observacion && <p>{row.observacion}</p>}
      <button type="button" disabled={photoLoading != null} style={{ marginTop: 6 }} onClick={async () => {
        if (!client) return;
        if (photo?.id === row.id) { setPhoto(null); return; }
        setPhotoLoading(row.id); setError('');
        try {
          const { data, error: photoError } = await client.storage.from(OFFER_PHOTO_BUCKET).createSignedUrl(row.foto_path, 300);
          if (photoError || !data?.signedUrl) throw photoError || new Error('No se pudo abrir la foto');
          setPhoto({ id: row.id, url: data.signedUrl });
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo abrir la foto'); }
        finally { setPhotoLoading(null); }
      }}>{photoLoading === row.id ? 'Abriendo…' : photo?.id === row.id ? 'Cerrar foto' : 'Ver foto del cartel'}</button>
      {photo?.id === row.id && <img src={photo.url} alt={'Cartel informado para ' + (row.descripcion || row.articulo_id)} style={{ display: 'block', width: '100%', maxWidth: 420, marginTop: 8, borderRadius: 8 }}/>}
    </div>)}
    {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
  </section>;
}
