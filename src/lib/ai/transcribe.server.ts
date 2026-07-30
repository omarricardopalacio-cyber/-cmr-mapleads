// Transcripción de audios entrantes (Whisper) para que la IA entienda notas de voz.
// Preferencia: Groq (rápido/barato). Fallback: OpenAI Whisper si hay openai_api_key.
// El texto se guarda como `text` del mensaje (mismo camino que un mensaje escrito).

const GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const OPENAI_TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";

const GROQ_TRANSCRIBE_MODEL = process.env.GROQ_TRANSCRIBE_MODEL || "whisper-large-v3-turbo";
const OPENAI_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";

const GROQ_TRANSCRIBE_LANGUAGE =
  process.env.GROQ_TRANSCRIBE_LANGUAGE === undefined ? "es" : process.env.GROQ_TRANSCRIBE_LANGUAGE;

const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

function extFromMime(mime: string): string {
  const m = mime.split(";")[0].trim().toLowerCase();
  if (m === "audio/ogg" || m === "audio/opus") return "ogg";
  if (m === "audio/mpeg" || m === "audio/mp3") return "mp3";
  if (m === "audio/mp4" || m === "audio/x-m4a" || m === "audio/aac") return "m4a";
  if (m === "audio/wav" || m === "audio/x-wav") return "wav";
  if (m === "audio/webm") return "webm";
  if (m === "audio/flac") return "flac";
  return "ogg";
}

function resolveAudioMime(headerType: string | null, hint?: string): string {
  const fromHeader = (headerType || "").split(";")[0].trim().toLowerCase();
  const fromHint = (hint || "").split(";")[0].trim().toLowerCase();
  if (fromHint.startsWith("audio/")) return fromHint;
  if (fromHeader.startsWith("audio/")) return fromHeader;
  // Storage a veces sirve application/octet-stream; WhatsApp PTT = ogg/opus.
  return fromHint || "audio/ogg";
}

async function downloadAudioBlob(
  audioUrl: string,
  mimeHint?: string,
): Promise<{ blob: Blob; mime: string; ext: string }> {
  const dl = await fetch(audioUrl);
  if (!dl.ok) throw new Error(`No se pudo descargar el audio (${dl.status})`);
  const mime = resolveAudioMime(dl.headers.get("content-type"), mimeHint);
  const buf = await dl.arrayBuffer();
  if (!buf.byteLength) throw new Error("Audio vacío");
  if (buf.byteLength > MAX_AUDIO_BYTES) {
    throw new Error(`Audio demasiado grande para transcribir (${buf.byteLength} bytes)`);
  }
  return {
    blob: new Blob([buf], { type: mime }),
    mime,
    ext: extFromMime(mime),
  };
}

async function callWhisperApi(
  url: string,
  apiKey: string,
  form: FormData,
): Promise<string | null> {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Whisper ${res.status}: ${t.slice(0, 200)}`);
  }
  const j: any = await res.json();
  const text = typeof j?.text === "string" ? j.text.trim() : "";
  return text || null;
}

export type TranscribeOpts = {
  language?: string;
  fileName?: string;
  /** MIME real del audio (p. ej. audio/ogg). Evita fallos si Storage sirve octet-stream. */
  mimeType?: string;
};

/**
 * Descarga un audio desde una URL y lo transcribe con Groq (Whisper).
 */
export async function transcribeAudioFromUrl(
  audioUrl: string,
  apiKey: string,
  opts?: TranscribeOpts,
): Promise<string | null> {
  if (!audioUrl || !apiKey) return null;

  const { blob, ext } = await downloadAudioBlob(audioUrl, opts?.mimeType);
  const form = new FormData();
  form.append("file", blob, opts?.fileName || `audio.${ext}`);
  form.append("model", GROQ_TRANSCRIBE_MODEL);
  form.append("response_format", "json");
  const language = opts?.language ?? GROQ_TRANSCRIBE_LANGUAGE;
  if (language) form.append("language", language);

  return callWhisperApi(GROQ_TRANSCRIBE_URL, apiKey, form);
}

/**
 * Fallback OpenAI Whisper (misma forma de multipart).
 */
export async function transcribeAudioWithOpenAI(
  audioUrl: string,
  apiKey: string,
  opts?: TranscribeOpts,
): Promise<string | null> {
  if (!audioUrl || !apiKey) return null;

  const { blob, ext } = await downloadAudioBlob(audioUrl, opts?.mimeType);
  const form = new FormData();
  form.append("file", blob, opts?.fileName || `audio.${ext}`);
  form.append("model", OPENAI_TRANSCRIBE_MODEL);
  form.append("response_format", "json");
  const language = opts?.language ?? GROQ_TRANSCRIBE_LANGUAGE;
  if (language) form.append("language", language);

  return callWhisperApi(OPENAI_TRANSCRIBE_URL, apiKey, form);
}

/**
 * Intenta Groq y, si no hay clave o falla, OpenAI.
 */
export async function transcribeInboundAudio(
  audioUrl: string,
  keys: { groq?: string | null; openai?: string | null },
  opts?: TranscribeOpts,
): Promise<{ text: string | null; provider: "groq" | "openai" | null }> {
  if (!audioUrl) return { text: null, provider: null };

  if (keys.groq) {
    try {
      const text = await transcribeAudioFromUrl(audioUrl, keys.groq, opts);
      if (text?.trim()) return { text: text.trim(), provider: "groq" };
    } catch (err) {
      console.warn(
        "[transcribe] Groq falló, probando OpenAI:",
        (err as Error)?.message,
      );
    }
  }

  if (keys.openai) {
    const text = await transcribeAudioWithOpenAI(audioUrl, keys.openai, opts);
    if (text?.trim()) return { text: text.trim(), provider: "openai" };
    return { text: null, provider: "openai" };
  }

  return { text: null, provider: null };
}
