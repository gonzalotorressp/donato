from pathlib import Path

p=Path("src/App.tsx")
s=p.read_text()

marker="type FullComparison = {"
insert="""type QuickControl = {
  fecha: string;
  usuarioCodigo: number;
  usuarioNombre: string;
  cajaCodigo: number | null;
  primeraVentaHora?: string | null;
  ultimaVentaHora?: string | null;
  cantidadVentas: number;
  venta: number;
  efectivoCodo: number;
  clover: number;
  payway: number;
  naranja: number;
  cuentaCorriente: number;
  pendienteContado: number;
  retirosAsignados: number;
  efectivoTeoricoRestante: number;
  retiros: Array<{ id: number; importe: number; horaAproximada?: string | null; confianza: string; registradoPorNombre?: string | null }>;
};

"""
if "type QuickControl =" not in s:
    s=s.replace(marker,insert+marker)

old="""  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(true);"""
new="""  const [historyError, setHistoryError] = useState<string | null>(null);
  const [quickControls, setQuickControls] = useState<QuickControl[]>([]);
  const [quickControlUnassigned, setQuickControlUnassigned] = useState<Array<{ id: number; cajaCodigo: number; importe: number }>>([]);
  const [quickControlCriterion, setQuickControlCriterion] = useState('');
  const [loadingDashboard, setLoadingDashboard] = useState(true);"""
if old in s: s=s.replace(old,new)

old="""      const historyRequests: Promise<any>[] = [closureQuery as unknown as Promise<any>];
      if (historyDate) {
        const headers = await authHeaders();
        historyRequests.push(fetch(`/api/sigma/jornadas?fecha=${encodeURIComponent(historyDate)}`, {
          headers,
          cache: 'no-store',
        }));
      }

      const [closureResult, sigmaResponse] = await Promise.all(historyRequests);"""
new="""      const historyRequests: Promise<any>[] = [closureQuery as unknown as Promise<any>];
      if (historyDate) {
        const headers = await authHeaders();
        historyRequests.push(fetch(`/api/sigma/jornadas?fecha=${encodeURIComponent(historyDate)}`, {
          headers,
          cache: 'no-store',
        }));
        if (profile.rol === 'administrador') {
          historyRequests.push(fetch(`/api/sigma/control-rapido?fecha=${encodeURIComponent(historyDate)}`, {
            headers,
            cache: 'no-store',
          }));
        }
      }

      const [closureResult, sigmaResponse, quickResponse] = await Promise.all(historyRequests);"""
if old in s: s=s.replace(old,new)

old="""        const sigmaData = await sigmaResponse.json();
        setHistoryJourneys(Array.isArray(sigmaData.jornadas) ? sigmaData.jornadas : []);
      } else {
        setHistoryJourneys([]);
      }"""
new="""        const sigmaData = await sigmaResponse.json();
        setHistoryJourneys(Array.isArray(sigmaData.jornadas) ? sigmaData.jornadas : []);
        if (quickResponse) {
          if (!quickResponse.ok) {
            const body = await quickResponse.json().catch(() => ({}));
            throw new Error(body.error || 'No se pudo generar el control rápido de Sigma');
          }
          const quickData = await quickResponse.json();
          setQuickControls(Array.isArray(quickData.controles) ? quickData.controles : []);
          setQuickControlUnassigned(Array.isArray(quickData.retirosSinAsignar) ? quickData.retirosSinAsignar : []);
          setQuickControlCriterion(String(quickData.criterioReti || ''));
        } else {
          setQuickControls([]);
          setQuickControlUnassigned([]);
          setQuickControlCriterion('');
        }
      } else {
        setHistoryJourneys([]);
        setQuickControls([]);
        setQuickControlUnassigned([]);
        setQuickControlCriterion('');
      }"""
if old in s: s=s.replace(old,new)

needle="""          {historyDate ? (
            <section className="panel dashboard-panel">
              <div className="panel-heading">
                <div><p className="eyebrow">VENTA POR CAJERO</p><h2>Jornada del {displayDate(historyDate)}</h2></div>"""
block="""          {historyDate && profile.rol === 'administrador' ? (
            <section className="panel dashboard-panel">
              <div className="panel-heading">
                <div><p className="eyebrow">CONTROL RÁPIDO · SÓLO SIGMA</p><h2>Cómo da la caja según registración</h2></div>
                <Banknote size={22} />
              </div>
              <p className="muted-copy">No compara contra efectivo, tickets ni documentación física. El efectivo teórico restante es Efectivo CODO menos RETI asignados al cajero.</p>
              {quickControlCriterion ? <p className="muted-copy"><strong>Cruce RETI:</strong> {quickControlCriterion}.</p> : null}
              {loadingHistory ? (
                <div className="empty-state"><Clock3 /><div><strong>Reconstruyendo control…</strong><p>Cruzando secuencia contable y horarios de venta.</p></div></div>
              ) : quickControls.length ? (
                <div className="cashier-list">
                  {quickControls.map((item) => (
                    <div key={`quick-${item.usuarioCodigo}`} className="cashier-card">
                      <div className="cashier-avatar">{item.usuarioNombre.slice(0, 1)}</div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <strong>{item.usuarioNombre}</strong>
                        <span>Caja {item.cajaCodigo || '—'} · {item.primeraVentaHora || '—'} a {item.ultimaVentaHora || '—'} · Venta {money.format(item.venta)}</span>
                        <span>Efectivo CODO {money.format(item.efectivoCodo)} · RETI {money.format(item.retirosAsignados)} · Clover {money.format(item.clover)} · Payway {money.format(item.payway)} · Naranja {money.format(item.naranja)} · Cta. Cte. {money.format(item.cuentaCorriente)}</span>
                        {item.retiros.length ? <small>{item.retiros.map((r) => `RETI ${r.id} ${money.format(r.importe)} ~${r.horaAproximada || 's/h'} (${r.confianza})`).join(' · ')}</small> : null}
                      </div>
                      <div className={`cashier-state ${item.efectivoTeoricoRestante < -0.01 ? 'review' : 'done'}`}>
                        Caja Sigma {money.format(item.efectivoTeoricoRestante)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state"><Banknote /><div><strong>Sin datos para controlar</strong><p>No se pudo reconstruir actividad de caja para esa fecha.</p></div></div>
              )}
              {quickControlUnassigned.length ? (
                <div className="error-banner">Atención: {quickControlUnassigned.length} RETI no pudieron asignarse con seguridad a un cajero. No se incluyen en los saldos individuales.</div>
              ) : null}
            </section>
          ) : null}

"""
if block.strip() not in s:
    s=s.replace(needle,block+needle)

p.write_text(s)
