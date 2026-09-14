import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import App from '../App';
import { supabase } from '../lib/supabase';
import { AuthGate } from './AuthGate';
import { loadCurrentUserProfile, type UserProfile } from './userProfile';

function ProfileProtectedApp({ session }: { session: Session }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void loadCurrentUserProfile()
      .then((nextProfile) => { if (mounted) setProfile(nextProfile); })
      .catch((nextError) => { if (mounted) setError(nextError instanceof Error ? nextError.message : 'No se pudo validar el usuario'); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [session.user.id]);

  if (loading) return <main className="auth-page"><p>Validando permisos…</p></main>;

  if (error || !profile) {
    return (
      <main className="auth-page"><section className="auth-card">
        <h1>No pudimos validar tu acceso</h1>
        <p>{error ?? 'No se encontró un perfil asociado a tu cuenta.'}</p>
        <button className="primary-button" onClick={() => void supabase?.auth.signOut()}>Cerrar sesión</button>
      </section></main>
    );
  }

  if (!profile.activo) {
    return (
      <main className="auth-page"><section className="auth-card">
        <h1>Usuario pendiente de autorización</h1>
        <p>La cuenta quedó registrada. Un administrador debe activarla y asignarle un rol Donato.</p>
        <code>{profile.email}</code>
        <button className="primary-button" onClick={() => void supabase?.auth.signOut()}>Cerrar sesión</button>
      </section></main>
    );
  }

  return <App profile={profile} onSignOut={() => void supabase?.auth.signOut()} />;
}

export function AuthenticatedApp() {
  return <AuthGate>{(session: Session) => <ProfileProtectedApp session={session} />}</AuthGate>;
}
