import { useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import {
  listLocalMedia,
  localMediaStats,
  putLocalMediaItem,
  type LocalMediaItem,
} from "../../storage/db";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function safePathPart(s: string): string {
  return String(s || "unknown").replace(/[^\w.@-]+/g, "_").slice(0, 80);
}

export default function MediaBackupPanel() {
  const [stats, setStats] = useState({ count: 0, totalBytes: 0 });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    try {
      setStats(await localMediaStats());
    } catch (e) {
      setError(String((e as Error)?.message || e));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const exportZip = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const items = await listLocalMedia();
      if (!items.length) {
        setMessage("No hay multimedia local para exportar.");
        return;
      }

      const zip = new JSZip();
      const indexLines: string[] = [];
      const manifest = {
        version: 1,
        exportedAt: new Date().toISOString(),
        count: items.length,
        source: "maple-wa-engine-local-media",
      };
      zip.file("manifest.json", JSON.stringify(manifest, null, 2));

      for (const item of items) {
        const chat = safePathPart(item.chatId);
        const id = safePathPart(item.waMessageId || item.id);
        const filename = item.filename || `${id}.bin`;
        const rel = `media/${chat}/${filename}`;
        zip.file(rel, item.blob);
        indexLines.push(
          JSON.stringify({
            id: item.id,
            waMessageId: item.waMessageId,
            chatId: item.chatId,
            mimeType: item.mimeType,
            filename,
            type: item.type,
            size: item.size,
            createdAt: item.createdAt,
            direction: item.direction,
            text: item.text,
            path: rel,
          })
        );
      }
      zip.file("index.jsonl", indexLines.join("\n"));

      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      a.href = url;
      a.download = `maple-media-${stamp}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage(`Exportados ${items.length} archivos (${formatBytes(blob.size)}).`);
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const importZip = async (file: File) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const zip = await JSZip.loadAsync(file);
      const indexFile = zip.file("index.jsonl");
      if (!indexFile) throw new Error("ZIP inválido: falta index.jsonl");

      const indexText = await indexFile.async("string");
      const lines = indexText.split("\n").map((l) => l.trim()).filter(Boolean);
      let imported = 0;

      for (const line of lines) {
        let meta: {
          id?: string;
          waMessageId?: string;
          chatId?: string;
          mimeType?: string;
          filename?: string;
          type?: string;
          size?: number;
          createdAt?: number;
          direction?: string;
          text?: string;
          path?: string;
        };
        try {
          meta = JSON.parse(line);
        } catch {
          continue;
        }
        const path = meta.path;
        if (!path) continue;
        const entry = zip.file(path);
        if (!entry) continue;
        const blob = await entry.async("blob");
        const mimeType = meta.mimeType || blob.type || "application/octet-stream";
        const item: LocalMediaItem = {
          id: meta.id || meta.waMessageId || path,
          waMessageId: meta.waMessageId || meta.id || path,
          chatId: meta.chatId || "unknown",
          mimeType,
          filename: meta.filename || path.split("/").pop() || "file.bin",
          type: meta.type || "document",
          blob: blob.type ? blob : new Blob([blob], { type: mimeType }),
          size: meta.size || blob.size,
          createdAt: meta.createdAt || Date.now(),
          direction: meta.direction,
          text: meta.text,
        };
        await putLocalMediaItem(item);
        imported++;
      }

      setMessage(`Importados ${imported} archivos a este PC.`);
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
      void refresh();
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-3 text-sm">
      <div>
        <h2 className="font-semibold text-emerald-400">Multimedia local (PC)</h2>
        <p className="text-xs text-slate-400 mt-1">
          Fotos, videos y documentos se guardan en este equipo para no llenar la nube.
          Usa ZIP para pasarlos a otro PC.
        </p>
      </div>

      <div className="rounded border border-slate-700 bg-slate-800/60 p-3 text-xs space-y-1">
        <div className="flex justify-between">
          <span className="text-slate-400">Archivos</span>
          <span className="text-slate-200">{stats.count}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Espacio en este PC</span>
          <span className="text-slate-200">{formatBytes(stats.totalBytes)}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void exportZip()}
          className="px-3 py-1.5 rounded bg-emerald-600 text-white text-xs font-medium disabled:opacity-50"
        >
          {busy ? "Espera…" : "Exportar ZIP"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="px-3 py-1.5 rounded bg-slate-700 text-slate-100 text-xs font-medium disabled:opacity-50"
        >
          Importar ZIP
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void refresh()}
          className="px-3 py-1.5 rounded bg-slate-800 text-slate-300 text-xs border border-slate-600"
        >
          Actualizar
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(ev) => {
          const f = ev.target.files?.[0];
          if (f) void importZip(f);
        }}
      />

      {message && <p className="text-xs text-emerald-400">{message}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
