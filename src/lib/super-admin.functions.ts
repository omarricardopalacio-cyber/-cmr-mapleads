import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isSuperAdmin } from "./super-admin.server";

/**
 * F6 — serverFn que expone el estado super_admin al cliente.
 * Usada por useIsSuperAdmin() para gating de UI.
 */
export const getIsSuperAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context?.userId;
    if (!userId) {
      return { isSuperAdmin: false, userId: null };
    }
    const ok = await isSuperAdmin(userId);
    return { isSuperAdmin: ok, userId };
  });
