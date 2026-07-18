import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { uploadBase64ToStorage } from "@/lib/engine-media.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Session-Token",
  "Access-Control-Max-Age": "86400",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

const BodySchema = z.object({
  data: z.string().min(1),
  mimeType: z.string().max(120).optional(),
  msgType: z.string().max(32).optional(),
  fileName: z.string().max(255).optional(),
});

export const Route = createFileRoute("/api/public/engine/upload-media")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const token = request.headers.get("x-session-token");
        if (!token) return json(401, { error: "Missing session token" });

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json(400, { error: "Invalid JSON" });
        }

        const parsed = BodySchema.safeParse(body);
        if (!parsed.success) {
          return json(400, { error: "Invalid payload", issues: parsed.error.issues });
        }

        const { data: session, error: sErr } = await supabaseAdmin
          .from("wa_sessions")
          .select("id, org_id")
          .eq("session_token", token)
          .maybeSingle();
        if (sErr || !session) return json(401, { error: "Invalid session token" });

        try {
          const uploaded = await uploadBase64ToStorage(parsed.data.data, session.org_id ?? "", {
            mimeType: parsed.data.mimeType,
            msgType: parsed.data.msgType,
            fileName: parsed.data.fileName,
          });
          if (!uploaded) return json(400, { error: "Empty media payload" });
          return json(200, {
            ok: true,
            url: uploaded.url,
            storagePath: uploaded.storagePath,
            mimeType: uploaded.mimeType,
            size: uploaded.size,
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          const status = message.includes("exceeds") ? 413 : 500;
          return json(status, { error: message });
        }
      },
    },
  },
});
