-- Reporte de contactos para la sección Contactos:
--   - message_count: total de mensajes de la conversación del contacto (ambas direcciones)
--   - purchased: true si el contacto tiene al menos un pedido (orders)
-- Se hace en un solo RPC para evitar cientos de consultas desde el servidor.

create or replace function public.contacts_report(p_org_id uuid)
returns table (
  id uuid,
  wa_id text,
  display_name text,
  phone text,
  updated_at timestamptz,
  message_count bigint,
  purchased boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.wa_id,
    c.display_name,
    c.phone,
    c.updated_at,
    coalesce(m.cnt, 0)::bigint as message_count,
    coalesce(o.has_order, false) as purchased
  from contacts c
  left join (
    select t.contact_id, count(msg.id) as cnt
    from threads t
    join messages msg on msg.thread_id = t.id
    where t.org_id = p_org_id
    group by t.contact_id
  ) m on m.contact_id = c.id
  left join (
    select contact_id, true as has_order
    from orders
    where org_id = p_org_id and contact_id is not null
    group by contact_id
  ) o on o.contact_id = c.id
  where c.org_id = p_org_id
  order by c.updated_at desc
  limit 2000;
$$;

grant execute on function public.contacts_report(uuid) to service_role;
grant execute on function public.contacts_report(uuid) to authenticated;

notify pgrst, 'reload schema';
