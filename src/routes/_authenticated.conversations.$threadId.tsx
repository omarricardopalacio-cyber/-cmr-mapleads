import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { clearThreadMessages, listMessages, sendMessage, toggleAiEnabled, uploadMedia, assignThreadToAgent } from "@/lib/messaging.functions";
import { listOrgMembers } from "@/lib/crm.functions";
import { listQuickReplies } from "@/lib/automations.functions";
import {
  listTags,
  listContactTags,
  createTag,
  addContactTag,
  removeContactTag,
} from "@/lib/tags.functions";
import { listNotes, createNote, deleteNote } from "@/lib/notes.functions";
import {
  listReminders,
  createReminder,
  completeReminder,
} from "@/lib/reminders.functions";
import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
  ArrowLeft,
  Send,
  Trash2,
  Plus,
  X,
  Tag,
  StickyNote,
  Clock,
  CheckCircle2,
  Zap,
  Paperclip,
  Image,
  FileText,
  Loader2,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { getContactDisplayName, formatPhoneOrWaId } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/conversations/$threadId")({
  component: ThreadPage,
});

function ThreadPage() {
  const { threadId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const list = useServerFn(listMessages);
  const send = useServerFn(sendMessage);
  const clear = useServerFn(clearThreadMessages);
  const toggleAi = useServerFn(toggleAiEnabled);
  const listQr = useServerFn(listQuickReplies);
  const upload = useServerFn(uploadMedia);
  const listMembers = useServerFn(listOrgMembers);
  const assignAgent = useServerFn(assignThreadToAgent);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{ file: File; preview: string } | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: qrData } = useQuery({ queryKey: ["quickReplies"], queryFn: () => listQr({}) });

  const { data, isLoading, error } = useQuery({
    queryKey: ["thread", threadId],
    queryFn: () => list({ data: { threadId } }),
    refetchInterval: 5000,
    retry: false,
  });

  // eslint-disable-next-line no-console
  console.log("[DEBUG] Thread ID:", threadId, "Loading:", isLoading, "Error:", error, "Data messages:", (data?.messages ?? []).length);

  const aiEnabled = (data as unknown as Record<string, unknown>)?.thread?.aiEnabled ?? true;

  const toggleAiMut = useMutation({
    mutationFn: (v: boolean) => toggleAi({ data: { threadId, aiEnabled: v } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["thread", threadId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: membersData } = useQuery({
    queryKey: ["orgMembers"],
    queryFn: () => listMembers({}),
  });

  const assignMut = useMutation({
    mutationFn: (agentUserId: string | null) => assignAgent({ data: { threadId, agentUserId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["thread", threadId] });
      qc.invalidateQueries({ queryKey: ["threads"] });
      toast.success("Agente asignado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    if (!isLoading && data === null) navigate({ to: "/conversations" });
  }, [data, isLoading, navigate]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
  }, [(data?.messages ?? []).length]);

  useEffect(() => {
    const ch = supabase
      .channel(`thread-${threadId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `thread_id=eq.${threadId}` },
        () => qc.invalidateQueries({ queryKey: ["thread", threadId] })
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [threadId, qc]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const preview = URL.createObjectURL(file);
    setSelectedFile({ file, preview });
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!text.trim() && !selectedFile) || sending || uploading) return;
    setSending(true);
    try {
      let payloadText = text.trim();
      let mediaUrl: string | null = null;
      let mimeType: string | null = null;

      if (selectedFile) {
        setUploading(true);
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            const result = reader.result as string;
            const base64Data = result.split(",")[1];
            resolve(base64Data);
          };
          reader.onerror = reject;
          reader.readAsDataURL(selectedFile.file);
        });
        const { url } = await upload({ data: { base64, fileName: selectedFile.file.name, mimeType: selectedFile.file.type } });
        mediaUrl = url;
        mimeType = selectedFile.file.type;
        setUploading(false);
        setSelectedFile(null);
      }

      if (payloadText.startsWith("/")) {
        const shortcut = payloadText.split(" ")[0].slice(1);
        const qr = (qrData?.items ?? []).find((r: { shortcut?: string }) => r.shortcut === shortcut);
        if (qr) {
          payloadText = qr.text_content || payloadText;
          if (!mediaUrl) {
            mediaUrl = qr.media_url || null;
            mimeType = qr.mime_type || null;
          }
        }
      }

      await send({ data: { threadId, text: payloadText || " ", media_url: mediaUrl, mime_type: mimeType } });
      setText("");
      setShowQr(false);
      toast.success(mediaUrl ? "Multimedia encolada" : "Mensaje encolado");
    } catch (err: unknown) {
      toast.error((err as Error)?.message ?? "Error al enviar");
      setUploading(false);
    } finally {
      setSending(false);
    }
  };

  const clearMut = useMutation({
    mutationFn: () => clear({ data: { threadId } }),
    onSuccess: async () => {
      toast.success("Chat borrado");
      qc.invalidateQueries({ queryKey: ["thread", threadId] });
      qc.invalidateQueries({ queryKey: ["threads"] });
      await navigate({ to: "/conversations" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-3 px-4 py-3 border-b bg-card">
          <Button asChild variant="ghost" size="icon" className="md:hidden">
            <Link to="/conversations">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-medium">
            {getContactDisplayName(data?.thread?.contact ?? null).slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">
              {getContactDisplayName(data?.thread?.contact ?? null)}
            </div>
            <div className="text-xs text-muted-foreground font-mono truncate">
              {formatPhoneOrWaId(data?.thread?.contact ?? null)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground hidden sm:inline">IA</span>
            <Switch checked={aiEnabled} onCheckedChange={(v) => toggleAiMut.mutate(v)} disabled={toggleAiMut.isPending} />
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="text-xs gap-1" disabled={assignMut.isPending}>
                <User className="h-3 w-3" />
                <span className="hidden sm:inline">
                  {(() => {
                    const assignedId = (data as unknown as Record<string, unknown>)?.thread?.assigned_to_user_id as string | undefined;
                    if (!assignedId) return "Sin asignar";
                    const m = (membersData?.members ?? []).find((x: { id: string }) => x.id === assignedId);
                    return m?.displayName ?? "Asignado";
                  })()}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-0" align="end">
              <div className="p-2 border-b text-xs text-muted-foreground">Asignar chat a</div>
              <div className="p-1 space-y-0.5">
                <button
                  type="button"
                  className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted flex items-center gap-2"
                  onClick={() => assignMut.mutate(null)}
                >
                  <span className="text-muted-foreground">Sin asignar</span>
                </button>
                {(membersData?.members ?? []).map((m: { id: string; displayName: string }) => (
                  <button
                    key={m.id}
                    type="button"
                    className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted flex items-center gap-2"
                    onClick={() => assignMut.mutate(m.id)}
                  >
                    <span>{m.displayName}</span>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" title="Borrar chat" disabled={clearMut.isPending}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Borrar chat</AlertDialogTitle>
                <AlertDialogDescription>
                  Se eliminará la conversación completa y ya no aparecerá en la lista.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => clearMut.mutate()}>Sí, borrar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <div
          ref={scrollerRef}
          className="flex-1 overflow-y-auto p-4 space-y-2"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, hsl(var(--muted-foreground) / 0.08) 1px, transparent 0)",
            backgroundSize: "20px 20px",
          }}
        >
          {isLoading && <p className="text-muted-foreground text-sm">Cargando...</p>}
          {!isLoading && (data?.messages?.length ?? 0) === 0 && (
            <p className="text-muted-foreground text-sm text-center">Sin mensajes aún.</p>
          )}
          {(data?.messages ?? []).map((m) => {
            const mediaObj = (m.media as { url?: string; mimeType?: string } | null) ?? null;
            const isImage = mediaObj?.mimeType?.startsWith("image/") || mediaObj?.url?.match(/\.(jpg|jpeg|png|gif|webp)$/i);
            return (
              <div
                key={m.id}
                className={`max-w-[70%] rounded-lg px-3 py-2 text-sm shadow-sm ${
                  m.direction === "out"
                    ? "ml-auto bg-primary text-primary-foreground"
                    : "mr-auto bg-card border"
                }`}
              >
                <div className="whitespace-pre-wrap break-words">
                  {isImage && mediaObj?.url ? (
                    <img
                      src={mediaObj.url}
                      alt="Media"
                      className="max-w-[250px] rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => window.open(mediaObj.url, "_blank")}
                      loading="lazy"
                    />
                  ) : mediaObj?.url ? (
                    <a
                      href={mediaObj.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 underline"
                    >
                      <FileText className="h-4 w-4" />
                      <span>Ver archivo</span>
                    </a>
                  ) : null}
                  {m.text ? <div className={mediaObj?.url ? "mt-2" : ""}>{m.text}</div> : null}
                  {!m.text && !mediaObj?.url && <i className="opacity-60">[mensaje vacío]</i>}
                </div>
                <div className="text-[10px] opacity-70 mt-1 text-right">
                  {m.sent_at ? new Date(m.sent_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                </div>
              </div>
            );
          })}
        </div>

        <form onSubmit={handleSend} className="border-t p-3 flex gap-2 bg-card relative">
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept="image/*,application/pdf"
            onChange={handleFileSelect}
          />
          <Popover open={showQr && !!text.startsWith("/") && (qrData?.items?.length ?? 0) > 0} onOpenChange={setShowQr}>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" onClick={() => setShowQr(true)}>
                    <Zap className="h-4 w-4 text-purple-500" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Escribe / o haz clic aquí para usar respuestas rápidas</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <PopoverContent className="w-64 p-0" align="start">
              <div className="p-2 border-b text-xs text-muted-foreground">Respuestas rápidas</div>
              <ScrollArea className="max-h-48">
                <div className="p-1">
                  {(qrData?.items ?? []).map((r: { id: string; shortcut: string; text_content?: string | null }) => (
                    <button
                      key={r.id}
                      type="button"
                      className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted flex items-center gap-2"
                      onClick={() => { setText(`/${r.shortcut} `); setShowQr(false); }}
                    >
                      <span className="font-mono text-xs text-muted-foreground">/{r.shortcut}</span>
                      <span className="truncate">{r.text_content}</span>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </PopoverContent>
          </Popover>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            title="Adjuntar archivo"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <div className="flex-1 relative">
            {selectedFile && (
              <div className="absolute -top-12 left-0 flex items-center gap-2 bg-muted rounded-md px-2 py-1 text-xs">
                <Image className="h-3 w-3" />
                <span className="max-w-[150px] truncate">{selectedFile.file.name}</span>
                <button type="button" onClick={() => setSelectedFile(null)} className="hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            <Input
              value={text}
              onChange={(e) => { setText(e.target.value); setShowQr(e.target.value.startsWith("/")); }}
              placeholder={selectedFile ? "Añade un mensaje (opcional)..." : "Escribe un mensaje..."}
              disabled={sending || uploading}
              autoFocus
            />
          </div>
          <Button type="submit" disabled={sending || uploading || (!text.trim() && !selectedFile)}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </div>

      {data?.thread?.contactId && (
        <aside className="w-80 border-l bg-card hidden lg:flex flex-col">
          <ContactContextPanel contactId={data.thread.contactId} />
        </aside>
      )}
    </div>
  );
}

function ContactContextPanel({ contactId }: { contactId: string }) {
  const qc = useQueryClient();

  // Tags hooks
  const listTagsFn = useServerFn(listTags);
  const listContactTagsFn = useServerFn(listContactTags);
  const createTagFn = useServerFn(createTag);
  const addContactTagFn = useServerFn(addContactTag);
  const removeContactTagFn = useServerFn(removeContactTag);

  const { data: tagsData } = useQuery({ queryKey: ["tags"], queryFn: () => listTagsFn({}) });
  const { data: contactTagsData } = useQuery({
    queryKey: ["contactTags", contactId],
    queryFn: () => listContactTagsFn({ data: { contactId } }),
    enabled: !!contactId,
  });

  const createTagMut = useMutation({
    mutationFn: (vars: { name: string; color: string }) => createTagFn({ data: vars }),
    onSuccess: () => {
      toast.success("Etiqueta creada");
      qc.invalidateQueries({ queryKey: ["tags"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addTagMut = useMutation({
    mutationFn: (vars: { tagId: string }) =>
      addContactTagFn({ data: { contactId, tagId: vars.tagId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contactTags", contactId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const removeTagMut = useMutation({
    mutationFn: (vars: { tagId: string }) =>
      removeContactTagFn({ data: { contactId, tagId: vars.tagId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contactTags", contactId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#00a884");
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);

  // Notes hooks
  const listNotesFn = useServerFn(listNotes);
  const createNoteFn = useServerFn(createNote);
  const deleteNoteFn = useServerFn(deleteNote);

  const { data: notesData } = useQuery({
    queryKey: ["notes", contactId],
    queryFn: () => listNotesFn({ data: { contactId } }),
    enabled: !!contactId,
  });

  const createNoteMut = useMutation({
    mutationFn: (vars: { content: string }) =>
      createNoteFn({ data: { contactId, content: vars.content } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notes", contactId] });
      setNoteContent("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteNoteMut = useMutation({
    mutationFn: (vars: { noteId: string }) => deleteNoteFn({ data: { noteId: vars.noteId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notes", contactId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const [noteContent, setNoteContent] = useState("");

  // Reminders hooks
  const listRemindersFn = useServerFn(listReminders);
  const createReminderFn = useServerFn(createReminder);
  const completeReminderFn = useServerFn(completeReminder);

  const { data: remindersData } = useQuery({
    queryKey: ["reminders", contactId],
    queryFn: () => listRemindersFn({ data: { contactId } }),
    enabled: !!contactId,
  });

  const createReminderMut = useMutation({
    mutationFn: (vars: { note: string; reminderAt: string }) =>
      createReminderFn({ data: { contactId, note: vars.note, reminderAt: vars.reminderAt } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reminders", contactId] });
      setReminderNote("");
      setReminderAt("");
      setReminderOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const completeReminderMut = useMutation({
    mutationFn: (vars: { reminderId: string }) =>
      completeReminderFn({ data: { reminderId: vars.reminderId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reminders", contactId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const [reminderNote, setReminderNote] = useState("");
  const [reminderAt, setReminderAt] = useState("");
  const [reminderOpen, setReminderOpen] = useState(false);

  interface TagItem { id: string; name: string; color: string; }
  interface NoteItem { id: string; content: string; created_at: string; user_id: string | null; }
  interface ReminderItem { id: string; note: string; reminder_at: string; is_completed: boolean; created_at: string; }

  const allTags = (tagsData?.tags ?? []) as TagItem[];
  const assignedTags = (contactTagsData?.tags ?? []) as TagItem[];
  const assignedTagIds = new Set(assignedTags.map((t) => t.id));
  const availableTags = allTags.filter((t) => !assignedTagIds.has(t.id));

  const notes = (notesData?.notes ?? []) as NoteItem[];
  const reminders = (remindersData?.reminders ?? []) as ReminderItem[];

  return (
    <Tabs defaultValue="tags" className="flex flex-col h-full">
      <TabsList className="mx-3 mt-3 grid grid-cols-3">
        <TabsTrigger value="tags" className="text-xs">
          <Tag className="h-3.5 w-3.5 mr-1" />
          Etiquetas
        </TabsTrigger>
        <TabsTrigger value="notes" className="text-xs">
          <StickyNote className="h-3.5 w-3.5 mr-1" />
          Notas
        </TabsTrigger>
        <TabsTrigger value="reminders" className="text-xs">
          <Clock className="h-3.5 w-3.5 mr-1" />
          Recordatorios
        </TabsTrigger>
      </TabsList>

      <TabsContent value="tags" className="flex-1 flex flex-col m-0 p-3 space-y-3 overflow-hidden">
        <div className="flex flex-wrap gap-1.5">
          {assignedTags.map((t: { id: string; name: string; color: string }) => (
            <Badge
              key={t.id}
              style={{ backgroundColor: t.color, color: getContrastColor(t.color) }}
              className="gap-1 pr-1"
            >
              {t.name}
              <button
                onClick={() => removeTagMut.mutate({ tagId: t.id })}
                className="hover:opacity-70"
                disabled={removeTagMut.isPending}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {assignedTags.length === 0 && (
            <span className="text-xs text-muted-foreground">Sin etiquetas asignadas</span>
          )}
        </div>

        <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="w-full text-xs">
              <Plus className="h-3.5 w-3.5 mr-1" />
              Añadir etiqueta
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 space-y-2">
            <div className="text-xs font-medium text-muted-foreground mb-1">Etiquetas disponibles</div>
            <div className="flex flex-wrap gap-1">
              {availableTags.map((t: { id: string; name: string; color: string }) => (
                <button
                  key={t.id}
                  onClick={() => {
                    addTagMut.mutate({ tagId: t.id });
                    setTagPopoverOpen(false);
                  }}
                  className="text-[10px] px-2 py-1 rounded border hover:bg-muted transition-colors"
                  style={{ borderColor: t.color, color: t.color }}
                >
                  {t.name}
                </button>
              ))}
            </div>
            {availableTags.length === 0 && (
              <div className="text-xs text-muted-foreground">No hay etiquetas disponibles.</div>
            )}
            <div className="border-t pt-2 space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Nueva etiqueta</div>
              <div className="flex gap-1">
                <Input
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  placeholder="Nombre"
                  className="h-8 text-xs flex-1"
                />
                <input
                  type="color"
                  value={newTagColor}
                  onChange={(e) => setNewTagColor(e.target.value)}
                  className="h-8 w-8 rounded border p-0 cursor-pointer"
                />
              </div>
              <Button
                size="sm"
                className="w-full text-xs"
                disabled={!newTagName.trim() || createTagMut.isPending}
                onClick={() => {
                  createTagMut.mutate({ name: newTagName.trim(), color: newTagColor });
                  setNewTagName("");
                }}
              >
                Crear etiqueta
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </TabsContent>

      <TabsContent value="notes" className="flex-1 flex flex-col m-0 overflow-hidden">
        <div className="p-3 border-b space-y-2">
          <Textarea
            value={noteContent}
            onChange={(e) => setNoteContent(e.target.value)}
            placeholder="Escribe una nota interna..."
            rows={2}
            className="text-xs resize-none"
          />
          <Button
            size="sm"
            className="w-full text-xs"
            disabled={!noteContent.trim() || createNoteMut.isPending}
            onClick={() => createNoteMut.mutate({ content: noteContent.trim() })}
          >
            Guardar nota
          </Button>
        </div>
        <ScrollArea className="flex-1 p-3">
          <div className="space-y-2">
            {notes.length === 0 && (
              <p className="text-xs text-muted-foreground text-center">Sin notas aún</p>
            )}
            {notes.map((n: { id: string; content: string; created_at: string; user_id: string | null }) => (
              <Card key={n.id} className="p-2">
                <CardContent className="p-0 space-y-1">
                  <p className="text-xs whitespace-pre-wrap">{n.content}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(n.created_at).toLocaleString()}
                    </span>
                    <button
                      onClick={() => deleteNoteMut.mutate({ noteId: n.id })}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="reminders" className="flex-1 flex flex-col m-0 overflow-hidden">
        <div className="p-3 border-b">
          <Dialog open={reminderOpen} onOpenChange={setReminderOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="w-full text-xs">
                <Plus className="h-3.5 w-3.5 mr-1" />
                Nuevo recordatorio
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nuevo recordatorio</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <Textarea
                  value={reminderNote}
                  onChange={(e) => setReminderNote(e.target.value)}
                  placeholder="Nota del recordatorio..."
                  rows={2}
                  className="text-xs"
                />
                <input
                  type="datetime-local"
                  value={reminderAt}
                  onChange={(e) => setReminderAt(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm transition-colors"
                />
                <Button
                  className="w-full"
                  disabled={!reminderNote.trim() || !reminderAt || createReminderMut.isPending}
                  onClick={() =>
                    createReminderMut.mutate({ note: reminderNote.trim(), reminderAt: reminderAt })
                  }
                >
                  Guardar recordatorio
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        <ScrollArea className="flex-1 p-3">
          <div className="space-y-2">
            {reminders.length === 0 && (
              <p className="text-xs text-muted-foreground text-center">Sin recordatorios</p>
            )}
            {reminders.map(
              (r: {
                id: string;
                note: string;
                reminder_at: string;
                is_completed: boolean;
                created_at: string;
              }) => (
                <Card key={r.id} className={`p-2 ${r.is_completed ? "opacity-60" : ""}`}>
                  <CardContent className="p-0 space-y-1">
                    <div className="flex items-start gap-2">
                      <Checkbox
                        checked={r.is_completed}
                        onCheckedChange={() => {
                          if (!r.is_completed) completeReminderMut.mutate({ reminderId: r.id });
                        }}
                        className="mt-0.5"
                      />
                      <div className="flex-1">
                        <p className="text-xs">{r.note}</p>
                        <div className="flex items-center gap-1 mt-1">
                          <Clock className="h-3 w-3 text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(r.reminder_at).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            )}
          </div>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
}

function getContrastColor(hexColor: string) {
  const hex = hexColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? "#000000" : "#ffffff";
}
