import { supabase } from '../lib/supabase';

export type AppRole = 'supervisor_caja' | 'encargado_donato' | 'administrador';

export type UserProfile = {
  userId: string;
  email: string;
  nombre: string | null;
  rol: AppRole;
  activo: boolean;
};

export async function loadCurrentUserProfile(): Promise<UserProfile> {
  if (!supabase) throw new Error('Supabase no está configurado');

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) throw new Error(userError.message);
  if (!user) throw new Error('No hay una sesión autenticada');

  const { data, error } = await supabase
    .from('perfiles_usuario')
    .select('user_id,email,nombre,rol,activo')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error('No se encontró el perfil Donato del usuario');

  return {
    userId: data.user_id,
    email: data.email,
    nombre: data.nombre,
    rol: data.rol,
    activo: data.activo,
  };
}

export const rolePermissions: Record<AppRole, readonly string[]> = {
  administrador: ['*'],
  supervisor_caja: ['cierres:read', 'cierres:create', 'cierres:submit'],
  encargado_donato: ['cierres:read', 'cierres:validate', 'ajustes:approve'],
};

export function userCan(profile: UserProfile, permission: string): boolean {
  const permissions = rolePermissions[profile.rol];
  return permissions.includes('*') || permissions.includes(permission);
}
