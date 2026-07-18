import { createFileRoute } from "@tanstack/react-router";
import { processDueRuns } from "@/lib/flow-runner.server";

// Este endpoint debería ser llamado por un cron job real (por ejemplo, Vercel Cron o Supabase pg_cron)
// cada 1 minuto.
export const Route = createFileRoute("/api/public/cron/flow-scheduler")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Aquí podrías agregar protección con un CRON_SECRET como en dispatch.ts
        // const authHeader = request.headers.get("authorization");
        // if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        //   return new Response("Unauthorized", { status: 401 });
        // }

        console.log("[CRON] Ejecutando flow-scheduler...");
        
        try {
          await processDueRuns();
          return new Response(JSON.stringify({ success: true, message: "Flow scheduler executed successfully" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (error: any) {
          console.error("[CRON] Error en flow-scheduler:", error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
