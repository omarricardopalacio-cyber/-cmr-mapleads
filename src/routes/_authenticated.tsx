import { createFileRoute, redirect, Outlet, Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { LayoutDashboard, MessagesSquare, MessageSquare, Users, Smartphone, KanbanSquare, LogOut, Zap, Sparkles, Bell, Clock, GitBranch, Megaphone, Settings, BookOpen, UserCheck, MapPin, Store, ClipboardList, Shield, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ensureOrg } from "@/lib/org.functions";
import { getPendingRemindersCount, getPendingReminders } from "@/lib/reminders.functions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { getSaasAccess, stopImpersonationFn } from "@/lib/saas-admin.functions";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: ({ context, location }) => {
    if (!context.auth.isReady) return;
    if (!context.auth.isAuthenticated) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  component: AuthedLayout,
});

function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: saasAccess, isLoading, isError, error } = useQuery({
    queryKey: ["saasAccess"],
    queryFn: () => getSaasAccess({}),
    retry: false,
  });

  useEffect(() => {
    console.log("[AppSidebar] saasAccess:", saasAccess, "loading:", isLoading, "error:", error);
  }, [saasAccess, isLoading, error]);

  const main = [
    { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
    { title: "Chats en Vivo", url: "/conversations", icon: MessagesSquare },
    { title: "Contactos y Clientes", url: "/contacts", icon: Users },
    { title: "Pedidos", url: "/orders", icon: ClipboardList },
  ];

  const automate = [
    { title: "Auto-respuestas", url: "/auto-replies", icon: MessageSquare },
    { title: "Respuestas Rápidas", url: "/quick-replies", icon: Zap },
    { title: "Campañas Masivas", url: "/broadcasts", icon: Megaphone },
    { title: "Flujos Automatizados", url: "/flows", icon: GitBranch },
  ];

  const aiConfig = [
    { title: "Base de Conocimiento", url: "/knowledge", icon: BookOpen },
    // { title: "Reglas de Transferencia", url: "/transfer-rules", icon: UserCheck },
    { title: "Integración Catálogo", url: "/catalog-integrations", icon: Store },
  ];

  const leads = [
    { title: "Mapleads", url: "/mapleads", icon: MapPin },
  ];

  const system = [
    { title: "Sesiones WhatsApp", url: "/sessions", icon: Smartphone },
    // { title: "Pipelines", url: "/pipelines", icon: KanbanSquare },
    { title: "Integraciones IA", url: "/integrations", icon: Sparkles },
  ];

  const saas = [
    { title: "Admin SaaS", url: "/saas-admin", icon: Shield },
  ];

  const renderItems = (items: typeof main) =>
    items.map((item) => (
      <SidebarMenuItem key={item.title}>
        <SidebarMenuButton asChild isActive={pathname.startsWith(item.url)}>
          <Link to={item.url} search={item.query} className="flex items-center gap-2">
            <item.icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{item.title}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    ));

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Principal</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(main)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Automatización</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(automate)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Configuración IA</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(aiConfig)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Búsqueda de clientes</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(leads)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Sistema</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(system)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {saasAccess?.isSuperAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Administración</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderItems(saas)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter>
        <SignOutButton />
      </SidebarFooter>
    </Sidebar>
  );
}

function SignOutButton() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="justify-start gap-2"
      onClick={async () => {
        queryClient.clear();
        await supabase.auth.signOut();
        navigate({ to: "/login" });
      }}
    >
      <LogOut className="h-4 w-4" />
      <span>Cerrar sesión</span>
    </Button>
  );
}

function AuthedLayout() {
  const ensure = useServerFn(ensureOrg);
  useEffect(() => {
    ensure({}).catch((e) => console.error("ensureOrg", e));
  }, [ensure]);

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <header className="h-12 flex items-center border-b px-2 gap-2">
            <SidebarTrigger />
            <span className="text-sm text-muted-foreground">Workspace</span>
            <div className="flex-1" />
            <RemindersBell />
          </header>
          <ImpersonationBanner />
          <main className="flex-1 p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

type PendingReminder = {
  id: string;
  note: string;
  reminder_at: string;
  contacts?:
    | { display_name?: string | null; wa_id?: string | null }[]
    | { display_name?: string | null; wa_id?: string | null }
    | null;
};

function ImpersonationBanner() {
  const stopFn = useServerFn(stopImpersonationFn);
  const queryClient = useQueryClient();
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    // Aquí se detectaría si hay una suplantación activa
    // Por ahora, se puede agregar lógica para obtenerlo de un query
    const checkImpersonation = () => {
      const storedImpersonation = localStorage.getItem("activeImpersonation");
      setIsActive(!!storedImpersonation);
    };
    checkImpersonation();
  }, []);

  if (!isActive) return null;

  const handleStop = async () => {
    try {
      await stopFn({});
      localStorage.removeItem("activeImpersonation");
      queryClient.invalidateQueries({ queryKey: ["saasAccess"] });
      setIsActive(false);
    } catch (error) {
      console.error("Failed to stop impersonation:", error);
    }
  };

  return (
    <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Shield className="h-4 w-4 text-yellow-600" />
        <span className="text-sm text-yellow-800">
          You are currently impersonating an organization
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={handleStop}
        className="gap-2"
      >
        <X className="h-4 w-4" />
        Stop Impersonation
      </Button>
    </div>
  );
}

function RemindersBell() {
  const countFn = useServerFn(getPendingRemindersCount);
  const listFn = useServerFn(getPendingReminders);
  const { data: countData } = useQuery({
    queryKey: ["pendingRemindersCount"],
    queryFn: () => countFn({}),
    refetchInterval: 30000,
  });
  const { data: listData } = useQuery({
    queryKey: ["pendingReminders"],
    queryFn: () => listFn({}),
    refetchInterval: 30000,
  });

  const count = countData?.count ?? 0;
  const reminders = listData?.reminders ?? [];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="relative p-2 rounded-md hover:bg-muted transition-colors">
          <Bell className="h-4 w-4 text-muted-foreground" />
          {count > 0 && (
            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-background" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <div className="p-3 border-b font-medium text-sm">Recordatorios pendientes</div>
        <ScrollArea className="max-h-64">
          <div className="p-3 space-y-2">
            {reminders.length === 0 && (
              <p className="text-xs text-muted-foreground text-center">No hay recordatorios vencidos</p>
            )}
            {reminders.map((raw: unknown) => {
              const r = raw as PendingReminder;
              const contact = Array.isArray(r.contacts) ? r.contacts[0] : r.contacts;
              return (
                <Card key={r.id} className="p-2">
                  <CardContent className="p-0 space-y-1">
                    <p className="text-xs font-medium truncate">{contact?.display_name || contact?.wa_id || "Contacto"}</p>
                    <p className="text-xs text-muted-foreground">{r.note}</p>
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(r.reminder_at).toLocaleString()}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
