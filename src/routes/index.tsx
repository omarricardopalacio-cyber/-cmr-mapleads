import { createFileRoute, Link } from "@tanstack/react-router";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CRM WhatsApp Engine — Panel" },
      { name: "description", content: "CRM desacoplado con WhatsApp Engine como bridge. Descarga la extensión e inicia la conexión." },
      { property: "og:title", content: "CRM WhatsApp Engine" },
      { property: "og:description", content: "CRM desacoplado con WhatsApp Engine como bridge." },
    ],
  }),
  component: Index,
});

function downloadExtension() {
  fetch("/whatsapp-engine.zip")
    .then((res) => {
      if (!res.ok) throw new Error(`Descarga falló: ${res.status}`);
      return res.blob();
    })
    .then((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "whatsapp-engine.zip";
      a.click();
      URL.revokeObjectURL(a.href);
    })
    .catch((err) => alert(err.message));
}

function Index() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-sm font-semibold tracking-wider uppercase text-slate-300">CRM Engine</span>
          </div>
          <span className="text-xs text-slate-500">Fase 1 · WhatsApp Engine</span>
        </div>
          <div className="flex items-center gap-3">
            <Link to="/login" className="text-sm text-slate-300 hover:text-white">Entrar</Link>
            <Link to="/signup" className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-emerald-950 hover:bg-emerald-400">Crear cuenta</Link>
          </div>


      <main className="mx-auto max-w-5xl px-6 py-16">
        <h1 className="text-4xl font-bold tracking-tight">WhatsApp Engine listo para instalar</h1>
        <p className="mt-4 max-w-2xl text-slate-400">
          Extensión Chrome MV3 desacoplada del CRM. Observa, parsea y envía mensajes en WhatsApp
          Web. Se conecta al backend por WebSocket y emite eventos estandarizados
          (<code className="text-emerald-400">MESSAGE_RECEIVED</code>, <code className="text-emerald-400">COMMAND_ACK</code>).
        </p>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
            <h2 className="text-lg font-semibold">1. Descargar</h2>
            <p className="mt-2 text-sm text-slate-400">ZIP con manifest v3, observer, parser, sender, bridge y popup.</p>
            <button
              onClick={downloadExtension}
              className="mt-4 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400"
            >
              Descargar whatsapp-engine.zip
            </button>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
            <h2 className="text-lg font-semibold">2. Instalar en Chrome</h2>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-400">
              <li>Descomprime el ZIP.</li>
              <li>Abre <code>chrome://extensions</code>.</li>
              <li>Activa <b>Modo desarrollador</b>.</li>
              <li>Clic en <b>Cargar descomprimida</b> y selecciona la carpeta.</li>
            </ol>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 md:col-span-2">
            <h2 className="text-lg font-semibold">3. Conectar al backend</h2>
            <p className="mt-2 text-sm text-slate-400">
              Abre el popup de la extensión, pega la <b>URL del backend</b> y un <b>token de sesión</b>.
              La extensión abre un WebSocket persistente con reconexión exponencial y heartbeat 15 s.
            </p>
            <p className="mt-3 text-xs text-slate-500">
              Próximo paso (Fase 2): activar Lovable Cloud, crear tablas <code>organizations</code>,
              <code> sessions</code>, <code>threads</code>, <code>messages</code> y los server functions del WS Gateway.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
