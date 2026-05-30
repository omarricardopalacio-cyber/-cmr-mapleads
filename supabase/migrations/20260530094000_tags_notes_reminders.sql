-- ============================================================
-- CRM CONTEXT TABLES: tags, contact_tags, notes, reminders
-- ============================================================

-- 1. Tags
CREATE TABLE public.tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#E0E0E0',
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (org_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tags TO authenticated;
GRANT ALL ON public.tags TO service_role;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_tags_org ON public.tags(org_id);

CREATE POLICY "tags members all" ON public.tags FOR ALL TO authenticated
  USING (public.is_member(auth.uid(), org_id)) WITH CHECK (public.is_member(auth.uid(), org_id));

COMMENT ON TABLE public.tags IS 'User-defined tags to categorize contacts within an organization.';

-- 2. Contact Tags (many-to-many)
CREATE TABLE public.contact_tags (
    contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (contact_id, tag_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_tags TO authenticated;
GRANT ALL ON public.contact_tags TO service_role;
ALTER TABLE public.contact_tags ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_contact_tags_contact ON public.contact_tags(contact_id);
CREATE INDEX idx_contact_tags_tag ON public.contact_tags(tag_id);

CREATE POLICY "contact_tags members all" ON public.contact_tags FOR ALL TO authenticated
  USING (
    public.is_member(auth.uid(), (SELECT org_id FROM public.contacts WHERE id = contact_id))
  ) WITH CHECK (
    public.is_member(auth.uid(), (SELECT org_id FROM public.contacts WHERE id = contact_id))
  );

COMMENT ON TABLE public.contact_tags IS 'Joins contacts and tags in a many-to-many relationship.';

-- 3. Notes
CREATE TABLE public.notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notes TO authenticated;
GRANT ALL ON public.notes TO service_role;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_notes_contact ON public.notes(contact_id, created_at DESC);

CREATE POLICY "notes members all" ON public.notes FOR ALL TO authenticated
  USING (public.is_member(auth.uid(), org_id)) WITH CHECK (public.is_member(auth.uid(), org_id));

COMMENT ON TABLE public.notes IS 'Internal notes for a contact, not visible to the customer.';

-- 4. Reminders
CREATE TABLE public.reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    note TEXT NOT NULL,
    reminder_at TIMESTAMPTZ NOT NULL,
    is_completed BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminders TO authenticated;
GRANT ALL ON public.reminders TO service_role;
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_reminders_contact ON public.reminders(contact_id, reminder_at);
CREATE INDEX idx_reminders_pending ON public.reminders(org_id, reminder_at) WHERE is_completed = false;

CREATE POLICY "reminders members all" ON public.reminders FOR ALL TO authenticated
  USING (public.is_member(auth.uid(), org_id)) WITH CHECK (public.is_member(auth.uid(), org_id));

COMMENT ON TABLE public.reminders IS 'Scheduled reminders for agents to follow up with a contact.';
