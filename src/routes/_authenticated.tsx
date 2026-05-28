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
import { LayoutDashboard, MessagesSquare, Users, Smartphone, KanbanSquare, LogOut } from "lucide-react";
import { LayoutDashboard, MessagesSquare, Users, Smartphone, KanbanSquare, LogOut, Zap } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ensureOrg } from "@/lib/org.functions";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: ({ context, location }) => {
    if (!context.auth.isReady) return;
    if (!context.auth.isAuthenticated) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  component: AuthedLayout,
});

const items = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
const items = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Conversaciones", url: "/conversations", icon: MessagesSquare },
  { title: "Contactos", url: "/contacts", icon: Users },
  { title: "Automatizaciones", url: "/automations", icon: Zap },
  { title: "Sesiones WhatsApp", url: "/sessions", icon: Smartphone },
  { title: "Pipelines", url: "/pipelines", icon: KanbanSquare },
] as const;

function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>WhatsApp CRM</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={pathname.startsWith(item.url)}>
                    <Link to={item.url} className="flex items-center gap-2">
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
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
          </header>
          <main className="flex-1 p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
