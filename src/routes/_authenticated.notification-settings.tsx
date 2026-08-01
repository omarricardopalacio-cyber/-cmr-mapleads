import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import {
  getNotificationSettings,
  updateNotificationSettings,
  sendTestNotificationAlert,
} from "@/lib/notifications.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Bell, Send, CheckCircle2, AlertTriangle, ShieldCheck, Smartphone } from "lucide-react";

export const Route = createFileRoute("/_authenticated/notification-settings")({
  component: NotificationSettingsPage,
});

function NotificationSettingsPage() {
  const getSettingsFn = useServerFn(getNotificationSettings);
  const updateSettingsFn = useServerFn(updateNotificationSettings);
  const sendTestFn = useServerFn(sendTestNotificationAlert);
  const qc = useQueryClient();

  const [form, setForm] = useState({
    notification_whatsapp_number: "",
    notify_on_sale: true,
    notify_on_agent_transfer: true,
  });

  const query = useQuery({
    queryKey: ["notificationSettings"],
    queryFn: () => getSettingsFn({}),
  });

  useEffect(() => {
    if (query.data) {
      setForm({
        notification_whatsapp_number: query.data.notification_whatsapp_number || "",
        notify_on_sale: query.data.notify_on_sale,
        notify_on_agent_transfer: query.data.notify_on_agent_transfer,
      });
    }
  }, [query.data]);

  const saveMut = useMutation({
    mutationFn: () =>
      updateSettingsFn({
        data: {
          notification_whatsapp_number: form.notification_whatsapp_number.trim() || null,
          notify_on_sale: form.notify_on_sale,
          notify_on_agent_transfer: form.notify_on_agent_transfer,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notificationSettings"] });
      toast.success("Configuración de alertas guardada exitosamente");
    },
    onError: (e: Error) => toast.error(e.message || "Error al guardar configuración"),
  });

  const testMut = useMutation({
    mutationFn: () => sendTestFn({}),
    onSuccess: () => {
      toast.success("Mensaje de prueba encolado en WhatsApp correctamente");
    },
    onError: (e: Error) => toast.error(e.message || "Error al enviar prueba"),
  });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <div>
        <div className="flex items-center gap-2">
          <Bell className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          <h1 className="text-2xl font-bold tracking-tight">Alertas y Notificaciones de WhatsApp</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Configura el número de celular de WhatsApp al que deseas enviar notificaciones automáticas en tiempo real cuando un chat compre o sea transferido a un agente.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Smartphone className="h-5 w-5 text-emerald-600" />
              Destino y Reglas de Notificación
            </CardTitle>
            <CardDescription>
              Ingresa el número de WhatsApp con código de país (Ej: 573001234567 para Colombia).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="target-phone" className="font-semibold text-sm">
                Número de WhatsApp Destino para Alertas
              </Label>
              <div className="flex gap-2">
                <Input
                  id="target-phone"
                  value={form.notification_whatsapp_number}
                  onChange={(e) => setForm({ ...form, notification_whatsapp_number: e.target.value })}
                  placeholder="Ej: 573001234567 o +57 300 123 4567"
                  className="font-mono text-base"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                A este celular llegarán los reportes inmediatos de compras y transferencias.
              </p>
            </div>

            <div className="space-y-4 rounded-lg border p-4 bg-muted/20">
              <h3 className="font-semibold text-sm">Eventos Notificados</h3>

              {/* Notificar Ventas */}
              <div className="flex items-center justify-between gap-4 rounded-md border bg-card p-3 shadow-sm">
                <div className="space-y-0.5">
                  <Label htmlFor="notify-sale" className="font-medium cursor-pointer">
                    Notificar sobre Nueva Venta / Pedido
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Envía un mensaje de WhatsApp cuando el cliente confirme un pedido con todos los datos.
                  </p>
                </div>
                <Switch
                  id="notify-sale"
                  checked={form.notify_on_sale}
                  onCheckedChange={(v) => setForm({ ...form, notify_on_sale: v })}
                />
              </div>

              {/* Notificar Transferencia a Agente */}
              <div className="flex items-center justify-between gap-4 rounded-md border bg-card p-3 shadow-sm">
                <div className="space-y-0.5">
                  <Label htmlFor="notify-transfer" className="font-medium cursor-pointer">
                    Notificar sobre Transferencia a Agente
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Envía una alerta cuando la IA transfiera la atención a un agente humano indicando el celular del cliente.
                  </p>
                </div>
                <Switch
                  id="notify-transfer"
                  checked={form.notify_on_agent_transfer}
                  onCheckedChange={(v) => setForm({ ...form, notify_on_agent_transfer: v })}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              <Button
                type="button"
                disabled={saveMut.isPending}
                onClick={() => saveMut.mutate()}
                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
              >
                <CheckCircle2 className="h-4 w-4" />
                {saveMut.isPending ? "Guardando..." : "Guardar Configuración"}
              </Button>

              <Button
                type="button"
                variant="outline"
                disabled={testMut.isPending || !form.notification_whatsapp_number.trim()}
                onClick={() => testMut.mutate()}
                className="gap-2"
              >
                <Send className="h-4 w-4 text-emerald-600" />
                {testMut.isPending ? "Enviando prueba..." : "Probar Alerta en Vivo"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Vista previa de plantillas de alerta */}
        <div className="space-y-4">
          <Card className="border-emerald-500/30 bg-emerald-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4" /> Formato de Alerta por Venta
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs font-mono whitespace-pre-wrap leading-relaxed text-slate-700 dark:text-slate-300">
{`🛍️ *¡NUEVA VENTA CONFIRMADA!*

📱 Cliente: Carlos Pérez (573001234567)
💬 Chat ID: 8a9f...

📦 DETALLES:
• Producto: Tenis Pro Run
• Cantidad: 1
• Total: $120.000 COP
• Comprador: Carlos Pérez
• Dirección: Calle 10 # 5-20, Bogotá
• Notas: Pagar contra entrega`}
            </CardContent>
          </Card>

          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" /> Formato Alerta por Agente
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs font-mono whitespace-pre-wrap leading-relaxed text-slate-700 dark:text-slate-300">
{`🚨 *ATENCIÓN REQUERIDA - REMITIDO A AGENTE*

El celular *573001234567* (María López) necesita atención y fue remitido a un agente humano.

📌 DETALLES DEL CHAT:
• Chat ID: 3b12...
• Último mensaje: "Solicitud de agente"
• Estado: IA desactivada`}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
