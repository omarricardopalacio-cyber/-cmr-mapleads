import { createFileRoute } from "@tanstack/react-router";
import {
  clientIp,
  rateLimit,
  resolveStoreByCustomDomain,
  resolveStoreByToken,
} from "@/lib/store.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Store-Token",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

export const Route = createFileRoute("/api/public/store/config")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const ip = clientIp(request);
        if (!rateLimit(`store-config:${ip}`, 60, 60_000)) {
          return json(429, { error: "Too many requests" });
        }
        const url = new URL(request.url);
        const token =
          request.headers.get("x-store-token") || url.searchParams.get("token");
        let store = token ? await resolveStoreByToken(token) : null;
        if (!store) {
          const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
          store = await resolveStoreByCustomDomain(host);
        }
        if (!store) return json(401, { error: "Invalid store token" });

        const page = String(url.searchParams.get("page") || "").trim();
        let pageContent: string | null = null;
        if (page === "faq") pageContent = store.page_faq;
        else if (page === "terms") pageContent = store.page_terms;
        else if (page === "privacy") pageContent = store.page_privacy;
        else if (page === "shipping") pageContent = store.page_shipping;

        return json(200, {
          brandName: store.brand_name,
          logoUrl: store.logo_url,
          primaryColor: store.primary_color,
          accentColor: store.accent_color || "#FF2D95",
          socialTitle: store.seo_title || store.social_title || store.brand_name,
          socialDescription: store.seo_description || store.social_description,
          socialImageUrl: store.social_image_url || store.logo_url,
          orgId: store.org_id,
          storeToken: store.store_token,
          metaPixelId: store.meta_pixel_enabled ? store.meta_pixel_id : null,
          metaPixelEnabled: store.meta_pixel_enabled && !!store.meta_pixel_id,
          googleAnalyticsId: store.google_analytics_id,
          googleSiteVerification: store.google_site_verification,
          seoTitle: store.seo_title,
          seoDescription: store.seo_description,
          customDomain: store.custom_domain,
          hasFaq: Boolean(store.page_faq?.trim()),
          hasTerms: Boolean(store.page_terms?.trim()),
          hasPrivacy: Boolean(store.page_privacy?.trim()),
          hasShipping: Boolean(store.page_shipping?.trim()),
          pageSlug: page || null,
          pageContent,
        });
      },
    },
  },
});
