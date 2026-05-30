DO $$
DECLARE
  rec RECORD;
  good_contact_id uuid;
  bad_thread_id uuid;
  good_thread_id uuid;
BEGIN
  FOR rec IN
    SELECT c.org_id, c.id AS bad_contact_id, c.wa_id AS bad_wa_id, c.phone, t.session_id
    FROM public.contacts c
    JOIN public.threads t ON t.contact_id = c.id AND t.org_id = c.org_id
    WHERE c.wa_id LIKE '%@lid'
      AND c.phone IS NOT NULL
      AND c.phone <> ''
  LOOP
    INSERT INTO public.contacts (org_id, wa_id, phone, display_name)
    VALUES (rec.org_id, rec.bad_wa_id, rec.phone, rec.phone)
    ON CONFLICT (org_id, wa_id)
    DO UPDATE SET
      phone = COALESCE(public.contacts.phone, EXCLUDED.phone),
      display_name = CASE
        WHEN public.contacts.display_name IS NULL OR btrim(public.contacts.display_name) = '' OR lower(public.contacts.display_name) = 'unknown'
          THEN EXCLUDED.display_name
        ELSE public.contacts.display_name
      END;

    SELECT id INTO good_contact_id
    FROM public.contacts
    WHERE org_id = rec.org_id AND phone = rec.phone
    ORDER BY updated_at DESC NULLS LAST, created_at DESC
    LIMIT 1;

    SELECT id INTO bad_thread_id
    FROM public.threads
    WHERE org_id = rec.org_id AND session_id = rec.session_id AND contact_id = rec.bad_contact_id
    LIMIT 1;

    IF good_contact_id IS NOT NULL AND bad_thread_id IS NOT NULL THEN
      INSERT INTO public.threads (org_id, session_id, contact_id, last_message_at, unread_count)
      VALUES (rec.org_id, rec.session_id, good_contact_id, now(), 0)
      ON CONFLICT (session_id, contact_id)
      DO NOTHING;

      SELECT id INTO good_thread_id
      FROM public.threads
      WHERE org_id = rec.org_id AND session_id = rec.session_id AND contact_id = good_contact_id
      LIMIT 1;

      IF good_thread_id IS NOT NULL AND good_thread_id <> bad_thread_id THEN
        UPDATE public.messages
        SET thread_id = good_thread_id
        WHERE thread_id = bad_thread_id;

        UPDATE public.threads
        SET last_message_at = GREATEST(COALESCE(last_message_at, now()), COALESCE((SELECT max(sent_at) FROM public.messages WHERE thread_id = good_thread_id), now()))
        WHERE id = good_thread_id;

        DELETE FROM public.threads WHERE id = bad_thread_id;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.contacts
  SET display_name = COALESCE(phone, regexp_replace(wa_id, '@lid$', ''))
  WHERE display_name IS NULL
     OR btrim(display_name) = ''
     OR lower(display_name) = 'unknown';
END $$;