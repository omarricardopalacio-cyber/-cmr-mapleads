import { Lock } from "lucide-react";

interface GlobalConfigBannerProps {
  /** Mensaje personalizado opcional. Si no se pasa, se usa el texto por defecto. */
  children?: React.ReactNode;
}

/**
 * F6 — Banner de solo lectura para rutas de configuración global.
 * Solo visible para usuarios que NO son SUPER_ADMIN.
 *
 * Uso:
 *   const { isSuperAdmin } = useIsSuperAdmin();
 *   {!isSuperAdmin && <GlobalConfigBanner />}
 *
 * O simplemente sin condicional (el componente no tiene lógica propia de rol):
 *   <GlobalConfigBanner />
 */
export function GlobalConfigBanner({ children }: GlobalConfigBannerProps) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
      <Lock className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-medium">Configuración global — sólo lectura</p>
        <p className="opacity-80">
          {children ??
            "Esta sección la administra el equipo super_admin. Puedes consultarla, pero las acciones de crear, editar y borrar están deshabilitadas."}
        </p>
      </div>
    </div>
  );
}
