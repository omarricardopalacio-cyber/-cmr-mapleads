import { createFileRoute } from "@tanstack/react-router";
import { processPendingProductLearningJobs } from "@/lib/product-learning.server";

/**
 * Cron: consolida jobs de aprendizaje (50 consultas / 50 ventas → ai_observation).
 * Llamar cada 1–5 min (Vercel Cron / Supabase pg_cron / n8n).
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
