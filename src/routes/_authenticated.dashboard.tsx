import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getDashboardMetrics, getAgentDetails } from "@/lib/analytics.functions";
import {
  MessagesSquare,
  Users,
  Bot,
  Target,
  TrendingUp,
  TrendingDown,
  Clock,
  ArrowUpRight,
  Sparkles,
  UserCheck,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

const RANGE_OPTIONS = [
  { label: "Ultimos 7 dias", value: 7 },
  { label: "Ultimos 30 dias", value: 30 },
  { label: "Historico", value: 365 },
];

const COLORS = ["#10B981", "#3B82F6", "#F59E0B", "#EF4444", "#8B5CF6"];

function DashboardPage() {
  const [days, setDays] = useState<number>(7);
  const metricsFn = useServerFn(getDashboardMetrics);
  const agentsFn = useServerFn(getAgentDetails);

  const { data: metrics, isLoading } = useQuery({
    queryKey: ["dashboard-metrics", days],
    queryFn: () => metricsFn({ data: { days } }),
  });

  const { data: agentsData } = useQuery({
    queryKey: ["dashboard-agents"],
    queryFn: () => agentsFn({}),
  });

  const kpis = [
    {
      label: "Conversaciones activas",
      value: metrics?.kpis.totalThreads ?? 0,
      icon: MessagesSquare,
      trend: "Chats totales",
      tone: "neutral" as const,
    },
    {
      label: "Contactos registrados",
      value: metrics?.kpis.totalContacts ?? 0,
      icon: Users,
      trend: "Base de clientes",
      tone: "neutral" as const,
    },
    {
      label: "Acciones del Asistente IA",
      value: metrics?.kpis.aiActions ?? 0,
      icon: Bot,
      trend:
        metrics && metrics.kpis.aiActions > 0
          ? `Ahorro estimado: ~${Math.round(metrics.kpis.aiActions * 0.8)} min`
          : "Sin actividad IA",
      tone: "positive" as const,
    },
    {
      label: "Conversion comercial",
      value:
        metrics && metrics.funnel.length > 0
          ? (() => {
              const total = metrics.funnel.reduce((s, f) => s + f.count, 0);
              const cierre = metrics.funnel.find((f) => f.name.toLowerCase().includes("cierre"))?.count ?? 0;
              const prospecto = metrics.funnel.find((f) => f.name.toLowerCase().includes("prospecto"))?.count ?? 1;
              return total > 0 ? Math.round((cierre / Math.max(prospecto, 1)) * 100) : 0;
            })()
          : 0,
      icon: Target,
      trend: "% Cierre / Prospecto",
      tone: "neutral" as const,
      suffix: "%",
    },
  ];

  const agentMap = new Map((agentsData?.members ?? []).map((m) => [m.id, m.displayName]));
  const agents = (metrics?.agentChats ?? [])
    .map((a) => ({
      id: a.userId,
      name: agentMap.get(a.userId) || "Agente",
      chats: a.count,
    }))
    .sort((a, b) => b.chats - a.chats);

  const aiPieData = metrics
    ? [
        { name: "Automatizado IA", value: Math.max(metrics.kpis.aiActions - metrics.kpis.aiTransferRate, 0) },
        { name: "Traspaso humano", value: metrics.kpis.aiTransferRate },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Centro de Control</h1>
          <p className="text-muted-foreground text-sm">Business Intelligence del workspace</p>
        </div>
        <Select
          value={String(days)}
          onValueChange={(v) => setDays(Number(v))}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Rango de tiempo" />
          </SelectTrigger>
          <SelectContent>
            {RANGE_OPTIONS.map((r) => (
              <SelectItem key={r.value} value={String(r.value)}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} className="relative overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{k.label}</CardTitle>
              <k.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <div className="text-3xl font-bold">
                  {k.value}
                  {k.suffix ?? ""}
                </div>
              )}
              <div className="flex items-center gap-1 mt-1">
                {k.tone === "positive" ? (
                  <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                ) : k.tone === "negative" ? (
                  <TrendingDown className="h-3.5 w-3.5 text-red-500" />
                ) : (
                  <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className="text-xs text-muted-foreground">{k.trend}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <MessagesSquare className="h-4 w-4 text-primary" />
              Actividad de mensajeria
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[260px] w-full" />
            ) : metrics && metrics.dailyMessages.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={metrics.dailyMessages}>
                  <defs>
                    <linearGradient id="gradRecv" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradSent" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="received"
                    name="Recibidos"
                    stroke="#3B82F6"
                    fill="url(#gradRecv)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="sent"
                    name="Enviados"
                    stroke="#10B981"
                    fill="url(#gradSent)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">
                Sin datos de mensajeria en este periodo
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              Embudo de ventas
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[260px] w-full" />
            ) : metrics && metrics.funnel.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={metrics.funnel}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip />
                  <Bar dataKey="count" name="Contactos" radius={[6, 6, 0, 0]}>
                    {metrics.funnel.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color || COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">
                Sin datos de embudo
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Metricas del Asistente Virtual
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                {isLoading ? (
                  <Skeleton className="h-[200px] w-full" />
                ) : metrics && metrics.kpis.aiActions > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={aiPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        dataKey="value"
                        nameKey="name"
                        stroke="none"
                      >
                        {aiPieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend verticalAlign="bottom" height={24} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
                    Sin actividad de IA
                  </div>
                )}
              </div>
              <div className="flex-1 space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Top acciones automaticas
                </p>
                {isLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-6 w-full" />
                    <Skeleton className="h-6 w-full" />
                    <Skeleton className="h-6 w-full" />
                  </div>
                ) : metrics && metrics.topAiActions.length > 0 ? (
                  <ScrollArea className="h-[200px]">
                    <div className="space-y-2 pr-2">
                      {metrics.topAiActions.map((a, i) => (
                        <div key={i} className="flex items-center justify-between rounded-md border p-2">
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate">{a.name}</p>
                            <p className="text-[10px] text-muted-foreground truncate">{a.detail || "Accion automatica"}</p>
                          </div>
                          <Badge variant="secondary" className="text-[10px] shrink-0">
                            {a.count}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
                    Sin acciones registradas
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-primary" />
              Rendimiento de agentes
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : agents.length > 0 ? (
              <div className="space-y-2">
                {agents.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between rounded-md border p-2.5"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium shrink-0">
                        {a.name.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{a.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {a.chats} chat{a.chats !== 1 ? "s" : ""} asignado{a.chats !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>
                    <Badge
                      className="text-[10px] shrink-0"
                      variant={a.chats > 10 ? "destructive" : a.chats > 5 ? "default" : "secondary"}
                    >
                      {a.chats > 10 ? "Alta carga" : a.chats > 5 ? "Activo" : "Disponible"}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
                Sin agentes con chats asignados
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
