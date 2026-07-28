import webpush from "web-push";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function getVapid() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:soporte@mapleads.app";
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

export function getVapidPublicKey(): string | null {
  return getVapid()?.publicKey ?? null;
}

function ensureWebPushConfigured() {
  const v = getVapid();
  if (!v) return null;
  webpush.setVapidDetails(v.subject, v.publicKey, v.privateKey);
  return v;
}

export async function notifyStoreVisitor(opts: {
  orgId: string;
  visitorToken: string;
  title: string;
  body: string;
  url: string;
  badgeCount?: number;
}) {
  const vapid = ensureWebPushConfigured();
  if (!vapid) return { sent: 0, skipped: true, reason: "no_vapid" as const };

  const { data: subs, error } = await (supabaseAdmin as any)
    .from("web_push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("org_id", opts.orgId)
    .eq("visitor_token", opts.visitorToken);

  if (error || !subs?.length) {
    return { sent: 0, skipped: true, reason: "no_subs" as const };
  }

  const payload = JSON.stringify({
    title: opts.title,
    body: opts.body.slice(0, 180),
    url: opts.url,
    badgeCount: opts.badgeCount ?? 1,
    icon: "/store-pwa-icon.svg",
    tag: "store-chat",
  });

  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        payload,
        { TTL: 60 * 60 * 12, urgency: "high" },
      );
      sent += 1;
    } catch (err: any) {
      const status = err?.statusCode || err?.status;
      if (status === 404 || status === 410) {
        await (supabaseAdmin as any)
          .from("web_push_subscriptions")
          .delete()
          .eq("id", sub.id);
      } else {
        console.warn("[web-push] send failed", status || err?.message);
      }
    }
  }

  return { sent, skipped: false as const };
}

/** Incrementa unread del visitante y dispara push (best-effort). */
export async function bumpStoreVisitorUnreadAndNotify(opts: {
  orgId: string;
  threadId: string;
  title: string;
  body: string;
  storeToken?: string | null;
}) {
  try {
    const { data: thread } = await (supabaseAdmin as any)
      .from("threads")
      .select("id, web_session_id, org_id")
      .eq("id", opts.threadId)
      .eq("org_id", opts.orgId)
      .maybeSingle();

    if (!thread?.web_session_id) return;

    const { data: session } = await (supabaseAdmin as any)
      .from("web_sessions")
      .select("id, visitor_token")
      .eq("id", thread.web_session_id)
      .maybeSingle();

    if (!session?.visitor_token) return;

    let nextUnread = 1;
    const { data: unreadRow } = await (supabaseAdmin as any)
      .from("web_sessions")
      .select("unread_out")
      .eq("id", session.id)
      .maybeSingle();
    if (unreadRow && unreadRow.unread_out != null) {
      nextUnread = Math.max(1, Number(unreadRow.unread_out) + 1);
      await (supabaseAdmin as any)
        .from("web_sessions")
        .update({ unread_out: nextUnread })
        .eq("id", session.id);
    }

    let storeToken = opts.storeToken || null;
    if (!storeToken) {
      const { data: store } = await (supabaseAdmin as any)
        .from("store_configs")
        .select("store_token")
        .eq("org_id", opts.orgId)
        .maybeSingle();
      storeToken = store?.store_token || null;
    }

    const chatUrl = storeToken
      ? `/store/${storeToken}/chat`
      : "/";

    await notifyStoreVisitor({
      orgId: opts.orgId,
      visitorToken: session.visitor_token,
      title: opts.title,
      body: opts.body,
      url: chatUrl,
      badgeCount: nextUnread,
    });
  } catch (err) {
    console.warn("[bumpStoreVisitorUnreadAndNotify]", err);
  }
}

export async function clearStoreVisitorUnread(opts: {
  orgId: string;
  visitorToken: string;
}) {
  await (supabaseAdmin as any)
    .from("web_sessions")
    .update({ unread_out: 0 })
    .eq("org_id", opts.orgId)
    .eq("visitor_token", opts.visitorToken);
}
