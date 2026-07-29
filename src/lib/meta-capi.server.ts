import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type CapiEventName = "Purchase" | "InitiateCheckout" | "Lead" | "ViewContent" | "PageView";

function sha256Norm(value: string): string {
  return createHash("sha256")
    .update(value.trim().toLowerCase())
    .digest("hex");
}

async function loadMetaCreds(orgId: string): Promise<{
  pixelId: string;
  accessToken: string;
} | null> {
  try {
    const { data, error } = await (supabaseAdmin as any)
      .from("store_configs")
      .select("meta_pixel_id, meta_capi_access_token, meta_pixel_enabled")
      .eq("org_id", orgId)
      .maybeSingle();
    if (error || !data) return null;
    if (data.meta_pixel_enabled === false) return null;
    const pixelId = String(data.meta_pixel_id || "").trim();
    const accessToken = String(data.meta_capi_access_token || "").trim();
    if (!pixelId || !accessToken) return null;
    return { pixelId, accessToken };
  } catch {
    return null;
  }
}

/**
 * Envía evento a Meta Conversions API (WhatsApp / servidor).
 * Silencioso si no hay pixel/token configurados.
 */
export async function sendMetaCapiEvent(params: {
  orgId: string;
  eventName: CapiEventName;
  eventId: string;
  sourceUrl?: string | null;
  value?: number | null;
  currency?: string;
  contentIds?: string[];
  contentName?: string | null;
  phone?: string | null;
  email?: string | null;
  fbp?: string | null;
  fbc?: string | null;
}): Promise<{ sent: boolean; error?: string }> {
  const creds = await loadMetaCreds(params.orgId);
  if (!creds) return { sent: false };

  const userData: Record<string, unknown> = {};
  if (params.phone) {
    const digits = String(params.phone).replace(/\D/g, "");
    if (digits) userData.ph = [sha256Norm(digits)];
  }
  if (params.email) userData.em = [sha256Norm(params.email)];
  if (params.fbp) userData.fbp = params.fbp;
  if (params.fbc) userData.fbc = params.fbc;

  const customData: Record<string, unknown> = {};
  if (params.value != null && Number.isFinite(Number(params.value))) {
    customData.value = Number(params.value);
    customData.currency = params.currency || "COP";
  }
  if (params.contentIds?.length) customData.content_ids = params.contentIds;
  if (params.contentName) customData.content_name = params.contentName;
  customData.content_type = "product";

  const body = {
    data: [
      {
        event_name: params.eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: params.eventId,
        action_source: "website",
        event_source_url: params.sourceUrl || undefined,
        user_data: userData,
        custom_data: Object.keys(customData).length ? customData : undefined,
      },
    ],
  };

  try {
    const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(creds.pixelId)}/events?access_token=${encodeURIComponent(creds.accessToken)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("[sendMetaCapiEvent]", params.eventName, res.status, text.slice(0, 300));
      return { sent: false, error: `Meta CAPI ${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.warn(
      "[sendMetaCapiEvent]",
      err instanceof Error ? err.message : String(err),
    );
    return { sent: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function metaEventId(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .join("_")
    .slice(0, 100);
}
