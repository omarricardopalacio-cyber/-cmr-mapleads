// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  listLeads,
  updateLead,
  deleteLead,
  getOrCreateIngestToken,
  rotateIngestToken,
} from "@/lib/leads.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Download,
  Edit,
  Trash2,
  RefreshCw,
  Copy,
  CheckCircle,
  Search,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/mapleads")({
  component: MapleadsPage,
});

function MapleadsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Búsqueda de clientes · Mapleads</h1>
      <MapleadsContent />
    </div>
  );
}

function MapleadsContent() {
  const qc = useQueryClient();
  const listFn = useServerFn(listLeads);
  const updateFn = useServerFn(updateLead);
  const deleteFn = useServerFn(deleteLead);
  const tokenFn = useServerFn(getOrCreateIngestToken);
  const rotateFn = useServerFn(rotateIngestToken);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [onlyUnsent, setOnlyUnsent] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["leads", { from, to, search, onlyUnsent }],
    queryFn: () =>
      listFn({
        data: {
          from: from ? new Date(from).toISOString() : undefined,
          to: to ? new Date(to + "T23:59:59").toISOString() : undefined,
          search: search || undefined,
          onlyUnsent: onlyUnsent || undefined,
        },
      }),
  });

  const { data: tokenData } = useQuery({
    queryKey: ["mapleadsToken"],
    queryFn: () => tokenFn({}),
  });

  const backendUrl =
    typeof window !== "undefined" ? window.location.origin : "";

  const handleDownloadCsv = () => {
    const rows = data?.items ?? [];
    const headers = [
      "scraped_at",
      "name",
      "phone",
      "email",
      "address",
      "city",
      "category",
      "website",
      "rating",
      "review_count",
      "open_status",
      "campaign_name",
      "message_sent_at",
    ];
    const esc = (v: any) => {
      const s = v == null ? "" : String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };
    const csv = [
      headers.join(","),
      ...rows.map((r: any) => headers.map((h) => esc(r[h])).join(",")),
    ].join("\n");
    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mapleads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Leads recopilados desde Google Maps por la extensión Mapleads.
        </p>
        <Button variant="outline" size="sm" onClick={handleDownloadCsv}>
          <Download className="h-4 w-4 mr-1" /> Exportar CSV
        </Button>
      </div>

      {/* Totales */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total leads" value={data?.total ?? 0} />
        <StatCard label="Con teléfono" value={data?.with_phone ?? 0} />
        <StatCard label="Mensajes enviados" value={data?.sent_count ?? 0} />
        <StatCard label="En vista (filtrados)" value={data?.filtered_count ?? 0} />
      </div>

      {/* Bloque de conexión a la extensión */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-sm">Configuración de la extensión Mapleads</h3>
          <Button variant="default" size="sm" asChild>
            <a href="/mapleads-extension.zip" download>
              <Download className="h-4 w-4 mr-1" /> Descargar extensión
            </a>
          </Button>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Backend URL (cópialo en la extensión)</Label>
            <div className="flex gap-1">
              <Input readOnly value={backendUrl} className="text-xs" />
              <Button
                size="icon"
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(backendUrl);
                  toast.success("URL copiada");
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Token de ingest</Label>
            <div className="flex gap-1">
              <Input
                readOnly
                value={tokenData?.token ?? "Cargando..."}
                type="password"
                className="text-xs"
              />
              <Button
                size="icon"
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(tokenData?.token ?? "");
                  toast.success("Token copiado");
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="outline"
                title="Rotar token"
                onClick={async () => {
                  if (
                    !confirm(
                      "¿Generar token nuevo? El anterior dejará de funcionar.",
                    )
                  )
                    return;
                  await rotateFn({});
                  qc.invalidateQueries({ queryKey: ["mapleadsToken"] });
                  toast.success("Token rotado correctamente");
                }}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Pégalo en el panel lateral de la extensión → "Conexión al backend".
            </p>
          </div>
        </div>
      </Card>

      {/* Filtros */}
      <Card className="p-3 flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[200px]">
          <Label className="text-xs">Buscar</Label>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="nombre, teléfono, ciudad"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div>
          <Label className="text-xs">Desde</Label>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs">Hasta</Label>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <Button
          variant={onlyUnsent ? "default" : "outline"}
          size="sm"
          onClick={() => setOnlyUnsent((v) => !v)}
        >
          Solo no enviados
        </Button>
        {(from || to || search || onlyUnsent) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFrom("");
              setTo("");
              setSearch("");
              setOnlyUnsent(false);
            }}
          >
            Limpiar
          </Button>
        )}
      </Card>

      {/* Tabla */}
      <Card className="p-0 overflow-hidden">
        <div className="max-h-[55vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs sticky top-0">
              <tr>
                <th className="text-left p-2">Nombre</th>
                <th className="text-left p-2">Teléfono</th>
                <th className="text-left p-2">Ciudad</th>
                <th className="text-left p-2">Categoría</th>
                <th className="text-left p-2">Fecha</th>
                <th className="text-left p-2">Estado</th>
                <th className="text-right p-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td
                    colSpan={7}
                    className="text-center p-6 text-muted-foreground"
                  >
                    Cargando...
                  </td>
                </tr>
              )}
              {!isLoading && (data?.items.length ?? 0) === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="text-center p-6 text-muted-foreground"
                  >
                    Sin leads aún. Configura la extensión Mapleads y empieza a
                    extraer.
                  </td>
                </tr>
              )}
              {data?.items.map((l: any) => (
                <tr key={l.id} className="border-t hover:bg-muted/40">
                  <td className="p-2 font-medium">{l.name || "—"}</td>
                  <td className="p-2 font-mono text-xs">{l.phone || "—"}</td>
                  <td className="p-2">{l.city || "—"}</td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {l.category || l.maps_category || "—"}
                  </td>
                  <td className="p-2 text-xs">
                    {l.scraped_at
                      ? new Date(l.scraped_at).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="p-2">
                    {l.message_sent_at ? (
                      <Badge className="bg-green-600 text-white text-[10px]">
                        <CheckCircle className="h-3 w-3 mr-1" /> Enviado
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        Nuevo
                      </Badge>
                    )}
                  </td>
                  <td className="p-2 text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setEditing(l)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={async () => {
                        if (!confirm("¿Eliminar este lead?")) return;
                        await deleteFn({ data: { id: l.id } });
                        qc.invalidateQueries({ queryKey: ["leads"] });
                        toast.success("Lead eliminado");
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Modal de edición */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar lead</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Nombre</Label>
                <Input
                  value={editing.name || ""}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                />
              </div>
              <div>
                <Label className="text-xs">Teléfono</Label>
                <Input
                  value={editing.phone || ""}
                  onChange={(e) =>
                    setEditing({ ...editing, phone: e.target.value })
                  }
                />
              </div>
              <div>
                <Label className="text-xs">Ciudad</Label>
                <Input
                  value={editing.city || ""}
                  onChange={(e) =>
                    setEditing({ ...editing, city: e.target.value })
                  }
                />
              </div>
              <div>
                <Label className="text-xs">Email</Label>
                <Input
                  value={editing.email || ""}
                  onChange={(e) =>
                    setEditing({ ...editing, email: e.target.value })
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button
              onClick={async () => {
                await updateFn({
                  data: {
                    id: editing.id,
                    name: editing.name,
                    phone: editing.phone,
                    city: editing.city,
                    email: editing.email,
                  },
                });
                setEditing(null);
                qc.invalidateQueries({ queryKey: ["leads"] });
                toast.success("Lead actualizado");
              }}
            >
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <Card className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </Card>
  );
}
