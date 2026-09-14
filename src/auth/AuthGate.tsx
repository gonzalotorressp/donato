import { useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { LogIn, ShieldCheck, Store } from 'lucide-react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

type AuthGateProps = {
  children: (session: Session) => ReactNode;
};

function Brand() {
  return (
    <div className="brand-lockup">
      <div className="brand-mark"><Store size={26} /></div>
      <div><strong>Donato</strong><span>Operaciones</span></div>
    </div>
  );
}

export function AuthGate({ children }: AuthGateProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) setError(sessionError.message);
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    if (!supabase) return;
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (signInError) setError(signInError.message);
  };

  if (!isSupabaseConfigured) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <Brand />
          <p className="eyebrow">PLATAFORMA DONATO</p>
          <h1>Falta conectar el acceso</h1>
          <p>La interfaz ya está desplegable. Cargá las variables de Supabase en Vercel para habilitar Google.</p>
          <code>VITE_SUPABASE_URL</code>
          <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>
        </section>
      </main>
    );
  }

  if (loading) return <main className="auth-page"><p>Verificando acceso…</p></main>;

  if (!session) {
    return (
      <main className="auth-page">
        <section className="auth-card auth-login-card">
          <Brand />
          <p className="eyebrow">PLATAFORMA DONATO</p>
          <h1>Ingresá al centro de operaciones</h1>
          <p>Acceso con cuenta Google autorizada. Los permisos dependen del rol asignado.</p>
          <div className="trust-line"><ShieldCheck size={18} /> Supervisor de Caja · Encargado Donato · Administrador</div>
          {error ? <p className="error-text">{error}</p> : null}
          <button className="primary-button" onClick={signInWithGoogle}><LogIn size={18} /> Continuar con Google</button>
        </section>
      </main>
    );
  }

  return <>{children(session)}</>;
}
