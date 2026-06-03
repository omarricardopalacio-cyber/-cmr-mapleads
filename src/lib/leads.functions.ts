// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Normaliza un teléfono a solo dígitos (con prefijo si lo trae). */
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const cleaned = String(raw).replace(/[^\d+]/g, "");
  return cleaned.replace(/^00/, "+");
}

export function isMobilePhone(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const cleaned = String(raw).replace(/\D/g, "");
  return (cleaned.length === 10 && cleaned.startsWith("3")) || (cleaned.length === 12 && cleaned.startsWith("573"));
}

// ============== TOKEN ==============
export const getOrCreateIngestToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: existing } = await supabase
      .from("lead_ingest_tokens")
      .select("token")
      .eq("user_id", userId)
      .maybeSingle();
    if (existing?.token) return { token: existing.token };
    const token =
      crypto.randomUUID().replace(/-/g, "") +
      crypto.randomUUID().replace(/-/g, "");
    const { error } = await supabase
      .from("lead_ingest_tokens")
      .insert({ user_id: userId, token });
    if (error) throw new Error(error.message);
    return { token };
  });

export const rotateIngestToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await supabase.from("lead_ingest_tokens").delete().eq("user_id", userId);
    const token =
      crypto.randomUUID().replace(/-/g, "") +
      crypto.randomUUID().replace(/-/g, "");
    const { error } = await supabase
      .from("lead_ingest_tokens")
      .insert({ user_id: userId, token });
    if (error) throw new Error(error.message);
    return { token };
  });

// ============== LEADS LIST ==============
export const listLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
        search: z.string().optional(),
        onlyUnsent: z.boolean().optional(),
        limit: z.number().min(1).max(2000).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    let q = supabase
      .from("leads")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .order("scraped_at", { ascending: false })
      .limit(data.limit ?? 500);
    if (data.from) q = q.gte("scraped_at", data.from);
    if (data.to) q = q.lte("scraped_at", data.to);
    if (data.onlyUnsent) q = q.is("message_sent_at", null);
    if (data.search)
      q = q.or(
        `name.ilike.%${data.search}%,phone.ilike.%${data.search}%,city.ilike.%${data.search}%`,
      );
    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);

    const { count: total } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    const { count: withPhone } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .neq("phone", "");
    const { count: sent } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .not("message_sent_at", "is", null);
    return {
      items: rows ?? [],
      filtered_count: count ?? 0,
      total: total ?? 0,
      with_phone: withPhone ?? 0,
      sent_count: sent ?? 0,
    };
  });

// ============== EDITAR ==============
export const updateLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().max(255).optional(),
        phone: z.string().max(50).optional(),
        email: z.string().max(255).optional().nullable(),
        city: z.string().max(120).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.phone !== undefined) {
      patch.phone = data.phone;
      patch.phone_normalized = normalizePhone(data.phone);
    }
    if (data.email !== undefined) patch.email = data.email;
    if (data.city !== undefined) patch.city = data.city;
    const { error } = await supabase
      .from("leads")
      .update(patch)
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============== ELIMINAR ==============
export const deleteLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("leads")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============== ARREGLAR NÚMEROS ==============
export const fixLeadNumbers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: leads, error } = await supabase
      .from("leads")
      .select("id, phone")
      .eq("user_id", userId)
      .neq("phone", "");
    if (error) throw new Error(error.message);

    let updatedCount = 0;
    for (const lead of leads ?? []) {
      if (!lead.phone) continue;
      const cleaned = lead.phone.replace(/\D/g, "");
      if (cleaned.length === 10 && cleaned.startsWith("3")) {
        const newPhone = "57" + cleaned;
        await supabase
          .from("leads")
          .update({ phone: newPhone, phone_normalized: newPhone })
          .eq("id", lead.id);
        updatedCount++;
      } else if (lead.phone !== cleaned && cleaned.length === 12 && cleaned.startsWith("573")) {
        await supabase
          .from("leads")
          .update({ phone: cleaned, phone_normalized: cleaned })
          .eq("id", lead.id);
        updatedCount++;
      }
    }
    return { ok: true, updatedCount };
  });

// ============== ELIMINAR NÚMEROS LOCALES ==============
export const deleteLocalLeadNumbers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: leads, error } = await supabase
      .from("leads")
      .select("id, phone")
      .eq("user_id", userId)
      .neq("phone", "");
    if (error) throw new Error(error.message);

    const idsToDelete: string[] = [];
    for (const lead of leads ?? []) {
      if (!isMobilePhone(lead.phone)) {
        idsToDelete.push(lead.id);
      }
    }

    if (idsToDelete.length > 0) {
      const chunkSize = 100;
      for (let i = 0; i < idsToDelete.length; i += chunkSize) {
        const chunk = idsToDelete.slice(i, i + chunkSize);
        await supabase
          .from("leads")
          .delete()
          .in("id", chunk)
          .eq("user_id", userId);
      }
    }
    return { ok: true, deletedCount: idsToDelete.length };
  });

// ============== Teléfonos no enviados (para Campañas Masivas) ==============
export const getUnsentLeadPhones = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("leads")
      .select("id, name, phone, phone_normalized")
      .eq("user_id", userId)
      .is("message_sent_at", null)
      .neq("phone", "")
      .limit(5000);
    if (error) throw new Error(error.message);
    return { items: data ?? [] };
  });

// ============== Marcar enviados ==============
export const markLeadsSent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        ids: z.array(z.string().uuid()).min(1).max(5000),
        broadcastId: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("leads")
      .update({
        message_sent_at: new Date().toISOString(),
        message_broadcast_id: data.broadcastId ?? null,
      })
      .in("id", data.ids)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true, count: data.ids.length };
  });
