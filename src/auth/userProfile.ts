import { supabase } from '../lib/supabase';

export type AppRole = 'supervisor_caja' | 'encargado_donato' | 'administrador';

export type UserProfile = {
  userId: string;
  email: string;
  nombre: string | null;
  rol: AppRole;
  activo: boolean;
  capabilities: string[];
};

const rolePermissions: Record<AppRole, readonly string[]> = {
  administrador: ['*'],
  supervisor_caja: ['cierres:read', 'cierres:create', 'cierres:submit'],
  encargado_donato: ['cierres:read', 'cierres:validate', 'ajustes:approve'],
};

function resolveDonatoRole(capabilities: string[]): AppRole | null {
  if (capabilities.includes('donato.admin')) return 'administrador';
  if (capabilities.includes('donato.encargado')) return 'encargado_donato';
  if (capabilities.includes('donato.supervisor_caja')) return 'supervisor_caja';
  return null;
}

export async function loadCurrentUserProfile(): Promise<UserProfile> {
  if (!supabase) throw new Error('Supabase no está configurado');

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) throw new Error(userError.message);
  if (!user) throw new Error('No hay una sesión autenticada');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id,email,full_name,active,status')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) throw new Error(profileError.message);
  if (!profile) throw new Error('No se encontró el perfil general del usuario');

  const isActive = profile.active === true && profile.status === 'active';
  if (!isActive) {
    return {
      userId: profile.id,
      email: profile.email,
      nombre: profile.full_name,
      rol: 'supervisor_caja',
      activo: false,
      capabilities: [],
    };
  }

  const { data: app, error: appError } = await supabase
    .from('applications')
    .select('id')
    .eq('code', 'donato')
    .eq('active', true)
    .maybeSingle();

  if (appError) throw new Error(appError.message);
  if (!app) throw new Error('La aplicación Donato todavía no está registrada en la plataforma');

  const { data: access, error: accessError } = await supabase
    .from('user_application_access')
    .select('user_id')
    .eq('user_id', user.id)
    .eq('application_id', app.id)
    .maybeSingle();

  if (accessError) throw new Error(accessError.message);
  if (!access) throw new Error('Tu usuario todavía no tiene acceso habilitado a Donato');

  const { data: capabilityRows, error: capabilityError } = await supabase
    .from('user_capabilities')
    .select('capabilities!inner(code)')
    .eq('user_id', user.id);

  if (capabilityError) throw new Error(capabilityError.message);

  const capabilities = (capabilityRows ?? [])
    .map((row) => {
      const related = row.capabilities as unknown as { code?: string } | { code?: string }[] | null;
      if (Array.isArray(related)) return related[0]?.code;
      return related?.code;
    })
    .filter((code): code is string => Boolean(code));

  const rol = resolveDonatoRole(capabilities);
  if (!rol) throw new Error('Tenés acceso a Donato pero todavía no tenés un rol asignado');

  return {
    userId: profile.id,
    email: profile.email,
    nombre: profile.full_name,
    rol,
    activo: true,
    capabilities,
  };
}

export function userCan(profile: UserProfile, permission: string): boolean {
  const permissions = rolePermissions[profile.rol];
  return permissions.includes('*') || permissions.includes(permission);
}
