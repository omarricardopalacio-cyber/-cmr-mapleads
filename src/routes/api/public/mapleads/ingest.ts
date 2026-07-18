// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";
import { normalizePhone } from "@/lib/leads.functions";
import { triggerFlows } from "@/lib/flow-trigger.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Mapleads-Token",
};

const LeadSchema = z.object({
  name: z.string().max(255).optional().default(""),
  phone: z.string().max(50).optional().default(""),
  address: z.string().max(500).optional().nullable(),
  city: z.string().max(120).optional().nullable(),
  zone: z.string().max(120).optional().nullable(),
  category: z.string().max(120).optional().nullable(),
  maps_category: z.string().max(255).optional().nullable(),
  website: z.string().max(500).optional().nullable(),
  email: z.string().max(255).optional().nullable(),
  rating: z.union([z.number(), z.string()]).optional().nullable(),
  review_count: z.union([z.number(), z.string()]).optional().nullable(),
  open_status: z.string().max(40).optional().nullable(),
  has_photos: z.boolean().optional().nullable(),
  campaign_name: z.string().max(255).optional().nullable(),
  scraped_at: z.string().optional(),
});

const PayloadSchema = z.object({
  leads: z.array(LeadSchema).min(1).max(500),
});

export const Route = createFileRoute("/api/public/mapleads/ingest")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const token =
          request.headers.get("x-mapleads-token") ||
          (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
        if (!token || token.length < 10) {
          return Response.json(
            { ok: false, error: "missing token" },
            { status: 401, headers: corsHeaders },
          );
        }
        let tokenRow;
        try {
          const res = await supabaseAdmin
            .from("lead_ingest_tokens")
            .select("user_id")
            .eq("token", token)
            .maybeSingle();
          tokenRow = res.data;
          if (res.error) throw res.error;
        } catch (err: any) {
          console.error("Supabase Admin Error:", err.message || err);
          return Response.json(
            { ok: false, error: err.message || String(err) },
            { status: 500, headers: corsHeaders }
          );
        }
        
        if (!tokenRow?.user_id) {
          return Response.json(
            { ok: false, error: "invalid token" },
            { status: 401, headers: corsHeaders },
          );
        }
        return Response.json({ ok: true }, { headers: corsHeaders });
      },

      POST: async ({ request }) => {
        const token =
          request.headers.get("x-mapleads-token") ||
          (request.headers.get("authorization") || "").replace(
            /^Bearer\s+/i,
            "",
          );
        if (!token || token.length < 10) {
          return Response.json(
            { error: "missing token" },
            { status: 401, headers: corsHeaders },
          );
        }

        let tokenRow;
        try {
          const res = await supabaseAdmin
            .from("lead_ingest_tokens")
            .select("user_id")
            .eq("token", token)
            .maybeSingle();
          tokenRow = res.data;
          if (res.error) throw res.error;
        } catch (err: any) {
          console.error("Supabase Admin Error:", err.message || err);
          return Response.json(
            { error: "Internal Server Error: " + (err.message || String(err)) },
            { status: 500, headers: corsHeaders }
          );
        }

        if (!tokenRow?.user_id) {
          return Response.json(
            { error: "invalid token" },
            { status: 401, headers: corsHeaders },
          );
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json(
            { error: "invalid json" },
            { status: 400, headers: corsHeaders },
          );
        }

        const parsed = PayloadSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { error: "invalid payload", details: parsed.error.flatten() },
            { status: 400, headers: corsHeaders },
          );
        }

        const userId = tokenRow.user_id;
        const rows = parsed.data.leads
          .map((l) => {
            const phone_normalized = normalizePhone(l.phone);
            return {
              user_id: userId,
              name: l.name || "",
              phone: l.phone || "",
              phone_normalized: phone_normalized || null,
              address: l.address ?? null,
              city: l.city ?? null,
              zone: l.zone ?? null,
              category: l.category ?? null,
              maps_category: l.maps_category ?? null,
              website: l.website ?? null,
              email: l.email ?? null,
              rating:
                l.rating != null && l.rating !== ""
                  ? Number(l.rating)
                  : null,
              review_count:
                l.review_count != null && l.review_count !== ""
                  ? Math.round(Number(l.review_count))
                  : null,
              open_status: l.open_status ?? null,
              has_photos: l.has_photos ?? null,
              campaign_name: l.campaign_name ?? null,
              source: "mapleads",
              raw: l as unknown as Record<string, unknown>,
              scraped_at: l.scraped_at || new Date().toISOString(),
            };
          })
          .filter((r) => r.name || r.phone);

        if (!rows.length) {
          return Response.json(
            { inserted: 0, skipped: 0 },
            { headers: corsHeaders },
          );
        }

        let inserted = 0;
        let duplicated = 0;
        for (const row of rows) {
          const { data: insertedLead, error } = await supabaseAdmin.from("leads").insert(row).select("id").single();
          if (error) {
            if (/duplicate key/i.test(error.message)) duplicated++;
            else console.error("[mapleads ingest]", error.message);
          } else {
            inserted++;
            if (insertedLead?.id) {
              triggerFlows({ orgId: tokenRow.user_id, contactId: insertedLead.id, triggerType: "mapleads_new_prospect" }).catch(console.error);
            }
          }
        }

        return Response.json(
          { inserted, duplicated, total: rows.length },
          { headers: corsHeaders },
        );
      },
    },
  },
});
