import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Camera, ImagePlus } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { OFFER_PHOTO_BUCKET, prepareOfferPhoto, saveExpiredOfferReport, type OfferArticle, type OfferReport } from '../lib/offerReports';

export function ExpiredOfferReport({ client, article, policies, policyNote, onSaved }: {
  client: SupabaseClient | null; article: OfferArticle; policies: unknown[];
  policyNote: string; onSaved: () => void;
}) {
  const id = useId();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState('');
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!photo) { setPreview(''); return; }
    const url = URL.createObjectURL(photo); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    setProcessing(true); setError(''); setPhoto(null); setMessage('');
    try { setPhoto(await prepareOfferPhoto(file)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo preparar la foto'); }
    finally { setProcessing(false); }
  }
  return <section style={{ padding: 14, border: '1px solid #dce3ec', borderRadius: 10 }}>
    <button type="button" className="secondary-button" disabled={saving || processing}
      aria-expanded={open} aria-controls={id + '-form'} onClick={() => { setOpen(value => !value); setError(''); setMessage(''); }}>
      <Camera size={18}/> {open ? 'Cerrar aviso de oferta' : 'Informar oferta no vigente'}
    </button>
    {open && <div id={id + '-form'} style={{ display: 'grid', gap: 12, marginTop: 12 }}>
      <p style={{ margin: 0 }}>¿Hay un cartel de oferta que no corresponde a las políticas consultadas? Sacá una foto para informar la oferta y revisarla.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="secondary-button" disabled={saving || processing} onClick={() => cameraRef.current?.click()}><Camera size={18}/> Sacar foto</button>
        <button type="button" className="secondary-button" disabled={saving || processing} onClick={() => galleryRef.current?.click()}><ImagePlus size={18}/> Adjuntar foto</button>
      </div>
      <input ref={cameraRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden disabled={saving || processing}
        onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void choosePhoto(file); }}/>
      <input ref={galleryRef} type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={saving || processing}
        onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void choosePhoto(file); }}/>
      {processing && <p role="status" style={{ margin: 0 }}>Preparando foto…</p>}
      {preview && <img src={preview} alt={'Foto del cartel de oferta del artículo ' + article.id} style={{ width: '100%', maxWidth: 420, borderRadius: 8 }}/>}
      <small>La foto del cartel es obligatoria para guardar el aviso.</small>
      <label htmlFor={id + '-price'}>Precio del cartel (opcional)
        <input id={id + '-price'} value={price} inputMode="decimal" disabled={saving} onChange={event => setPrice(event.target.value)} placeholder="Ej.: 1950,00"
          style={{ display: 'block', width: '100%', boxSizing: 'border-box', padding: 10, marginTop: 5 }}/>
      </label>
      <label htmlFor={id + '-note'}>Observación (opcional)
        <textarea id={id + '-note'} value={note} maxLength={2000} rows={3} disabled={saving} onChange={event => setNote(event.target.value)}
          style={{ display: 'block', width: '100%', boxSizing: 'border-box', padding: 10, marginTop: 5 }}/>
      </label>
      <button type="button" className="primary-button" disabled={!client || !photo || saving || processing} onClick={async () => {
        if (!client || !photo || saving) return;
        setSaving(true); setError('');
        try {
          const amount = price.trim().replace(',', '.');
          if (amount && !/^\d+(\.\d{1,2})?$/.test(amount)) throw new Error('Precio del cartel inválido');
          await saveExpiredOfferReport(client, { article, photo, observedPrice: amount ? Number(amount) : null, note, policies, policyNote });
          setPhoto(null); setPrice(''); setNote(''); setOpen(false);
          setMessage('Oferta informada con foto. Pendiente de revisión.'); onSaved();
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar el aviso'); }
        finally { setSaving(false); }
      }}>{saving ? 'Guardando aviso…' : 'Guardar aviso con foto'}</button>
    </div>}
    {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
    {message && <p role="status" style={{ color: '#166534' }}>{message}</p>}
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
