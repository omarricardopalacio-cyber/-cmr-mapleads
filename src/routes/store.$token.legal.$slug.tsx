import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { fetchStorePage } from "@/lib/store-client";
import { ArrowLeft } from "lucide-react";

const SLUGS = ["faq", "terms", "privacy", "shipping"] as const;
type Slug = (typeof SLUGS)[number];

export const Route = createFileRoute("/store/$token/legal/$slug")({
  component: StoreLegalPage,
});

function StoreLegalPage() {
  const { token, slug } = useParams({ from: "/store/$token/legal/$slug" });
  const [title, setTitle] = useState("");
  const [content, setContent] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!SLUGS.includes(slug as Slug)) {
      setErr("Página no encontrada");
      return;
    }
    let cancelled = false;
    fetchStorePage(token, slug as Slug)
      .then((p) => {
        if (cancelled) return;
        setTitle(p.title);
        setContent(p.content);
        if (!p.content?.trim()) setErr("Esta página aún no tiene contenido.");
      })
      .catch((e) => {
        if (!cancelled) setErr(e.message || "Error");
      });
    return () => {
      cancelled = true;
    };
  }, [token, slug]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link
        to="/store/$token"
        params={{ token }}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-white/70 hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver al catálogo
      </Link>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight text-white">{title || "…"}</h1>
      {err ? (
        <p className="text-sm text-white/60">{err}</p>
      ) : (
        <article className="whitespace-pre-wrap text-sm leading-relaxed text-white/85">
          {content}
        </article>
      )}
    </div>
  );
}
