import { createFileRoute } from "@tanstack/react-router";

/**
 * Cron opcional: consolida jobs de aprendizaje.
 * En producción también se procesa al llegar a 50 / ingest / botón en /catalog.
 */
export const Route = createFileRoute("/api/public/cron/product-learning")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env.CRON_SECRET;
        if (secret) {
          const auth = request.headers.get("authorization") || "";
          if (auth !== `Bearer ${secret}`) {
            return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }
        }

        try {
          const { processPendingProductLearningJobs } = await import(
            "@/lib/product-learning.server"
          );
          const processed = await processPendingProductLearningJobs(3);
          return new Response(
            JSON.stringify({ ok: true, processed }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        } catch (error: any) {
          console.error("[CRON] product-learning:", error);
          return new Response(
            JSON.stringify({ ok: false, error: error?.message || String(error) }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
