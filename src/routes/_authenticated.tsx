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
import { LayoutDashboard, MessagesSquare, MessageSquare, Users, Smartphone, KanbanSquare, LogOut, Zap, Sparkles, Bell, Clock, GitBranch, Megaphone, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";


import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ensureOrg } from "@/lib/org.functions";
import { getPendingRemindersCount, getPendingReminders } from "@/lib/reminders.functions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";

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

  const main = [
    { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
    { title: "Chats en Vivo", url: "/conversations", icon: MessagesSquare },
    { title: "Contactos y Clientes", url: "/contacts", icon: Users },
  ];

  const automate = [
    { title: "Auto-respuestas", url: "/auto-replies", icon: MessageSquare },
    { title: "Respuestas Rápidas", url: "/quick-replies", icon: Zap },
    { title: "Campañas Masivas", url: "/broadcasts", icon: Megaphone },
    { title: "Flujos Automatizados", url: "/flows", icon: GitBranch },
  ];

  const system = [
    { title: "Sesiones WhatsApp", url: "/sessions", icon: Smartphone },
    { title: "Pipelines", url: "/pipelines", icon: KanbanSquare },
    { title: "Integraciones IA", url: "/integrations", icon: Sparkles },
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
          <SidebarGroupLabel>Sistema</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(system)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SignOutButton />
      </SidebarFooter>
    </Sidebar>
  );
}

function SignOutButton() {
  const navigate = useNavigate();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="justify-start gap-2"
      onClick={async () => {
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
