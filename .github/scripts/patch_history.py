from pathlib import Path

p = Path('src/App.tsx')
s = p.read_text()

def rep(old, new, label, count=None):
    global s
    if old not in s:
        raise SystemExit(f'Pattern not found: {label}')
    s = s.replace(old, new, -1 if count is None else count)

rep(
"""  const [closures, setClosures] = useState<ClosureRow[]>([]);
  const [loadingDashboard, setLoadingDashboard] = useState(true);""",
"""  const [closures, setClosures] = useState<ClosureRow[]>([]);
  const [dashboardMode, setDashboardMode] = useState<'today' | 'history'>('today');
  const [historyClosures, setHistoryClosures] = useState<ClosureRow[]>([]);
  const [historyDate, setHistoryDate] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(true);""",
'states', 1)

old = """      const [sigmaResponse, closureResponse] = await Promise.all([
        fetch(`/api/sigma/jornadas?fecha=${today}`, { headers, cache: 'no-store' }),
        supabase
          .from('donato_cierres_caja')
          .select(closureSelect)
          .eq('fecha', today)
          .order('usuario_sigma_nombre', { ascending: true })
          .order('cierre_nro', { ascending: true }),
      ]);

      if (!sigmaResponse.ok) {
        const body = await sigmaResponse.json().catch(() => ({}));
        throw new Error(body.error || 'No se pudieron consultar las cajas de hoy');
      }
      if (closureResponse.error) throw new Error(closureResponse.error.message);

      const sigmaData = await sigmaResponse.json();
      setJourneys(Array.isArray(sigmaData.jornadas) ? sigmaData.jornadas : []);
      setClosures((closureResponse.data ?? []) as unknown as ClosureRow[]);"""
new = """      const [sigmaResponse, closureResponse, openResponse] = await Promise.all([
        fetch(`/api/sigma/jornadas?fecha=${today}`, { headers, cache: 'no-store' }),
        supabase
          .from('donato_cierres_caja')
          .select(closureSelect)
          .eq('fecha', today)
          .order('usuario_sigma_nombre', { ascending: true })
          .order('cierre_nro', { ascending: true }),
        supabase
          .from('donato_cierres_caja')
          .select(closureSelect)
          .in('estado', ['BORRADOR', 'REVISION_SUPERVISOR', 'PENDIENTE_VALIDACION'])
          .order('fecha', { ascending: false })
          .order('usuario_sigma_nombre', { ascending: true }),
      ]);

      if (!sigmaResponse.ok) {
        const body = await sigmaResponse.json().catch(() => ({}));
        throw new Error(body.error || 'No se pudieron consultar las cajas de hoy');
      }
      if (closureResponse.error) throw new Error(closureResponse.error.message);
      if (openResponse.error) throw new Error(openResponse.error.message);

      const sigmaData = await sigmaResponse.json();
      setJourneys(Array.isArray(sigmaData.jornadas) ? sigmaData.jornadas : []);
      const merged = new Map<string, ClosureRow>();
      for (const row of [...(closureResponse.data ?? []), ...(openResponse.data ?? [])] as unknown as ClosureRow[]) {
        merged.set(row.id, row);
      }
      setClosures([...merged.values()]);"""
rep(old, new, 'load dashboard', 1)

marker = """  useEffect(() => {
    void loadDashboard();"""
insert = """  async function loadHistory() {
    if (!supabase) return;
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const { data, error } = await supabase
        .from('donato_cierres_caja')
        .select(closureSelect)
        .order('fecha', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      setHistoryClosures((data ?? []) as unknown as ClosureRow[]);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'No se pudo cargar el historial');
    } finally {
      setLoadingHistory(false);
    }
  }

  useEffect(() => {
    void loadDashboard();"""
rep(marker, insert, 'load history insert', 1)

marker = """  const completedClosures = useMemo(
    () => activeClosures.filter((item) => ['CERRADO', 'AJUSTES_AUTORIZADOS', 'AJUSTADO'].includes(item.estado)),
    [activeClosures]
  );"""
insert = marker + """

  const filteredHistoryClosures = useMemo(
    () => historyDate ? historyClosures.filter((item) => item.fecha === historyDate) : historyClosures,
    [historyClosures, historyDate]
  );"""
rep(marker, insert, 'history memo', 1)

old = """  function closureMeta(item: ClosureRow) {
    const cut = displayTime(item.corte_hasta_at || item.sigma_snapshot_capturado_at);
    return `Caja ${item.caja_codigo || '—'} · Cierre ${item.cierre_nro}${cut ? ` · ${cut}` : ''}`;
  }"""
new = """  function closureMeta(item: ClosureRow) {
    const cut = displayTime(item.corte_hasta_at || item.sigma_snapshot_capturado_at);
    const datePrefix = item.fecha !== today ? `${displayDate(item.fecha)} · ` : '';
    return `${datePrefix}Caja ${item.caja_codigo || '—'} · Cierre ${item.cierre_nro}${cut ? ` · ${cut}` : ''}`;
  }"""
rep(old, new, 'closure meta', 1)

nav_old = """            <button className=\"nav-item active\"><ClipboardCheck size={18} /> Cierre de caja</button>
            <button className=\"nav-item\" disabled><Clock3 size={18} /> Historial</button>"""
nav_new = """            <button className={`nav-item ${dashboardMode === 'today' ? 'active' : ''}`} onClick={() => { setDashboardMode('today'); setSelectedJourney(null); setClosure(null); void loadDashboard(); }}><ClipboardCheck size={18} /> Cierre de caja</button>
            <button className={`nav-item ${dashboardMode === 'history' ? 'active' : ''}`} onClick={() => { setDashboardMode('history'); setSelectedJourney(null); setClosure(null); void loadHistory(); }}><Clock3 size={18} /> Historial</button>"""
rep(nav_old, nav_new, 'nav buttons')

history_branch_marker = """  if (!selectedJourney || !closure) {
    return ("""
history_branch = """  if ((!selectedJourney || !closure) && dashboardMode === 'history') {
    return (
      <div className=\"app-shell\">
        <aside className=\"sidebar\">
          <div className=\"sidebar-brand\"><DonatoBrand /></div>
          <nav>
            <button className=\"nav-item\" onClick={() => { setDashboardMode('today'); void loadDashboard(); }}><ClipboardCheck size={18} /> Cierre de caja</button>
            <button className=\"nav-item active\"><Clock3 size={18} /> Historial</button>
            <button className=\"nav-item\" disabled><ArrowRightLeft size={18} /> Ajustes</button>
          </nav>
          <div className=\"sidebar-user\">
            <span>{roleLabel}</span>
            <strong>{profile.nombre || profile.email}</strong>
            <button onClick={onSignOut}><LogOut size={16} /> Salir</button>
          </div>
        </aside>

        <main className=\"workspace\">
          <header className=\"topbar\">
            <div>
              <p className=\"eyebrow\">HISTORIAL</p>
              <h1>Historial de cierres de caja</h1>
              <p>Consultá cierres anteriores, pendientes de validación y reportes históricos.</p>
            </div>
            <button className=\"refresh-button\" onClick={() => void loadHistory()} disabled={loadingHistory}>
              <RefreshCw size={16} /> Actualizar
            </button>
          </header>

          <section className=\"panel dashboard-panel\">
            <div className=\"panel-heading\">
              <div><p className=\"eyebrow\">FILTRO</p><h2>Buscar por fecha</h2></div>
              <Clock3 size={22} />
            </div>
            <div className=\"section-title-row\">
              <input className=\"text-input\" type=\"date\" value={historyDate} onChange={(event) => setHistoryDate(event.target.value)} />
              {historyDate ? <button className=\"add-row-button\" type=\"button\" onClick={() => setHistoryDate('')}>Ver todos</button> : null}
            </div>
          </section>

          {historyError ? <div className=\"error-banner\">{historyError}</div> : null}

          <section className=\"panel dashboard-panel\">
            <div className=\"panel-heading\">
              <div><p className=\"eyebrow\">CIERRES REGISTRADOS</p><h2>{historyDate ? `Cierres del ${displayDate(historyDate)}` : 'Últimos cierres'}</h2></div>
              <FileText size={22} />
            </div>
            {loadingHistory ? (
              <div className=\"empty-state\"><Clock3 /><div><strong>Cargando historial…</strong><p>Consultando cierres guardados.</p></div></div>
            ) : filteredHistoryClosures.length ? (
              <div className=\"cashier-list\">
                {filteredHistoryClosures.map((item) => (
                  <button key={item.id} className={`cashier-card ${['CERRADO', 'AJUSTES_AUTORIZADOS', 'AJUSTADO'].includes(item.estado) ? 'completed' : ''}`} onClick={() => void openExistingClosure(item)}>
                    <div className=\"cashier-avatar\">{item.usuario_sigma_nombre.slice(0, 1)}</div>
                    <div>
                      <strong>{item.usuario_sigma_nombre}</strong>
                      <span>{displayDate(item.fecha)} · Caja {item.caja_codigo || '—'} · Cierre {item.cierre_nro}</span>
                    </div>
                    <div className={`cashier-state ${['CERRADO', 'AJUSTES_AUTORIZADOS', 'AJUSTADO'].includes(item.estado) ? 'done' : item.estado === 'BORRADOR' ? 'pending' : 'review'}`}>{statusLabel(item)}</div>
                  </button>
                ))}
              </div>
            ) : (
              <div className=\"empty-state\"><FileText /><div><strong>No hay cierres para mostrar</strong><p>{historyDate ? 'No se registraron cierres en esa fecha.' : 'Todavía no hay cierres en el historial.'}</p></div></div>
            )}
          </section>
        </main>
      </div>
    );
  }

  if (!selectedJourney || !closure) {
    return ("""
rep(history_branch_marker, history_branch, 'history branch', 1)

old = """            void loadDashboard();
          }}"""
new = """            if (dashboardMode === 'history') void loadHistory();
            else void loadDashboard();
          }}"""
rep(old, new, 'back navigation', 1)

p.write_text(s)
