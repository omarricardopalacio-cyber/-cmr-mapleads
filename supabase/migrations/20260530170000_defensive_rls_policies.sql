-- Defensivo: asegurar políticas RLS para threads y contacts (sin romper existentes)

-- Threads
DROP POLICY IF EXISTS "threads members read" ON public.threads;
CREATE POLICY "threads members read"
  ON public.threads FOR SELECT TO authenticated
  USING (public.is_member(auth.uid(), org_id));

DROP POLICY IF EXISTS "threads members write" ON public.threads;
CREATE POLICY "threads members write"
  ON public.threads FOR ALL TO authenticated
  USING (public.is_member(auth.uid(), org_id))
  WITH CHECK (public.is_member(auth.uid(), org_id));

-- Contacts
DROP POLICY IF EXISTS "contacts members read" ON public.contacts;
CREATE POLICY "contacts members read"
  ON public.contacts FOR SELECT TO authenticated
  USING (public.is_member(auth.uid(), org_id));

DROP POLICY IF EXISTS "contacts members write" ON public.contacts;
CREATE POLICY "contacts members write"
  ON public.contacts FOR ALL TO authenticated
  USING (public.is_member(auth.uid(), org_id))
  WITH CHECK (public.is_member(auth.uid(), org_id));
