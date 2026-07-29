import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { resolveStoreByToken } from "@/lib/store.server";

/** Datos OG públicos para crawlers (WhatsApp/Facebook). Sin auth. */
export const getStoreOgMeta = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ token: z.string().min(8).max(120) }).parse(d))
  .handler(async ({ data }) => {
    const store = await resolveStoreByToken(data.token);
    if (!store) return null;

    const title =
      String(store.seo_title || store.social_title || store.brand_name || "Catálogo").trim() ||
      "Catálogo";
    const description =
      String(
        store.seo_description ||
          store.social_description ||
          `Catálogo de ${store.brand_name}`,
      ).trim() || `Catálogo de ${store.brand_name}`;
    const image = String(store.social_image_url || store.logo_url || "").trim() || null;

    return {
      brandName: store.brand_name,
      title,
      description,
      image,
      token: store.store_token,
    };
  });
