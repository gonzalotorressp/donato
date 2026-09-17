from pathlib import Path
import re

path = Path('src/App.tsx')
text = path.read_text()

old = "  cantidadVentas?: number;\n  tieneActividadNueva?: boolean;"
new = "  cantidadVentas?: number;\n  venta?: number;\n  tieneActividadNueva?: boolean;"
assert old in text, 'Journey type anchor not found'
text = text.replace(old, new, 1)

old = "  const [historyClosures, setHistoryClosures] = useState<ClosureRow[]>([]);\n  const [historyDate, setHistoryDate] = useState('');"
new = "  const [historyClosures, setHistoryClosures] = useState<ClosureRow[]>([]);\n  const [historyJourneys, setHistoryJourneys] = useState<Journey[]>([]);\n  const [historyDate, setHistoryDate] = useState('');"
assert old in text, 'History state anchor not found'
text = text.replace(old, new, 1)

pattern = re.compile(r"  async function loadHistory\(\) \{.*?\n  \}\n\n  useEffect\(\(\) => \{\n    void loadDashboard\(\);", re.S)
replacement = '''  async function loadHistory() {
    if (!supabase) return;
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const closureQuery = historyDate
        ? supabase
            .from('donato_cierres_caja')
            .select(closureSelect)
            .eq('fecha', historyDate)
            .order('created_at', { ascending: false })
        : supabase
            .from('donato_cierres_caja')
            .select(closureSelect)
            .order('fecha', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(200);

      const historyRequests: Promise<any>[] = [closureQuery as unknown as Promise<any>];
      if (historyDate) {
        const headers = await authHeaders();
        historyRequests.push(fetch(`/api/sigma/jornadas?fecha=${encodeURIComponent(historyDate)}`, {
          headers,
          cache: 'no-store',
        }));
      }

      const [closureResult, sigmaResponse] = await Promise.all(historyRequests);
      if (closureResult.error) throw new Error(closureResult.error.message);
      setHistoryClosures((closureResult.data ?? []) as unknown as ClosureRow[]);

      if (historyDate && sigmaResponse) {
        if (!sigmaResponse.ok) {
          const body = await sigmaResponse.json().catch(() => ({}));
          throw new Error(body.error || 'No se pudo consultar la jornada histórica en Sigma');
        }
        const sigmaData = await sigmaResponse.json();
        setHistoryJourneys(Array.isArray(sigmaData.jornadas) ? sigmaData.jornadas : []);
      } else {
        setHistoryJourneys([]);
      }
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'No se pudo cargar el historial');
      setHistoryJourneys([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  useEffect(() => {
    if (dashboardMode === 'history') void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardMode, historyDate]);

  useEffect(() => {
    void loadDashboard();'''
text, count = pattern.subn(replacement, text, count=1)
assert count == 1, f'loadHistory replacement count={count}'

marker = '''          <section className="panel dashboard-panel">
            <div className="panel-heading">
              <div><p className="eyebrow">CIERRES REGISTRADOS</p><h2>{historyDate ? `Cierres del ${displayDate(historyDate)}` : 'Últimos cierres'}</h2></div>'''
assert marker in text, 'History registered closures panel anchor not found'

historical_sales = '''          {historyDate ? (
            <section className="panel dashboard-panel">
              <div className="panel-heading">
                <div><p className="eyebrow">VENTA POR CAJERO</p><h2>Jornada del {displayDate(historyDate)}</h2></div>
                <ReceiptText size={22} />
              </div>
              {loadingHistory ? (
                <div className="empty-state"><Clock3 /><div><strong>Consultando Sigma…</strong><p>Reconstruyendo ventas y cierres pendientes de la fecha.</p></div></div>
              ) : historyJourneys.length ? (
                <div className="cashier-list">
                  {historyJourneys.map((journey) => {
                    const userClosures = historyClosures
                      .filter((item) => item.fecha === journey.fecha && Number(item.usuario_sigma_codigo) === Number(journey.usuarioCodigo) && item.estado !== 'CANCELADO')
                      .sort((a, b) => Number(b.cierre_nro || 0) - Number(a.cierre_nro || 0));
                    const editable = userClosures.find((item) => ['BORRADOR', 'REVISION_SUPERVISOR'].includes(item.estado));
                    const latest = userClosures[0] || null;
                    const pending = journey.tieneActividadNueva === true;
                    const stateLabel = editable ? statusLabel(editable) : pending ? 'Pendiente de cierre' : latest ? statusLabel(latest) : 'Sin pendiente';
                    const stateClass = pending || editable?.estado === 'BORRADOR' ? 'pending' : latest && ['CERRADO', 'AJUSTES_AUTORIZADOS', 'AJUSTADO'].includes(latest.estado) ? 'done' : 'review';
                    return (
                      <button
                        key={`history-${journey.fecha}-${journey.usuarioCodigo}`}
                        className={`cashier-card ${!pending && latest && ['CERRADO', 'AJUSTES_AUTORIZADOS', 'AJUSTADO'].includes(latest.estado) ? 'completed' : ''}`}
                        disabled={pending && !editable && !isSupervisor}
                        onClick={() => {
                          if (editable) void openExistingClosure(editable);
                          else if (pending) void startPendingJourney(journey);
                          else if (latest) void openExistingClosure(latest);
                        }}
                      >
                        <div className="cashier-avatar">{journey.usuarioNombre.slice(0, 1)}</div>
                        <div>
                          <strong>{journey.usuarioNombre}</strong>
                          <span>
                            {journey.cajaCodigo ? `Caja ${journey.cajaCodigo} · ` : ''}
                            Venta {money.format(Number(journey.venta || 0))}
                            {journey.cantidadVentas ? ` · ${journey.cantidadVentas} ventas` : ''}
                            {journey.ultimaVentaHora ? ` · última ${journey.ultimaVentaHora}` : ''}
                          </span>
                        </div>
                        <div className={`cashier-state ${stateClass}`}>{stateLabel}</div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state"><ReceiptText /><div><strong>Sin ventas para esa fecha</strong><p>Sigma no registra actividad de cajeros en el día seleccionado.</p></div></div>
              )}
            </section>
          ) : null}

'''
text = text.replace(marker, historical_sales + marker, 1)
path.write_text(text)
