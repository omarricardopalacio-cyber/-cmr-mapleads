import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export const Route = createFileRoute("/store-manifest")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const name = (url.searchParams.get("name") || "Tienda").slice(0, 40);
        const token = url.searchParams.get("token") || "";
        const logo = url.searchParams.get("logo") || "";
        const theme = url.searchParams.get("theme") || "#008069";
        const start = url.searchParams.get("start") || "chat"; // chat | store

        const startUrl = token
          ? start === "store"
            ? `/store/${token}`
            : `/store/${token}/chat`
          : "/";

        const iconSrc = logo || "/store-pwa-icon.svg";
        const iconType = logo ? "image/png" : "image/svg+xml";

        const manifest = {
          id: token ? `/store/${token}` : "/",
          name: `${name} — Chat`,
          short_name: name.slice(0, 12),
          description: `Chat y catálogo de ${name}. Acceso rápido con notificaciones.`,
          start_url: startUrl,
          scope: token ? `/store/${token}` : "/",
          display: "standalone",
          display_override: ["standalone", "minimal-ui"],
          orientation: "portrait-primary",
          background_color: "#075E54",
          theme_color: theme,
          lang: "es-CO",
          dir: "ltr",
          categories: ["shopping", "business"],
          icons: [
            {
              src: iconSrc,
              sizes: "any",
              type: iconType,
              purpose: "any",
            },
            {
              src: "/store-pwa-icon.svg",
              sizes: "192x192",
              type: "image/svg+xml",
              purpose: "any maskable",
            },
            {
              src: "/store-pwa-icon.svg",
              sizes: "512x512",
              type: "image/svg+xml",
              purpose: "any maskable",
            },
          ],
        };

        return new Response(JSON.stringify(manifest), {
          status: 200,
          headers: {
            "Content-Type": "application/manifest+json",
            "Cache-Control": "public, max-age=300",
            ...CORS,
          },
        });
      },
    },
  },
});
