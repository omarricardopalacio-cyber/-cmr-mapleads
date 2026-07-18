import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getIsSuperAdmin } from "@/lib/super-admin.functions";

/**
 * Estado SUPER_ADMIN (solo panel SaaS / Admin SaaS en sidebar).
 * Los módulos de workspace (auto-respuestas, flujos, etc.) son editables por todos los usuarios autenticados.
 */
export function useIsSuperAdmin() {
  const fn = useServerFn(getIsSuperAdmin);

  const { data, isLoading } = useQuery({
    queryKey: ["is-super-admin"],
    queryFn: () => fn({}),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: false,
  });

  return {
    /** Solo para menú Admin SaaS y acciones de plataforma */
    isSuperAdmin: !!data?.isSuperAdmin,
    userId: data?.userId ?? null,
    /** Configuración del workspace: siempre editable por el tenant */
    canEditWorkspace: true,
    isLoading,
  };
}
