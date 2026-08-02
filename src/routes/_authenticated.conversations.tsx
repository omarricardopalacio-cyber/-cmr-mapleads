// @ts-nocheck
import { createFileRoute, Link, Outlet, useParams } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listThreads } from "@/lib/crm.functions";
import { sendDirectMessage } from "@/lib/messaging.functions";
import { listSessions } from "@/lib/sessions.functions";
import { getOrgStats, syncWaSessions, syncThreads, syncContacts } from "@/lib/org.functions";
import { listTags, createTag, deleteTag } from "@/lib/tags.functions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Search, Trash2, Inbox, User, Users, AlertTriangle, RefreshCw, X, ChevronDown, Tag } from "lucide-react";
import { getContactDisplayName, formatPhoneOrWaId, isBlankLidContact } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/conversations")({
  component: ConversationsLayout,
});

function ConversationsLayout() {
  const fn = useServerFn(listThreads);
  const listTagsFn = useServerFn(listTags);
  const createTagFn = useServerFn(createTag);
  const deleteTagFn = useServerFn(deleteTag);
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [filterTab, setFilterTab] = useState<"all" | "mine" | "unassigned">("all");
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#00a884");

  const { data, isLoading } = useQuery({
    queryKey: ["threads", filterTab],
    queryFn: () => fn({ data: { filter: filterTab } }),
    // La lista reciente se refresca con moderación para dejar capacidad a
    // ingest, comandos, IA y al chat activo.
    refetchInterval: 30_000,
    staleTime: 20_000,
    refetchOnWindowFocus: false,
  });
  const params = useParams({ strict: false }) as { threadId?: string };
  const activeId = params.threadId;

  const { data: tagsData } = useQuery({
    queryKey: ["conversationTags"],
    queryFn: () => listTagsFn({}),
  });

  const createTagMut = useMutation({
    mutationFn: (vars: { name: string; color: string }) => createTagFn({ data: vars }),
    onSuccess: () => {
      setNewTagName("");
      qc.invalidateQueries({ queryKey: ["conversationTags"] });
      toast.success("Etiqueta creada");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteTagMut = useMutation({
    mutationFn: (vars: { tagId: string }) => deleteTagFn({ data: vars }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversationTags"] });
      toast.success("Etiqueta eliminada");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const threads = (data?.threads ?? []).filter((t) => {
    const c = Array.isArray(t.contacts) ? t.contacts[0] : t.contacts;
    // Ocultar LID vacío solo si no hay actividad (sin mensajes)
    const hasActivity = !!(t as any).last_message_at;
    if (isBlankLidContact(c as any) && !hasActivity) return false;
    if (!q.trim()) return true;
    const hay = `${c?.display_name ?? ""} ${c?.wa_id ?? ""} ${c?.phone ?? ""}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });


  return (
    <div className="flex h-[calc(100vh-5rem)] min-h-0 -m-4 md:-m-6 border-t overflow-hidden">
      {/* Sidebar lista de chats */}
      <aside className="w-full md:w-80 lg:w-96 border-r flex flex-col bg-card">
        <div className="p-3 border-b flex items-center gap-2">
          <h1 className="font-semibold flex-1">Chats</h1>
          <NewChatDialog />
        </div>
        <div className="p-3 border-b space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs text-muted-foreground">Etiquetas globales para organizar tus conversaciones.</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={newTagColor}
                onChange={(e) => setNewTagColor(e.target.value)}
                className="h-8 w-8 rounded border border-input p-0"
              />
            </div>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Input
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              placeholder="Nombre de etiqueta"
              className="h-9 text-xs"
            />
            <Button
              size="sm"
              disabled={!newTagName.trim() || createTagMut.isPending}
              onClick={() => createTagMut.mutate({ name: newTagName.trim(), color: newTagColor })}
            >
              Crear
            </Button>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="w-full h-9 justify-between text-xs font-normal"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">
                    {(tagsData?.tags ?? []).length === 0
                      ? "Sin etiquetas"
                      : `Etiquetas (${(tagsData?.tags ?? []).length})`}
                  </span>
                </span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[240px] max-h-64 overflow-y-auto">
              {(tagsData?.tags ?? []).length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                  No hay etiquetas creadas aún.
                </div>
              ) : (
                (tagsData?.tags ?? []).map((tag: { id: string; name: string; color: string }) => (
                  <DropdownMenuItem
                    key={tag.id}
                    className="flex items-center justify-between gap-2 cursor-default"
                    onSelect={(e) => e.preventDefault()}
                  >
                    <span className="flex items-center gap-2 min-w-0 flex-1">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: tag.color }}
                      />
                      <span className="truncate text-xs">{tag.name}</span>
                    </span>
                    <button
                      type="button"
                      title={`Eliminar "${tag.name}"`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`¿Estás seguro de que deseas eliminar la etiqueta "${tag.name}"?`)) {
                          deleteTagMut.mutate({ tagId: tag.id });
                        }
                      }}
                      className="shrink-0 p-1 rounded hover:bg-destructive/15 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {/* DiagnosticsPanel oculto temporalmente */}
        {/* <DiagnosticsPanel /> */}
        <div className="p-2 border-b space-y-2">
          <Tabs value={filterTab} onValueChange={(v) => setFilterTab(v as "all" | "mine" | "unassigned")} className="w-full">
            <TabsList className="grid w-full grid-cols-3 h-8">
              <TabsTrigger value="all" className="text-[10px] gap-1 px-1"><Users className="h-3 w-3" /> Todos</TabsTrigger>
              <TabsTrigger value="mine" className="text-[10px] gap-1 px-1"><User className="h-3 w-3" /> Míos</TabsTrigger>
              <TabsTrigger value="unassigned" className="text-[10px] gap-1 px-1"><Inbox className="h-3 w-3" /> Sin asignar</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar..."
              className="pl-8 h-9"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading && <p className="p-4 text-sm text-muted-foreground">Cargando...</p>}
          {!isLoading && threads.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground text-center">
              Sin conversaciones. Pulsa + para iniciar una.
            </p>
          )}
          {threads.map((t, idx) => {
            const c = Array.isArray(t.contacts) ? t.contacts[0] : t.contacts;
            const active = activeId === t.id;
            const contactLabel = getContactDisplayName(c as any, idx + 1);
            const contactMeta = formatPhoneOrWaId(c as any);
            const intent = t.purchase_intent ?? "pending";
            const rawTags = Array.isArray(c?.contact_tags) ? c.contact_tags : [];
            const contactTags = rawTags
              .filter((x: { tags?: { id: string; name: string; color: string } }) => x?.tags)
              .map((x: { tags: { id: string; name: string; color: string } }) => x.tags);
            return (
              <Link
                key={t.id}
                to="/conversations/$threadId"
                params={{ threadId: t.id }}
                className={`block px-3 py-3 border-b hover:bg-muted/50 transition-colors ${
                  active ? "bg-muted" : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  {c?.profile_picture_url ? (
                    <img
                      src={c.profile_picture_url}
                      alt={contactLabel}
                      className="h-10 w-10 rounded-full object-cover shrink-0"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        (e.currentTarget.nextElementSibling as HTMLElement)?.style.removeProperty('display');
                      }}
                    />
                  ) : null}
                  <div className={`h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-medium shrink-0 ${c?.profile_picture_url ? 'hidden' : ''}`}>
                    {(contactLabel || "?").slice(0, 1).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="font-medium truncate">
                        {contactLabel}
                      </div>
                      <div className="text-[10px] text-muted-foreground shrink-0">
                        {t.last_message_at
                          ? new Date(t.last_message_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : ""}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground font-mono truncate">
                      {contactMeta}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {t.channel === "web" ? (
                        <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full border border-sky-500/40 text-sky-700 bg-sky-500/10">Web</span>
                      ) : (
                        <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full border border-emerald-500/40 text-emerald-700 bg-emerald-500/10">WA</span>
                      )}
                      {intent === "compro" ? (
                        <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full border border-green-500/40 text-green-700 bg-green-500/10">🛒 Compró</span>
                      ) : intent === "no_compro" ? (
                        <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full border border-red-500/40 text-red-700 bg-red-500/10">🔴 No compró</span>
                      ) : String(intent).startsWith("collecting_data") ? (
                        <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full border border-amber-500/40 text-amber-700 bg-amber-500/10">🟡 Agendando</span>
                      ) : null}
                    </div>
                    {contactTags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {contactTags.map((tag: { id: string; name: string; color: string }) => (
                          <span
                            key={tag.id}
                            className="inline-block text-[10px] px-1.5 py-0.5 rounded-full border"
                            style={{ borderColor: tag.color, color: tag.color, backgroundColor: `${tag.color}20` }}
                          >
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {t.unread_count > 0 && (
                    <span className="rounded-full bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 self-center">
                      {t.unread_count}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </aside>

      {/* Panel de chat */}
      <main className="flex-1 hidden md:flex flex-col bg-muted/10 min-h-0 min-w-0 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}

function DiagnosticsPanel() {
  const statsFn = useServerFn(getOrgStats);
  const syncSessFn = useServerFn(syncWaSessions);
  const syncThrFn = useServerFn(syncThreads);
  const syncContFn = useServerFn(syncContacts);
  const qc = useQueryClient();

  const { data: stats, isLoading } = useQuery({
    queryKey: ["orgStats"],
    queryFn: () => statsFn({}),
    refetchInterval: 15000,
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["orgStats"] });
    qc.invalidateQueries({ queryKey: ["threads"] });
    qc.invalidateQueries({ queryKey: ["sessions"] });
    qc.invalidateQueries({ queryKey: ["contacts"] });
  };

  const syncSess = useMutation({
    mutationFn: () => syncSessFn({}),
    onSuccess: (res) => { toast.success(`${res.synced} sesiones sincronizadas`); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const syncThr = useMutation({
    mutationFn: () => syncThrFn({}),
    onSuccess: (res) => { toast.success(`${res.synced} chats sincronizados`); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const syncCont = useMutation({
    mutationFn: () => syncContFn({}),
    onSuccess: (res) => { toast.success(`${res.synced} contactos sincronizados`); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const orgId = stats?.orgId ?? "—";
  const sessionsCount = stats?.sessionsCount ?? 0;
  const threadsCount = stats?.threadsCount ?? 0;
  const contactsCount = stats?.contactsCount ?? 0;
  const orphanSess = stats?.orphanSessionsCount ?? 0;
  const orphanThr = stats?.orphanThreadsCount ?? 0;
  const orphanCont = stats?.orphanContactsCount ?? 0;
  const anyOrphan = orphanSess > 0 || orphanThr > 0 || orphanCont > 0;

  return (
    <div className="m-2 p-2 rounded-md border bg-amber-50 text-amber-900 border-amber-200 text-xs space-y-1.5">
      <div className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
        Diagnóstico de Conexión
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
        <span className="text-amber-700">🔑 Org ID:</span>
        <span className="font-mono truncate">{orgId}</span>
        <span className="text-amber-700">📡 Sesiones:</span>
        <span>{isLoading ? "..." : sessionsCount}</span>
        <span className="text-amber-700">💬 Chats:</span>
        <span>{isLoading ? "..." : threadsCount}</span>
        <span className="text-amber-700">👤 Contactos:</span>
        <span>{isLoading ? "..." : contactsCount}</span>
      </div>
      {anyOrphan && (
        <div className="pt-1 space-y-1">
          {orphanSess > 0 && (
            <Button variant="destructive" size="sm" className="w-full text-[11px] h-7 gap-1" onClick={() => syncSess.mutate()} disabled={syncSess.isPending}>
              <RefreshCw className={`h-3 w-3 ${syncSess.isPending ? "animate-spin" : ""}`} />
              Sincronizar {orphanSess} sesión(es)
            </Button>
          )}
          {orphanThr > 0 && (
            <Button variant="destructive" size="sm" className="w-full text-[11px] h-7 gap-1" onClick={() => syncThr.mutate()} disabled={syncThr.isPending}>
              <RefreshCw className={`h-3 w-3 ${syncThr.isPending ? "animate-spin" : ""}`} />
              Sincronizar {orphanThr} chat(s)
            </Button>
          )}
          {orphanCont > 0 && (
            <Button variant="destructive" size="sm" className="w-full text-[11px] h-7 gap-1" onClick={() => syncCont.mutate()} disabled={syncCont.isPending}>
              <RefreshCw className={`h-3 w-3 ${syncCont.isPending ? "animate-spin" : ""}`} />
              Sincronizar {orphanCont} contacto(s)
            </Button>
          )}
        </div>
      )}
      {!anyOrphan && !isLoading && (
        <p className="text-[10px] text-amber-600">Todo sincronizado. No hay datos huérfanos.</p>
      )}
    </div>
  );
}

function NewChatDialog() {
  const sessionsFn = useServerFn(listSessions);
  const sendFn = useServerFn(sendDirectMessage);
  const { data } = useQuery({ queryKey: ["sessions"], queryFn: () => sessionsFn({}) });
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [chatId, setChatId] = useState("");
  const [text, setText] = useState("");

  const sessions = data?.sessions ?? [];
  const connected = sessions.filter((s) => s.status === "connected");

  const mut = useMutation({
    mutationFn: (vars: { sessionId: string; chatId: string; text: string }) =>
      sendFn({ data: vars }),
    onSuccess: () => {
      toast.success("Mensaje encolado. La extensión lo enviará.");
      setText("");
      setChatId("");
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const sid = sessionId || connected[0]?.id || sessions[0]?.id;
    if (!sid) return toast.error("No hay sesiones activas.");
    if (!chatId.trim()) return toast.error("Falta el número");
    if (!text.trim()) return toast.error("Falta el mensaje");
    mut.mutate({ sessionId: sid, chatId: chatId.trim(), text: text.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost">
          <Plus className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo mensaje</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <select
            className="w-full bg-background border rounded-md px-3 py-2 text-sm"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
          >
            <option value="">
              {sessions.length === 0
                ? "Sin sesiones"
                : `Auto (${connected[0]?.label || sessions[0]?.label})`}
            </option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} — {s.status}
              </option>
            ))}
          </select>
          <Input
            placeholder="Número con código país (ej: 521234567890)"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
          />
          <Textarea
            placeholder="Mensaje..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
          />
          <div className="flex justify-end">
            <Button type="submit" disabled={mut.isPending}>
              {mut.isPending ? "Enviando..." : "Enviar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
