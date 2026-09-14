revoke execute on function public.has_application_access(text, uuid) from public, anon;
revoke execute on function public.has_capability(text, uuid) from public, anon;
revoke execute on function public.admin_set_donato_role(uuid, text) from public, anon;

grant execute on function public.has_application_access(text, uuid) to authenticated;
grant execute on function public.has_capability(text, uuid) to authenticated;
grant execute on function public.admin_set_donato_role(uuid, text) to authenticated;
