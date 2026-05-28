import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { listSessions, createSession } from "@/lib/sessions.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Copy } from "lucide-react";

export const Route = createFileRoute("/_authenticated/sessions")({
  component: SessionsPage,
});

function SessionsPage() {
  const listFn = useServerFn(listSessions);
  const createFn = useServerFn(createSession);
  const qc = useQueryClient();
  const [label, setLabel] = useState("");

  const { data, isLoading } = useQuery({ queryKey: ["wa-sessions"], queryFn: () => listFn({}) });
  const mut = useMutation({
    mutationFn: (l: string) => createFn({ data: { label: l } }),
    onSuccess: () => {
      toast.success("Sesión creada");
      setLabel("");
      qc.invalidateQueries({ queryKey: ["wa-sessions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const backendBase = "https://project--289483ef-62cc-4bc6-91f6-2ef8e90b8d34-dev.lovable.app";
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Sesiones de WhatsApp</h1>
        <p className="text-muted-foreground text-sm">
          Cada sesión = un número/dispositivo conectado a través de la extensión.
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

      <div className="space-y-2">
        {isLoading && <p className="text-muted-foreground">Cargando...</p>}
        {data?.sessions.map((s) => (
          <Card key={s.id} className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{s.label}</div>
                <div className="text-xs text-muted-foreground">
                  Última señal: {s.last_heartbeat_at ? new Date(s.last_heartbeat_at).toLocaleString() : "nunca"}
                </div>
              </div>
              <Badge variant={s.status === "connected" ? "default" : "secondary"}>{s.status}</Badge>
            </div>
            <div className="rounded-md bg-muted p-3 text-xs font-mono space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Backend URL</span>
                <CopyButton value={backendBase} />
              </div>
              <div className="break-all">{backendBase}</div>
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
                <span className="text-muted-foreground">Session token</span>
                <CopyButton value={s.session_token} />
              </div>
              <div className="break-all">{s.session_token}</div>
            </div>
          </Card>
        ))}
      </div>
    </div>
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
