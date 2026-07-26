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
        // Support /store-manifest.webmanifest via rewrite? Use query on this path.
        const name = url.searchParams.get("name") || "Tienda";
        const token = url.searchParams.get("token") || "";
        const startUrl = token ? `/store/${token}` : "/";
        const manifest = {
          name,
          short_name: name.slice(0, 12),
          start_url: startUrl,
          display: "standalone",
          background_color: "#F5F0EB",
          theme_color: "#FF6A00",
          lang: "es-CO",
          icons: [
            {
              src: "/favicon.ico",
              sizes: "48x48",
              type: "image/x-icon",
            },
          ],
        };
        return new Response(JSON.stringify(manifest), {
          status: 200,
          headers: {
            "Content-Type": "application/manifest+json",
            ...CORS,
          },
        });
      },
    },
  },
});
