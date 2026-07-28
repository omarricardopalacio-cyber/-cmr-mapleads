import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { listContacts } from "@/lib/crm.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowUpDown, Download } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/contacts")({
  component: ContactsPage,
});

type ContactRow = {
  id: string;
  wa_id: string;
  display_name: string | null;
  phone: string | null;
  updated_at: string;
  message_count: number | null;
  purchased: boolean;
  asked_products?: string | null;
  asked_questions?: string | null;
};

function previewLines(raw: string | null | undefined, max = 3): string {
  const lines = String(raw || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length === 0) return "—";
  const shown = lines.slice(0, max);
  const extra = lines.length > max ? ` (+${lines.length - max})` : "";
  return shown.join(" · ") + extra;
}

function ContactsPage() {
  const fn = useServerFn(listContacts);
  const { data, isLoading } = useQuery({ queryKey: ["contacts"], queryFn: () => fn({}) });

  const [statusFilter, setStatusFilter] = useState<"all" | "bought" | "not">("all");
  const [minMessages, setMinMessages] = useState<string>("");
  const [sortMessages, setSortMessages] = useState<"none" | "asc" | "desc">("none");
  const [q, setQ] = useState("");

  const contacts = (data?.contacts ?? []) as ContactRow[];

  const filtered = useMemo(() => {
    const min = Number.parseInt(minMessages, 10);
    const hasMin = Number.isFinite(min) && min > 0;
    const needle = q.trim().toLowerCase();

    let rows = contacts.filter((c) => {
      if (statusFilter === "bought" && !c.purchased) return false;
      if (statusFilter === "not" && c.purchased) return false;
      if (hasMin && (c.message_count ?? 0) < min) return false;
      if (needle) {
        const hay = [
          c.display_name,
          c.phone,
          c.wa_id,
          c.asked_products,
          c.asked_questions,
        ]
          .filter(Boolean)
          .join("\n")
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });

    if (sortMessages !== "none") {
      rows = [...rows].sort((a, b) => {
        const av = a.message_count ?? 0;
        const bv = b.message_count ?? 0;
        return sortMessages === "asc" ? av - bv : bv - av;
      });
    }
    return rows;
  }, [contacts, statusFilter, minMessages, sortMessages, q]);

  function toggleSortMessages() {
    setSortMessages((prev) => (prev === "desc" ? "asc" : prev === "asc" ? "none" : "desc"));
  }

  function downloadExcel() {
    if (filtered.length === 0) {
      toast.info("No hay contactos para exportar");
      return;
    }
    const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = [
      "Nombre",
      "WhatsApp ID",
      "Teléfono",
      "Estado",
      "Mensajes",
      "Productos consultados",
      "Preguntas",
      "Actualizado",
    ];
    const rows = filtered.map((c) =>
      [
        escape(c.display_name || ""),
        escape(c.wa_id || ""),
        escape(c.phone || ""),
        escape(c.purchased ? "Compró" : "No compró"),
        escape(c.message_count ?? 0),
        escape(c.asked_products || ""),
        escape(c.asked_questions || ""),
        escape(new Date(c.updated_at).toLocaleString()),
      ].join(","),
    );
    const csv = "\ufeff" + [header.map(escape).join(","), ...rows].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", `Contactos_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold">Contactos</h1>
        <Button onClick={downloadExcel} variant="outline" className="gap-2">
          <Download className="h-4 w-4" />
          Descargar Excel
        </Button>
      </div>

      <Card className="p-3 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground block">Estado</label>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
            <SelectTrigger className="h-9 w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="bought">Compró</SelectItem>
              <SelectItem value="not">No compró</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground block">Mín. de mensajes</label>
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="0"
            className="h-9 w-[140px]"
            value={minMessages}
            onChange={(e) => setMinMessages(e.target.value)}
          />
        </div>
        <div className="space-y-1 min-w-[220px] flex-1">
          <label className="text-xs text-muted-foreground block">Buscar (nombre, producto, pregunta)</label>
          <Input
            className="h-9"
            placeholder="Ej. envío, AB VERTICAL…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="text-xs text-muted-foreground ml-auto">
          {filtered.length} de {contacts.length} contactos
        </div>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Teléfono</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>
                <button
                  type="button"
                  onClick={toggleSortMessages}
                  className="inline-flex items-center gap-1 hover:text-foreground transition"
                  title="Ordenar por número de mensajes"
                >
                  Mensajes
                  <ArrowUpDown className="h-3.5 w-3.5 opacity-70" />
                  {sortMessages !== "none" && (
                    <span className="text-[10px] text-muted-foreground">
                      {sortMessages === "asc" ? "↑" : "↓"}
                    </span>
                  )}
                </button>
              </TableHead>
              <TableHead className="min-w-[160px]">Productos consultados</TableHead>
              <TableHead className="min-w-[200px]">Preguntas</TableHead>
              <TableHead>Actualizado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  Cargando...
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  {contacts.length === 0
                    ? "Sin contactos todavía. Conecta una sesión de WhatsApp."
                    : "Ningún contacto coincide con los filtros."}
                </TableCell>
              </TableRow>
            )}
            {filtered.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <div className="font-medium">{c.display_name || "—"}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">{c.wa_id}</div>
                </TableCell>
                <TableCell>{c.phone || "—"}</TableCell>
                <TableCell>
                  {c.purchased ? (
                    <Badge className="bg-emerald-500 hover:bg-emerald-600">Compró</Badge>
                  ) : (
                    <Badge variant="secondary">No compró</Badge>
                  )}
                </TableCell>
                <TableCell>{c.message_count ?? "—"}</TableCell>
                <TableCell className="text-xs whitespace-pre-wrap max-w-[220px]" title={c.asked_products || ""}>
                  {previewLines(c.asked_products, 4)}
                </TableCell>
                <TableCell className="text-xs whitespace-pre-wrap max-w-[280px]" title={c.asked_questions || ""}>
                  {previewLines(c.asked_questions, 3)}
                </TableCell>
                <TableCell className="text-xs">{new Date(c.updated_at).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
