import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboardStats } from "@/lib/crm.functions";
import { Users, MessagesSquare, Send, Smartphone } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const fn = useServerFn(getDashboardStats);
  const { data } = useQuery({ queryKey: ["dashboard-stats"], queryFn: () => fn({}) });

  const stats = [
    { label: "Contactos", value: data?.contacts ?? 0, icon: Users },
    { label: "Conversaciones", value: data?.threads ?? 0, icon: MessagesSquare },
    { label: "Mensajes", value: data?.messages ?? 0, icon: Send },
    { label: "Sesiones WA", value: data?.sessions ?? 0, icon: Smartphone },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground">Resumen del workspace</p>
      </div>
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm text-muted-foreground">{s.label}</CardTitle>
              <s.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
