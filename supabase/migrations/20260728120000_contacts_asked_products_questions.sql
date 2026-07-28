-- Productos consultados y preguntas del cliente (auto-acumulados desde el chat)

ALTER TABLE public.contacts
ADD COLUMN IF NOT EXISTS asked_products TEXT,
ADD COLUMN IF NOT EXISTS asked_questions TEXT;

-- Hay que dropear la función: CREATE OR REPLACE no puede cambiar el tipo de retorno (OUT)
DROP FUNCTION IF EXISTS public.contacts_report(uuid);

create or replace function public.contacts_report(p_org_id uuid)
returns table (
  id uuid,
  wa_id text,
  display_name text,
  phone text,
  updated_at timestamptz,
  message_count bigint,
  purchased boolean,
  asked_products text,
  asked_questions text
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
    coalesce(o.has_order, false) as purchased,
    c.asked_products,
    c.asked_questions
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
