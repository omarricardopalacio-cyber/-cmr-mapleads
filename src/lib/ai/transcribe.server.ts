// Transcripción de audios entrantes usando Groq (Whisper), para que la IA
// pueda "entender" notas de voz. Reutiliza la misma API de Groq que ya usa el
// CRM (endpoint compatible con OpenAI). El texto transcrito se guarda como el
// `text` del mensaje, así que NO infla el prompt ni el almacenamiento: entra
// igual que si el cliente hubiera escrito ese mensaje.

const GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

// whisper-large-v3-turbo: rápido y barato, buena precisión en español.
const GROQ_TRANSCRIBE_MODEL = process.env.GROQ_TRANSCRIBE_MODEL || "whisper-large-v3-turbo";

// Idioma por defecto (español). Se puede sobreescribir con env. Dejar vacío = autodetección.
const GROQ_TRANSCRIBE_LANGUAGE =
  process.env.GROQ_TRANSCRIBE_LANGUAGE === undefined ? "es" : process.env.GROQ_TRANSCRIBE_LANGUAGE;

// Límite de Whisper en Groq (~25 MB). Los audios del CRM ya están topados a 20 MB.
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

/**
 * Descarga un audio desde una URL y lo transcribe con Groq (Whisper).
 * Devuelve el texto transcrito, o null si no hay nada útil.
 * Lanza en errores de red/API para que el llamador los registre (best-effort).
 */
export async function transcribeAudioFromUrl(
  audioUrl: string,
  apiKey: string,
  opts?: { language?: string; fileName?: string },
): Promise<string | null> {
  if (!audioUrl || !apiKey) return null;

  const dl = await fetch(audioUrl);
  if (!dl.ok) throw new Error(`No se pudo descargar el audio (${dl.status})`);
  const contentType = dl.headers.get("content-type") || "audio/ogg";
  const buf = await dl.arrayBuffer();
  if (!buf.byteLength) return null;
  if (buf.byteLength > MAX_AUDIO_BYTES) {
    throw new Error(`Audio demasiado grande para transcribir (${buf.byteLength} bytes)`);
  }

  const ext = extFromMime(contentType);
  const form = new FormData();
  form.append("file", new Blob([buf], { type: contentType }), opts?.fileName || `audio.${ext}`);
  form.append("model", GROQ_TRANSCRIBE_MODEL);
  form.append("response_format", "json");
  const language = opts?.language ?? GROQ_TRANSCRIBE_LANGUAGE;
  if (language) form.append("language", language);

  const res = await fetch(GROQ_TRANSCRIBE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Groq transcribe ${res.status}: ${t.slice(0, 200)}`);
  }

  const j: any = await res.json();
  const text = typeof j?.text === "string" ? j.text.trim() : "";
  return text || null;
}
