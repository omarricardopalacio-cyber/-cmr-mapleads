import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listThreads } from "@/lib/crm.functions";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/conversations/")({
  component: ConversationsPage,
});

function ConversationsPage() {
  const fn = useServerFn(listThreads);
  const { data, isLoading } = useQuery({ queryKey: ["threads"], queryFn: () => fn({}) });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Conversaciones</h1>
      <p className="text-muted-foreground text-sm">Hilos recibidos desde el motor WhatsApp.</p>
      <div className="grid gap-2">
        {isLoading && <p className="text-muted-foreground">Cargando...</p>}
        {!isLoading && (data?.threads.length ?? 0) === 0 && (
          <Card className="p-6 text-center text-muted-foreground">
            Sin conversaciones aún. Instala la extensión y vincúlala a una sesión.
          </Card>
        )}
        {data?.threads.map((t) => {
          const contact = Array.isArray(t.contacts) ? t.contacts[0] : t.contacts;
          return (
            <Link
              key={t.id}
              to="/conversations/$threadId"
              params={{ threadId: t.id }}
              className="block"
            >
              <Card className="p-4 flex items-center justify-between hover:bg-muted/40 transition-colors">
                <div>
                  <div className="font-medium">{contact?.display_name || contact?.wa_id || t.contact_id}</div>
                  <div className="text-xs text-muted-foreground font-mono">{contact?.wa_id}</div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {t.last_message_at ? new Date(t.last_message_at).toLocaleString() : "—"}
                  {t.unread_count > 0 && (
                    <span className="ml-2 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-xs px-2 py-0.5">
                      {t.unread_count}
                    </span>
                  )}
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
