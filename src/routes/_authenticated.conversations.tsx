// @ts-nocheck
import { createFileRoute, Link, Outlet, useParams } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listThreads } from "@/lib/crm.functions";
import { clearAllChats, sendDirectMessage } from "@/lib/messaging.functions";
import { listSessions } from "@/lib/sessions.functions";
import { getOrgStats, syncWaSessions, syncThreads, syncContacts } from "@/lib/org.functions";
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
import { Plus, Search, Trash2, Inbox, User, Users, AlertTriangle, RefreshCw } from "lucide-react";
import { getContactDisplayName, formatPhoneOrWaId } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/conversations")({
  component: ConversationsLayout,
});

function ConversationsLayout() {
  const fn = useServerFn(listThreads);
  const clearAll = useServerFn(clearAllChats);
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [filterTab, setFilterTab] = useState<"all" | "mine" | "unassigned">("all");

  const { data, isLoading } = useQuery({
    queryKey: ["threads", filterTab],
    queryFn: () => fn({ data: { filter: filterTab } }),
    refetchInterval: 5000,
  });
  const params = useParams({ strict: false }) as { threadId?: string };
  const activeId = params.threadId;

  const threads = (data?.threads ?? []).filter((t) => {
    if (!q.trim()) return true;
    const c = Array.isArray(t.contacts) ? t.contacts[0] : t.contacts;
    const hay = `${c?.display_name ?? ""} ${c?.wa_id ?? ""}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  const clearAllMut = useMutation({
    mutationFn: () => clearAll(),
    onSuccess: () => {
      toast.success("Todos los chats fueron borrados");
      qc.invalidateQueries({ queryKey: ["threads"] });
      qc.invalidateQueries({ queryKey: ["thread"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex h-[calc(100vh-5rem)] min-h-0 -m-4 md:-m-6 border-t overflow-hidden">
      {/* Sidebar lista de chats */}
      <aside className="w-full md:w-80 lg:w-96 border-r flex flex-col bg-card">
        <div className="p-3 border-b flex items-center gap-2">
          <h1 className="font-semibold flex-1">Chats</h1>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                title="Borrar todos los chats"
                disabled={clearAllMut.isPending}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Borrar todos los chats</AlertDialogTitle>
                <AlertDialogDescription>
                  Esto eliminará conversaciones, mensajes y contactos guardados para empezar de cero.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => clearAllMut.mutate()}>
                  Sí, borrar todo
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <NewChatDialog />
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
    refetchInterval: 10000,
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
