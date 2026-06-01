// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState, memo } from "react";
import { clearThreadMessages, listMessages, sendMessage, toggleAiEnabled, uploadMedia, assignThreadToAgent, syncThreadMessages, getMyOrgId } from "@/lib/messaging.functions";
import { listOrgMembers, getContactCrmData, updateContactCrmData } from "@/lib/crm.functions";
import { listQuickReplies, createScheduled } from "@/lib/automations.functions";
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
import { listAiActions } from "@/lib/ai.functions";
import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
  Bot,
  Mic,
  Download,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { getContactDisplayName, formatPhoneOrWaId } from "@/lib/utils";
import { sanitizeMessageText, isBase64Thumbnail } from "@/lib/message-text";

export const Route = createFileRoute("/_authenticated/conversations/$threadId")({
  component: ThreadPage,
});

// Componente memoizado: si la URL no cambia, React no toca el elemento <video> del DOM
const StableVideo = memo(function StableVideo({ src }: { src: string }) {
  return (
    <video
      src={src}
      controls
      className="max-w-[280px] rounded-lg border border-slate-800"
      preload="metadata"
    />
  );
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
  const createSched = useServerFn(createScheduled);
  const upload = useServerFn(uploadMedia);
  const listMembers = useServerFn(listOrgMembers);
  const assignAgent = useServerFn(assignThreadToAgent);
  const getOrgId = useServerFn(getMyOrgId);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [showSched, setShowSched] = useState(false);
  const [schedDate, setSchedDate] = useState("");
  const [schedMsg, setSchedMsg] = useState("");
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{ file: File; preview: string } | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // NIVEL 1: Consulta redundante directa desde el navegador
  const [clientMessages, setClientMessages] = useState<any[]>([]);
  const [clientLoading, setClientLoading] = useState(false);
  const [clientError, setClientError] = useState<Error | null>(null);
  const [userOrgId, setUserOrgId] = useState<string | null>(null);

  const { data: qrData } = useQuery({ queryKey: ["quickReplies"], queryFn: () => listQr({}) });

  const { data, isLoading, error } = useQuery({
    queryKey: ["thread", threadId],
    queryFn: () => list({ data: { threadId } }),
    refetchInterval: 3000,  // Reducido de 5s a 3s para detectar cambios más rápido
    refetchOnMount: true,   // Refetch cuando monta el componente
    refetchOnWindowFocus: true,  // Refetch cuando vuelve a la ventana
    retry: false,
  });

  // NIVEL 1: Consulta directa al navegador como salvavidas
  useEffect(() => {
    let cancelled = false;
    setClientLoading(true);
    setClientError(null);
    setClientMessages([]);

    async function fetchDirect() {
      try {
        // Obtener org_id del usuario autenticado usando server function
        const currentOrgId = await getOrgId({});
        
        if (currentOrgId && !cancelled) setUserOrgId(currentOrgId);

        const { data: directMsgs, error: directErr } = await supabase
          .from("messages")
          .select("id, direction, text, sent_at, media")
          .eq("thread_id", threadId)
          .order("sent_at", { ascending: true });

        if (!cancelled) {
          if (directErr) {
            setClientError(directErr as unknown as Error);
            console.error("[CLIENT DIRECT SQL] Error:", directErr);
          } else if (directMsgs) {
            setClientMessages(directMsgs);
            console.log("[CLIENT DIRECT SQL] Mensajes cargados desde navegador:", directMsgs.length);
          }
        }
      } catch (e) {
        if (!cancelled) {
          setClientError(e as Error);
          console.error("[CLIENT DIRECT SQL] Excepción:", e);
        }
      } finally {
        if (!cancelled) setClientLoading(false);
      }
    }

    fetchDirect();
    return () => { cancelled = true; };
  }, [threadId]);

  // eslint-disable-next-line no-console
  console.log("[DEBUG] Thread ID:", threadId, "Loading:", isLoading, "Error:", error, "Server messages:", (data?.messages ?? []).length, "Client messages:", clientMessages.length);

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

  const syncMut = useMutation({
    mutationFn: () => syncThreadMessages({ data: { threadId } }),
    onSuccess: (res) => {
      toast.success(`Reparación completada. ${(res as unknown as Record<string, unknown>)?.synced ?? 0} mensajes sincronizados.`);
      qc.invalidateQueries({ queryKey: ["thread", threadId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    if (!isLoading && data === null) navigate({ to: "/conversations" });
  }, [data, isLoading, navigate]);

  const mergedMessages = (data?.messages ?? []).length > 0 ? (data?.messages ?? []) : clientMessages;

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
  }, [mergedMessages.length]);

  useEffect(() => {
    const ch = supabase
      .channel(`thread-${threadId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `thread_id=eq.${threadId}` },
        () => {
          console.log('[REALTIME] INSERT detectado, invalidando query');
          qc.invalidateQueries({ queryKey: ["thread", threadId] });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `thread_id=eq.${threadId}` },
        (payload) => {
          console.log('[REALTIME] UPDATE detectado (media procesada)', {
            waMessageId: (payload.new as any)?.wa_message_id,
            hasMedia: !!(payload.new as any)?.media,
          });
          qc.invalidateQueries({ queryKey: ["thread", threadId] });
        }
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

      let mediaBase64: string | null = null;
      let mediaStoragePath: string | null = null;

      if (selectedFile) {
        setUploading(true);
        mimeType = selectedFile.file.type;
        
        const currentOrgId = await getOrgId({});
        
        if (!currentOrgId) {
          throw new Error("No se pudo determinar la organización del usuario");
        }
        
        const path = `${currentOrgId}/${Date.now()}_${selectedFile.file.name}`;
        const { error: upErr } = await supabase.storage
          .from("media")
          .upload(path, selectedFile.file, { contentType: selectedFile.file.type, upsert: false });
          
        if (upErr) throw upErr;
        
        const { data: urlData } = supabase.storage.from("media").getPublicUrl(path);
        mediaUrl = urlData.publicUrl;
        mediaStoragePath = path;
        
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

      await send({
        data: {
          threadId,
          text: payloadText || (mediaUrl ? " " : ""),
          media_url: mediaUrl,
          media_base64: mediaBase64,
          media_storage_path: mediaStoragePath,
          mime_type: mimeType,
          caption: payloadText || undefined,
        },
      });
      setText("");
      setShowQr(false);
      qc.invalidateQueries({ queryKey: ["thread", threadId] });
      // Refetch inmediato para mostrar el mensaje encolado sin esperar 3 segundos
      await qc.refetchQueries({ queryKey: ["thread", threadId] });
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
    <div className="flex h-full min-h-0">
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
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
          {(isLoading || clientLoading) && (
            <p className="text-muted-foreground text-sm">Cargando mensajes...</p>
          )}

          {/* NIVEL 2: Panel de Diagnóstico cuando no hay mensajes */}
          {!isLoading && !clientLoading && mergedMessages.length === 0 && (
            <div className="bg-slate-950 border-2 border-red-500 p-6 rounded-xl max-w-2xl mx-auto my-8 space-y-4 text-white shadow-lg">
              <div className="flex items-center gap-2 text-red-400 font-bold text-lg">
                <span className="text-2xl">🔴</span>
                <span>Panel de Diagnóstico Técnico</span>
              </div>
              <div className="space-y-2 text-sm font-mono">
                <div className="flex justify-between border-b border-slate-700 pb-1">
                  <span className="text-slate-400">Estado del chat:</span>
                  <span className="text-red-400 font-semibold">Sin mensajes visibles</span>
                </div>
                <div className="flex justify-between border-b border-slate-700 pb-1">
                  <span className="text-slate-400">🏢 Org ID:</span>
                  <span className="text-emerald-400">{userOrgId ?? "Desconocido"}</span>
                </div>
                <div className="flex justify-between border-b border-slate-700 pb-1">
                  <span className="text-slate-400">💬 Thread ID:</span>
                  <span className="text-yellow-400">{threadId}</span>
                </div>
                <div className="flex justify-between border-b border-slate-700 pb-1">
                  <span className="text-slate-400">📂 Servidor (Loader):</span>
                  <span className={data?.messages && (data?.messages ?? []).length > 0 ? "text-emerald-400" : "text-red-400"}>
                    {(data?.messages ?? []).length} mensajes
                  </span>
                </div>
                <div className="flex justify-between border-b border-slate-700 pb-1">
                  <span className="text-slate-400">🌐 Navegador (Directo):</span>
                  <span className={clientMessages.length > 0 ? "text-emerald-400" : "text-red-400"}>
                    {clientMessages.length} mensajes
                  </span>
                </div>
                {error && (
                  <div className="flex justify-between border-b border-slate-700 pb-1">
                    <span className="text-slate-400">❌ Error Servidor:</span>
                    <span className="text-red-400">{(error as Error).message}</span>
                  </div>
                )}
                {clientError && (
                  <div className="flex justify-between border-b border-slate-700 pb-1">
                    <span className="text-slate-400">❌ Error Navegador:</span>
                    <span className="text-red-400">{clientError.message}</span>
                  </div>
                )}
              </div>
              <Button
                variant="destructive"
                className="w-full mt-2"
                onClick={() => syncMut.mutate()}
                disabled={syncMut.isPending}
              >
                {syncMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                🛠️ Auto-Reparar Mensajes Huérfanos
              </Button>
              <p className="text-[10px] text-slate-500 text-center">
                Este botón asocia todos los mensajes de este chat a la organización actual.
              </p>
            </div>
          )}

          {mergedMessages.map((m) => {
            const displayText = sanitizeMessageText(m.text);
            const mediaObj = (m.media as { url?: string; mimeType?: string; mime_type?: string; mimetype?: string; filename?: string; caption?: string; error?: string; missing_media?: boolean }) ?? null;
            
            // Log para diagnosticar mensajes entrantes con media
            if (m.media && m.direction === 'in') {
              console.log('[MEDIA-DEBUG] Mensaje entrante con media:', {
                id: m.id,
                media: m.media,
                url: (m.media as any)?.url,
                mimeType: (m.media as any)?.mimeType,
                mime_type: (m.media as any)?.mime_type,
                mimetype: (m.media as any)?.mimetype,
                missing_media: (m.media as any)?.missing_media,
                error: (m.media as any)?.error,
                keys: Object.keys(m.media as object),
              });
            }
            
            // Normalizar mime: soportar mimeType, mime_type y mimetype
            const mime = (mediaObj?.mimeType || mediaObj?.mime_type || mediaObj?.mimetype || "")?.toLowerCase();
            const msgType = (m.media as any)?.type as string | undefined;

            // Si hay URL pero mime vacío o genérico (application/octet-stream), inferir por extensión de URL o tipo de mensaje
            const urlStr = mediaObj?.url ?? '';
            const needsInference = !mime || mime === "application/octet-stream";
            const inferredMime = needsInference && urlStr
              ? urlStr.match(/\.jpe?g$/i) ? 'image/jpeg'
              : urlStr.match(/\.png$/i) ? 'image/png'
              : urlStr.match(/\.gif$/i) ? 'image/gif'
              : urlStr.match(/\.webp$/i) ? 'image/webp'
              : urlStr.match(/\.mp4$/i) ? 'video/mp4'
              : urlStr.match(/\.webm$/i) ? 'video/webm'
              : urlStr.match(/\.(ogg|opus|mp3|m4a|aac|amr)$/i) ? 'audio/ogg'
              : urlStr.match(/\.pdf$/i) ? 'application/pdf'
              : urlStr.match(/\.bin$/i) && msgType === 'image' ? 'image/jpeg'
              : urlStr.match(/\.bin$/i) && msgType === 'video' ? 'video/mp4'
              : urlStr.match(/\.bin$/i) && (msgType === 'ptt' || msgType === 'audio') ? 'audio/ogg'
              : ''
              : mime;
            const effectiveMime = inferredMime || mime;
            
            const isImage = effectiveMime.startsWith("image/") || !!(mediaObj?.url?.match(/\.(jpg|jpeg|png|gif|webp)$/i)) || msgType === "image";
            const isVideo = effectiveMime.startsWith("video/") || !!(mediaObj?.url?.match(/\.(mp4|webm|mov|mkv)$/i)) || msgType === "video";
            const isAudio = effectiveMime.startsWith("audio/") || !!(mediaObj?.url?.match(/\.(ogg|opus|mp3|m4a|aac|wav|amr)$/i)) || msgType === "ptt" || msgType === "audio";
            const isDoc = !isImage && !isVideo && !isAudio && !!mediaObj?.url;
            
            // Estados de visualización del archivo multimedia
            const hasError = !!(m.media && mediaObj?.error);
            const hasMissingMedia = !!(m.media && mediaObj?.missing_media);
            const hasMediaButNoUrl = !!(m.media && !mediaObj?.url && !hasError && !hasMissingMedia);
            
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
                      alt={mediaObj.caption || "Imagen"}
                      className="max-w-[250px] rounded-lg cursor-pointer hover:opacity-90 transition-opacity border border-slate-800"
                      onClick={() => setLightboxUrl(mediaObj.url!)}
                      loading="lazy"
                    />
                  ) : isVideo && mediaObj?.url ? (
                    <StableVideo src={mediaObj.url} />
                  ) : isAudio && mediaObj?.url ? (
                    <div className="flex items-center gap-2 bg-black/20 rounded-lg p-2">
                      <Mic className="h-5 w-5 text-emerald-500 shrink-0" />
                      <audio src={mediaObj.url} controls className="w-[200px] h-8" />
                    </div>
                  ) : isDoc && mediaObj?.url ? (
                    <div className="flex items-center gap-3 bg-muted rounded-lg p-3 border border-slate-800">
                      <FileText className="h-8 w-8 text-blue-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">{mediaObj.filename || "Documento.pdf"}</div>
                        <a
                          href={mediaObj.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-muted-foreground hover:underline flex items-center gap-1 mt-0.5"
                        >
                          <Download className="h-3 w-3" /> Descargar
                        </a>
                      </div>
                    </div>
                  ) : hasMissingMedia ? (
                    <div className="flex flex-col gap-1.5 bg-slate-500/10 border border-slate-500/30 rounded-lg p-2.5 mt-1.5 max-w-sm">
                      <span className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                        <Image className="h-4 w-4 opacity-70" />
                        Multimedia no disponible
                      </span>
                      <span className="text-[10px] text-slate-400/90 leading-normal">
                        {mediaObj?.extraction_error === 'timeout_after_retries' 
                          ? 'El archivo no se pudo descargar a tiempo. Puede estar disponible en WhatsApp Web.'
                          : mediaObj?.extraction_error === 'exception_during_download'
                          ? 'Error al intentar descargar el archivo.'
                          : 'Multimedia enviada desde otro dispositivo o no disponible.'}
                      </span>
                    </div>
                  ) : hasMediaButNoUrl ? (
                    <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 mt-1.5 max-w-sm">
                      <span className="text-xs font-medium text-amber-700 animate-pulse flex items-center gap-1.5">
                        ⏳ Sincronizando multimedia...
                      </span>
                    </div>
                  ) : hasError ? (
                    <div className="flex flex-col gap-1.5 bg-rose-500/10 border border-rose-500/35 rounded-lg p-2.5 mt-1.5 max-w-sm">
                      <span className="text-xs font-semibold text-rose-700 flex items-center gap-1">
                        ❌ Error al cargar multimedia
                      </span>
                      <span className="text-[10px] text-rose-600/90 leading-normal">
                        {mediaObj?.error || "El archivo es demasiado pesado o está corrupto. Inténtalo de nuevo."}
                      </span>
                    </div>
                  ) : null}
                  {displayText ? <div className={mediaObj?.url ? "mt-2" : ""}>{displayText}</div> : null}
                  {!displayText && !mediaObj?.url && !isBase64Thumbnail(m.text) && !hasMediaButNoUrl && !hasError && !hasMissingMedia && (
                    <i className="opacity-60 text-xs">[mensaje vacío]</i>
                  )}
                </div>
                <div className="text-[10px] opacity-70 mt-1 text-right">
                  {m.sent_at ? new Date(m.sent_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                </div>
              </div>
            );
          })}
        </div>

        <form
          onSubmit={handleSend}
          className="border-t p-3 bg-card relative shrink-0 z-10 grid grid-cols-[auto_auto_auto_1fr_auto] items-end gap-2"
        >
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept="image/*,video/*,audio/*,application/pdf"
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
          <Popover open={showSched} onOpenChange={setShowSched}>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" onClick={() => setShowSched(true)}>
                    <Calendar className="h-4 w-4 text-blue-500" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Programar un mensaje</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <PopoverContent className="w-80 p-3" align="start">
              <div className="text-xs font-medium text-muted-foreground mb-2">Mensaje Programado</div>
              <div className="space-y-3">
                <Textarea
                  placeholder="Escribe el mensaje..."
                  className="text-xs resize-none"
                  rows={3}
                  value={schedMsg}
                  onChange={(e) => setSchedMsg(e.target.value)}
                />
                <Input
                  type="datetime-local"
                  className="text-xs h-8"
                  value={schedDate}
                  onChange={(e) => setSchedDate(e.target.value)}
                />
                <Button
                  size="sm"
                  className="w-full text-xs"
                  disabled={!schedMsg.trim() || !schedDate || sending}
                  onClick={async () => {
                    setSending(true);
                    try {
                      const isoDate = new Date(schedDate).toISOString();
                      const waId = (data as any)?.thread?.contact?.wa_id;
                      const sessionId = (data as any)?.thread?.session_id;
                      if (!waId || !sessionId) throw new Error("Faltan datos del cliente o sesión");
                      await createSched({ data: { session_id: sessionId, wa_id: waId, text: schedMsg, send_at: isoDate } });
                      toast.success("Mensaje programado con éxito");
                      setShowSched(false);
                      setSchedMsg("");
                      setSchedDate("");
                    } catch (e: any) {
                      toast.error(e.message || "Error al programar");
                    } finally {
                      setSending(false);
                    }
                  }}
                >
                  Programar
                </Button>
              </div>
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
          <div className="min-w-0 relative col-span-1">
            {selectedFile && (
              <div className="absolute -top-12 left-0 flex items-center gap-2 bg-muted rounded-md px-2 py-1 text-xs max-w-full">
                <Image className="h-3 w-3 shrink-0" />
                <span className="truncate">{selectedFile.file.name}</span>
                <button type="button" onClick={() => setSelectedFile(null)} className="hover:text-destructive shrink-0">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            <Input
              value={text}
              onChange={(e) => { setText(e.target.value); setShowQr(e.target.value.startsWith("/")); }}
              placeholder={selectedFile ? "Añade un mensaje (opcional)..." : "Escribe un mensaje..."}
              disabled={sending || uploading}
              className="w-full"
              autoFocus
            />
          </div>
          <Button type="submit" className="shrink-0" disabled={sending || uploading || (!text.trim() && !selectedFile)}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </div>

      {data?.thread?.contactId && data?.thread?.id && (
        <aside className="w-80 border-l bg-card flex-col shrink-0 flex hidden lg:flex overflow-hidden">
          <ContactContextPanel contactId={data.thread.contactId} threadId={data.thread.id} />
        </aside>
      )}

      <Dialog open={!!lightboxUrl} onOpenChange={() => setLightboxUrl(null)}>
        <DialogContent className="max-w-4xl p-0 bg-black/90 border-none">
          {lightboxUrl && (
            <img
              src={lightboxUrl}
              alt="Vista previa"
              className="w-full h-auto max-h-[85vh] object-contain rounded-lg"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ContactContextPanel({ contactId, threadId }: { contactId: string; threadId: string }) {
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

  const getCrmFn = useServerFn(getContactCrmData);
  const updateCrmFn = useServerFn(updateContactCrmData);
  const { data: crmData } = useQuery({
    queryKey: ["crm", contactId],
    queryFn: () => getCrmFn({ data: { contactId } }),
    enabled: !!contactId,
  });
  const updateCrmMut = useMutation({
    mutationFn: (vars: any) => updateCrmFn({ data: { contactId, ...vars } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm", contactId] });
      toast.success("Datos CRM guardados");
    },
    onError: (e: Error) => toast.error(e.message),
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

  // AI Actions hooks
  const listAiActionsFn = useServerFn(listAiActions);
  const { data: aiActionsData } = useQuery({
    queryKey: ["ai-actions", threadId],
    queryFn: () => listAiActionsFn({ data: { threadId } }),
    enabled: !!threadId,
  });

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
      <TabsList className="mx-3 mt-3 grid grid-cols-4">
        <TabsTrigger value="tags" className="text-xs">
          <Tag className="h-3.5 w-3.5 mr-1 hidden sm:block" />
          Tags
        </TabsTrigger>
        <TabsTrigger value="crm" className="text-xs">
          <FileText className="h-3.5 w-3.5 mr-1 hidden sm:block" />
          CRM
        </TabsTrigger>
        <TabsTrigger value="notes" className="text-xs">
          <StickyNote className="h-3.5 w-3.5 mr-1 hidden sm:block" />
          Notas
        </TabsTrigger>
        <TabsTrigger value="reminders" className="text-xs px-1">
          <Clock className="h-3.5 w-3.5 mr-1 hidden sm:block" />
          Record.
        </TabsTrigger>
        <TabsTrigger value="ai" className="text-xs">
          <Bot className="h-3.5 w-3.5 mr-1 hidden sm:block" />
          IA
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

      <TabsContent value="crm" className="flex-1 flex flex-col m-0 p-3 overflow-y-auto">
        <div className="space-y-3 pb-6">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Origen del lead</Label>
            <Input className="h-8 text-xs" defaultValue={(crmData as any)?.contact?.origin || ""} onBlur={(e) => updateCrmMut.mutate({ origin: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Fecha de entrada</Label>
              <Input type="date" className="h-8 text-xs" defaultValue={(crmData as any)?.contact?.entry_date?.split('T')[0] || ""} onBlur={(e) => updateCrmMut.mutate({ entry_date: e.target.value ? new Date(e.target.value).toISOString() : null })} />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Fecha de salida</Label>
              <Input type="date" className="h-8 text-xs" defaultValue={(crmData as any)?.contact?.exit_date?.split('T')[0] || ""} onBlur={(e) => updateCrmMut.mutate({ exit_date: e.target.value ? new Date(e.target.value).toISOString() : null })} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Valor del negocio (€)</Label>
            <Input type="number" step="0.01" className="h-8 text-xs" defaultValue={(crmData as any)?.contact?.deal_value || ""} onBlur={(e) => updateCrmMut.mutate({ deal_value: parseFloat(e.target.value) || 0 })} />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Empresa</Label>
            <Input className="h-8 text-xs" defaultValue={(crmData as any)?.contact?.company || ""} onBlur={(e) => updateCrmMut.mutate({ company: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Cargo</Label>
            <Input className="h-8 text-xs" defaultValue={(crmData as any)?.contact?.position || ""} onBlur={(e) => updateCrmMut.mutate({ position: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Productos de interés</Label>
            <Textarea className="text-xs resize-none" rows={2} defaultValue={(crmData as any)?.contact?.interested_products || ""} onBlur={(e) => updateCrmMut.mutate({ interested_products: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Observaciones</Label>
            <Textarea className="text-xs resize-none" rows={3} defaultValue={(crmData as any)?.contact?.observations || ""} onBlur={(e) => updateCrmMut.mutate({ observations: e.target.value })} />
          </div>
        </div>
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

      <TabsContent value="ai" className="flex-1 flex flex-col m-0 overflow-hidden">
        <ScrollArea className="flex-1 p-3">
          <div className="space-y-3">
            {(aiActionsData?.logs ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground text-center">Sin acciones del asistente</p>
            )}
            {(aiActionsData?.logs ?? []).map(
              (log: {
                id: string;
                action_name: string;
                action_details: string;
                created_at: string;
              }) => (
                <div key={log.id} className="rounded-md border bg-muted/40 p-2.5 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Bot className="h-3.5 w-3.5 text-primary" />
                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {log.action_name}
                    </span>
                  </div>
                  <p className="text-xs">{log.action_details}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {new Date(log.created_at).toLocaleString()}
                  </p>
                </div>
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
