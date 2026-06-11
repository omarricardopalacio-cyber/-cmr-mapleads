import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import {
  listSessions,
  createSession,
  updateSessionMe,
  updateSessionConfig,
  deleteSession,
} from "@/lib/sessions.functions";
import { listOrgMembers } from "@/lib/crm.functions";
import { listFlows } from "@/lib/automations.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import {
  Copy,
  Smartphone,
  Battery,
  BatteryLow,
  BatteryMedium,
  BatteryFull,
  Activity,
  Wifi,
  WifiOff,
  Settings,
  MonitorSmartphone,
  User,
  Workflow,
  Trash,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/sessions")({
  component: SessionsPage,
});

interface SessionRow {
  id: string;
  label: string;
  status: string;
  last_heartbeat_at: string | null;
  last_sync_at: string | null;
  created_at: string;
  session_token: string;
  me_wa_id: string | null;
  phone_number: string | null;
  device_name: string | null;
  battery_level: number | null;
  platform: string | null;
  default_agent_id: string | null;
  default_flow_id: string | null;
}

function SessionsPage() {
  const listFn = useServerFn(listSessions);
  const createFn = useServerFn(createSession);
  const qc = useQueryClient();
  const [label, setLabel] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["wa-sessions"],
    queryFn: () => listFn({}),
  });

  // Logging temporal para depuración
  useEffect(() => {
    console.log("[Sessions Debug] isLoading:", isLoading);
    console.log("[Sessions Debug] data:", data);
    console.log("[Sessions Debug] error:", error);
    console.log("[Sessions Debug] sessions count:", data?.sessions?.length ?? 0);
  }, [data, isLoading, error]);

  const mut = useMutation({
    mutationFn: (l: string) => createFn({ data: { label: l } }),
    onSuccess: () => {
      toast.success("Sesión creada");
      setLabel("");
      qc.invalidateQueries({ queryKey: ["wa-sessions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const backendBase = "https://project--289483ef-62cc-4bc6-91f6-2ef8e90b8d34.lovable.app";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Centro de Mando</h1>
        <p className="text-muted-foreground text-sm">
          Control multi-número, telemetría y enrutamiento inteligente.
        </p>
      </div>

      <Card className="p-4 flex gap-2">
        <Input
          placeholder="Nombre (ej: Soporte, Ventas)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Button onClick={() => label && mut.mutate(label)} disabled={mut.isPending || !label}>
          Crear sesión
        </Button>
      </Card>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {isLoading &&
          Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="p-4 space-y-3">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-8 w-full" />
            </Card>
          ))}
        {(data?.sessions ?? []).map((s) => (
          <SessionCard key={s.id} session={s as unknown as SessionRow} backendBase={backendBase} />
        ))}
        {!isLoading && (data?.sessions ?? []).length === 0 && (
          <div className="col-span-full text-center py-8 text-muted-foreground text-sm">
            No hay sesiones activas. Crea una nueva sesión para conectar un número de WhatsApp.
          </div>
        )}
      </div>

    </div>
  );
}

function SessionCard({ session, backendBase }: { session: SessionRow; backendBase: string }) {
  const qc = useQueryClient();
  const updateMeFn = useServerFn(updateSessionMe);
  const updateCfgFn = useServerFn(updateSessionConfig);
  const membersFn = useServerFn(listOrgMembers);
  const flowsFn = useServerFn(listFlows);
  const [meValue, setMeValue] = useState(session.me_wa_id ?? "");
  const [cfgOpen, setCfgOpen] = useState(false);

  const { data: membersData } = useQuery({
    queryKey: ["org-members"],
    queryFn: () => membersFn({}),
    enabled: cfgOpen,
  });

  const { data: flowsData } = useQuery({
    queryKey: ["flows"],
    queryFn: () => flowsFn({}),
    enabled: cfgOpen,
  });

  const deleteSessionFn = useServerFn(deleteSession);
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteSessionFn({ data: { sessionId: id } }),
    onSuccess: () => {
      toast.success("Sesión eliminada");
      qc.invalidateQueries({ queryKey: ["wa-sessions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const meMut = useMutation({
    mutationFn: (v: string) => updateMeFn({ data: { sessionId: session.id, meWaId: v || null } }),
    onSuccess: () => {
      toast.success("Número guardado");
      qc.invalidateQueries({ queryKey: ["wa-sessions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cfgMut = useMutation({
    mutationFn: (vals: { defaultAgentId: string | null; defaultFlowId: string | null }) =>
      updateCfgFn({ data: { sessionId: session.id, ...vals } }),
    onSuccess: () => {
      toast.success("Configuración guardada");
      qc.invalidateQueries({ queryKey: ["wa-sessions"] });
      setCfgOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isConnected = session?.status === "connected";
  const lastHb = session?.last_heartbeat_at ? new Date(session.last_heartbeat_at) : null;
  const secSince = lastHb ? Math.round((Date.now() - lastHb.getTime()) / 1000) : null;
  const syncText =
    secSince == null ? "Sin señal" : secSince < 60 ? `Sincronizado hace ${secSince}s` : `Sincronizado hace ${Math.round(secSince / 60)} min`;

  const batteryLevel = session?.battery_level ?? null;
  const BatteryIcon = batteryLevel == null ? Battery : batteryLevel <= 20 ? BatteryLow : batteryLevel <= 60 ? BatteryMedium : BatteryFull;
  const batteryColor = batteryLevel == null ? "text-muted-foreground" : batteryLevel <= 20 ? "text-red-500" : batteryLevel <= 60 ? "text-amber-500" : "text-emerald-500";

  return (
    <Card className="relative overflow-hidden">
      <div className={`h-1 ${isConnected ? "bg-emerald-500" : "bg-red-500"}`} />
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="space-y-0.5 min-w-0">
            <CardTitle className="text-sm font-semibold truncate">{session?.label ?? "Sesión sin nombre"}</CardTitle>
            <div className="text-[11px] text-muted-foreground truncate">{session?.phone_number ?? session?.me_wa_id ?? "Sin número"}</div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={isConnected ? "default" : "destructive"} className={`text-[10px] gap-1 ${isConnected ? "bg-emerald-500 hover:bg-emerald-600" : ""}`}>
              {isConnected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {isConnected ? "Conectado" : "Desconectado"}
            </Badge>
            <Button
              variant="destructive"
              size="sm"
              className="h-8 text-xs gap-1"
              onClick={() => {
                if (window.confirm("¿Eliminar esta sesión? Esta acción no se puede deshacer.")) {
                  deleteMut.mutate(session.id);
                }
              }}
              disabled={deleteMut.isPending}
            >
              <Trash className="h-3 w-3" />
              Borrar
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <BatteryIcon className={`h-3.5 w-3.5 ${batteryColor}`} />
            <span>{batteryLevel != null ? `${batteryLevel}%` : "N/A"}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <MonitorSmartphone className="h-3.5 w-3.5" />
            <span className="truncate">{session?.platform ?? "Desconocido"}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground col-span-2">
            <Smartphone className="h-3.5 w-3.5" />
            <span className="truncate">{session?.device_name ?? "Dispositivo no reportado"}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Activity className="h-3 w-3" />
          {syncText}
        </div>
        <div className="space-y-1.5 pt-1">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Mi número WhatsApp</label>
          <div className="flex gap-2">
            <Input className="h-8 text-xs" placeholder="573001234567" value={meValue} onChange={(e) => setMeValue(e.target.value)} inputMode="numeric" />
            <Button className="h-8 text-xs" onClick={() => meMut.mutate(meValue)} disabled={meMut.isPending}>
              Guardar
            </Button>
          </div>
        </div>
        <div className="rounded-md bg-muted p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Backend</span>
            <CopyButton value={backendBase} />
          </div>
          <div className="break-all text-muted-foreground">{backendBase}</div>
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
            <span className="text-muted-foreground">Token</span>
            <CopyButton value={session?.session_token ?? ""} />
          </div>
          <div className="break-all text-muted-foreground">{session?.session_token ?? "N/A"}</div>
        </div>
        <Sheet open={cfgOpen} onOpenChange={setCfgOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="w-full h-8 text-xs gap-1">
              <Settings className="h-3 w-3" />
              Configurar enrutamiento
            </Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle className="text-sm">Enrutamiento: {session.label}</SheetTitle>
            </SheetHeader>
            <div className="space-y-4 pt-4 text-xs">
              <div className="space-y-1.5">
                <label className="text-muted-foreground flex items-center gap-1">
                  <User className="h-3 w-3" /> Agente por defecto
                </label>
                <Select
                  value={session.default_agent_id ?? "none"}
                  onValueChange={(v) =>
                    cfgMut.mutate({ defaultAgentId: v === "none" ? null : v, defaultFlowId: session.default_flow_id })
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Sin asignar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin asignar</SelectItem>
                    {(membersData?.members ?? []).map((m: { id: string; display_name?: string; email?: string }) => (
                      <SelectItem key={m.id} value={m.id}>{m.display_name ?? m.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-muted-foreground flex items-center gap-1">
                  <Workflow className="h-3 w-3" /> Flujo por defecto
                </label>
                <Select
                  value={session.default_flow_id ?? "none"}
                  onValueChange={(v) =>
                    cfgMut.mutate({ defaultAgentId: session.default_agent_id, defaultFlowId: v === "none" ? null : v })
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Sin flujo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin flujo</SelectItem>
                    {(flowsData?.items ?? []).map((f: { id: string; name: string }) => (
                      <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Cuando llegue un mensaje nuevo, el contacto se asignará al agente elegido y se inscribirá automáticamente en el flujo seleccionado.
              </p>
            </div>
          </SheetContent>
        </Sheet>
      </CardContent>
    </Card>
  );
}

function CopyButton({ value }: { value: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1"
      onClick={() => {
        navigator.clipboard.writeText(value);
        toast.success("Copiado");
      }}
    >
      <Copy className="h-3 w-3" /> Copiar
    </Button>
  );
}
