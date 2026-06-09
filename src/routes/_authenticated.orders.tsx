import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { useServerFn } from "@tanstack/react-start"
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { ensureOrg } from "@/lib/org.functions"
import { repairMissingConfirmedOrders } from '@/lib/orders.functions'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Printer, Download, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

export const Route = createFileRoute('/_authenticated/orders')({
  component: OrdersModule,
})

function OrdersModule() {
  const { session } = useAuth()
  const [orgId, setOrgId] = useState<string | null>(null)
  
  const [orders, setOrders] = useState<any[]>([])
  const [fields, setFields] = useState<any[]>([])
  const [newFieldName, setNewFieldName] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)

  const ensure = useServerFn(ensureOrg)
  const repairOrders = useServerFn(repairMissingConfirmedOrders)

  useEffect(() => {
    async function initOrg() {
      if (!session?.user?.id) return;
      
      try {
        // Primero consultar directamente desde el cliente Supabase, ya que user_metadata puede quedar desactualizado.
        const { data: existing } = await supabase
          .from("user_roles")
          .select("org_id")
          .eq("user_id", session.user.id)
          .limit(1)
          .maybeSingle();
        
        if (existing?.org_id) {
          setOrgId(existing.org_id);
          return;
        }

        // Si no, intentar con metadata y luego crear la organización si no existe.
        if (session.user.user_metadata?.org_id) {
          setOrgId(session.user.user_metadata.org_id);
          return;
        }

        const res = await ensure({});
        if (res?.orgId) setOrgId(res.orgId);
        else toast.error('No se pudo encontrar tu organización.');
      } catch (err: any) {
        console.error('Error initOrg:', err);
        toast.error('Error cargando organización: ' + err.message);
      }
    }
    initOrg();
  }, [session, ensure])

  useEffect(() => {
    if (!orgId) return;

    const repairAndLoad = async () => {
      setLoading(true);
      try {
        await repairOrders({});
      } catch (err: any) {
        console.warn('repairMissingConfirmedOrders failed:', err?.message || err);
      } finally {
        await loadData();
      }
    };

    repairAndLoad();
  }, [orgId, repairOrders])

  useEffect(() => {
    if (orgId) {
      loadData()
      const storedLogo = window.localStorage.getItem(`orderGuideLogo-${orgId}`)
      if (storedLogo) setLogoUrl(storedLogo)
    }
  }, [orgId])

  async function loadData() {
    if (!orgId) return;
    setLoading(true)
    try {
      const [ordersRes, fieldsRes] = await Promise.all([
        supabase
          .from('orders')
          .select('*, contacts(id, display_name, wa_id, phone, profile_picture_url)')
          .eq('org_id', orgId)
          .order('created_at', { ascending: false }),
        supabase
          .from('order_fields')
          .select('*')
          .eq('org_id', orgId)
          .order('display_order', { ascending: true })
      ])
      
      if (ordersRes.data) setOrders(ordersRes.data)
      if (fieldsRes.data) setFields(fieldsRes.data)
    } catch (err: any) {
      toast.error('Error cargando datos: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  async function addField(e: React.FormEvent) {
    e.preventDefault()
    if (!newFieldName.trim()) {
      toast.error('El nombre del campo no puede estar vacío');
      return;
    }
    if (!orgId) {
      toast.error('No se ha cargado tu identificador de organización. Por favor, refresca la página.');
      return;
    }
    
    const { data, error } = await supabase.from('order_fields').insert({
      org_id: orgId,
      name: newFieldName.trim(),
      display_order: fields.length + 1,
      is_required: true,
      field_type: 'text'
    }).select().single()

    if (error) {
      toast.error('Error creando campo')
    } else if (data) {
      toast.success('Campo añadido')
      setFields([...fields, data])
      setNewFieldName('')
    }
  }

  async function deleteField(id: string) {
    const { error } = await supabase.from('order_fields').delete().eq('id', id)
    if (error) toast.error('Error eliminando campo')
    else {
      toast.success('Campo eliminado')
      setFields(fields.filter(f => f.id !== id))
    }
  }

  function formatOrderTotal(formData: Record<string, unknown>) {
    const keys = Object.keys(formData)
    const match = keys.find((key) => /total|valor|monto|precio|amount|order[_ ]?value/i.test(key))
    if (!match) return ''
    return String(formData[match] ?? '')
  }

  async function deleteOrder(orderId: string) {
    if (!orgId) return
    if (!window.confirm('¿Deseas eliminar este pedido/agendamiento? Esta acción no se puede deshacer.')) return

    const { error } = await supabase.from('orders').delete().eq('id', orderId).eq('org_id', orgId)
    if (error) {
      toast.error('Error eliminando pedido: ' + error.message)
      return
    }

    toast.success('Pedido eliminado')
    setSelectedOrder(null)
    loadData()
  }

  async function uploadLogoFile(file: File) {
    if (!orgId) return
    setUploadingLogo(true)
    try {
      const key = `order_guide_logo_${orgId}_${file.name}`
      const { error: uploadError } = await supabase.storage
        .from('media')
        .upload(key, file, { upsert: true })

      if (uploadError) {
        throw uploadError
      }

      const { data: urlData, error: urlError } = await supabase.storage
        .from('media')
        .getPublicUrl(key)

      if (urlError || !urlData?.publicUrl) {
        throw new Error(urlError?.message || 'No se pudo obtener URL pública')
      }

      setLogoUrl(urlData.publicUrl)
      window.localStorage.setItem(`orderGuideLogo-${orgId}`, urlData.publicUrl)
      toast.success('Logo cargado para la guía de pedidos')
    } catch (err: any) {
      console.error('Logo upload error', err)
      toast.error('No se pudo cargar el logo: ' + (err?.message || 'error desconocido'))
    } finally {
      setUploadingLogo(false)
    }
  }

  function handleLogoSelection(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    uploadLogoFile(file)
  }

  function printGuide(order: any) {
    const fd = typeof order.form_data === 'string' ? JSON.parse(order.form_data) : (order.form_data || {})
    const printWindow = window.open('', '_blank')
    if (!printWindow) return toast.error('Bloqueador de ventanas emergentes activado')
    
    const logoHtml = logoUrl
      ? `<div style="text-align:center;margin-bottom:18px"><img src="${logoUrl}" alt="Logo" style="max-height:80px;max-width:240px;object-fit:contain;margin:0 auto"/></div>`
      : ''

    const html = `
      <html>
        <head>
          <title>Guía de Pedido</title>
          <style>
            body { font-family: system-ui, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; color: #111; }
            .ticket { border: 1px solid #ddd; padding: 20px; border-radius: 12px; }
            h2 { text-align: center; margin-top: 0; margin-bottom: 12px; }
            .row { margin-bottom: 10px; }
            .label { font-weight: 700; color: #444; font-size: 0.88rem; margin-bottom: 4px; }
            .val { font-size: 1rem; color: #111; }
            .section { margin-bottom: 18px; padding: 12px 14px; border-radius: 12px; background: #f9fafb; }
            .summary { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
            .summary-item { border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px; background: #fff; }
            .footer { margin-top: 24px; font-size: 0.82rem; color: #6b7280; text-align: center; }
            @media print { body { box-shadow: none; border: none; } .section { background: transparent; } }
          </style>
        </head>
        <body>
          <div class="ticket">
            ${logoHtml}
            <h2>Guía de Pedido</h2>
            <div class="section">
              <div class="row"><div class="label">Fecha</div><div class="val">${new Date(order.created_at).toLocaleString()}</div></div>
              <div class="row"><div class="label">Cliente</div><div class="val">${order.contacts?.display_name || 'Sin nombre'}</div></div>
              <div class="row"><div class="label">Teléfono</div><div class="val">${order.contacts?.phone || order.contacts?.wa_id || 'No disponible'}</div></div>
              <div class="row"><div class="label">Estado</div><div class="val">${order.status}</div></div>
              <div class="row"><div class="label">Valor del pedido</div><div class="val">${formatOrderTotal(fd) || 'No especificado'}</div></div>
            </div>
            <div class="section">
              <div class="label">Detalle completo</div>
              ${Object.keys(fd).map((k) => `
                <div class="row">
                  <div class="label">${k}</div>
                  <div class="val">${String(fd[k] ?? '')}</div>
                </div>
              `).join('')}
            </div>
            <div class="footer">Generado por el módulo de pedidos. Verifique la información antes de entregar.</div>
          </div>
          <script>window.onload = function() { window.print(); window.close(); }</script>
        </body>
      </html>
    `
    printWindow.document.write(html)
    printWindow.document.close()
  }

  function printGuide(order: any) {
    const fd = typeof order.form_data === 'string' ? JSON.parse(order.form_data) : (order.form_data || {})
    const printWindow = window.open('', '_blank')
    if (!printWindow) return toast.error('Bloqueador de ventanas emergentes activado')
    
    const html = `
      <html>
        <head>
          <title>Guía de Pedido</title>
          <style>
            body { font-family: system-ui, sans-serif; max-width: 400px; margin: 20px auto; padding: 20px; border: 1px dashed #ccc; }
            h2 { text-align: center; margin-top: 0; }
            .row { margin-bottom: 8px; border-bottom: 1px solid #eee; padding-bottom: 4px; }
            .label { font-weight: bold; color: #555; font-size: 0.9em; }
            .val { font-size: 1.1em; }
            @media print {
              body { border: none; }
            }
          </style>
        </head>
        <body>
          <h2>Ticket de Pedido</h2>
          <div class="row">
            <div class="label">Fecha</div>
            <div class="val">${new Date(order.created_at).toLocaleString()}</div>
          </div>
          <div class="row">
            <div class="label">Teléfono Contacto</div>
            <div class="val">${order.contacts?.phone || 'No registrado'}</div>
          </div>
          <hr style="margin: 15px 0" />
          ${Object.keys(fd).map(k => `
            <div class="row">
              <div class="label">${k}</div>
              <div class="val">${fd[k]}</div>
            </div>
          `).join('')}
          <div style="margin-top: 30px; text-align: center; font-size: 0.8em; color: #666;">
            Generado por Sistema CRM IA
          </div>
          <script>
            window.onload = function() { window.print(); window.close(); }
          </script>
        </body>
      </html>
    `
    printWindow.document.write(html)
    printWindow.document.close()
  }

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Módulo de Pedidos</h2>
      </div>

      <Tabs defaultValue="list" className="space-y-4">
        <TabsList>
          <TabsTrigger value="list">Listado de Pedidos</TabsTrigger>
          <TabsTrigger value="fields">Constructor de Formulario (IA)</TabsTrigger>
        </TabsList>
        
        <TabsContent value="list">
          <Card>
            <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>Pedidos Registrados</CardTitle>
                <CardDescription>
                  Datos recopilados por la IA o agentes humanos.
                </CardDescription>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button onClick={exportToCSV} variant="outline" size="sm">
                  <Download className="mr-2 h-4 w-4" />
                  Exportar CSV
                </Button>
                <Button onClick={() => setSelectedOrder(null)} variant="outline" size="sm">
                  Actualizar tabla
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
                <div className="rounded-md border p-4">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-semibold">Vista de Guía</h3>
                      <p className="text-sm text-muted-foreground">Carga un logo para que aparezca en la guía de pedidos.</p>
                    </div>
                  </div>
                  {logoUrl ? (
                    <div className="mb-4">
                      <img src={logoUrl} alt="Logo guía" className="max-h-28 object-contain" />
                    </div>
                  ) : (
                    <div className="mb-4 rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                      Sin logo cargado aún.
                    </div>
                  )}
                  <div className="space-y-2">
                    <label className="block text-sm font-medium">Logo de la guía</label>
                    <input type="file" accept="image/*" onChange={handleLogoSelection} className="block w-full text-sm" />
                    {uploadingLogo && <p className="text-sm text-muted-foreground">Cargando logo...</p>}
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <h3 className="text-lg font-semibold mb-2">Instrucciones de impresión</h3>
                  <p className="text-sm text-muted-foreground">Cuando imprimas la guía, se mostrará el logo cargado, la información completa del pedido y el valor del pedido.</p>
                  <div className="mt-4 space-y-3">
                    <div className="rounded-lg bg-slate-50 p-3 text-sm">
                      <strong>1.</strong> Selecciona un pedido y haz click en el icono de impresora.
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3 text-sm">
                      <strong>2.</strong> La guía incluirá todos los campos capturados por la IA.
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3 text-sm">
                      <strong>3.</strong> Si falta valor del pedido, agrega un campo con nombre "Total", "Valor" o "Monto" en el constructor.
                    </div>
                  </div>
                </div>
              </div>

              {loading ? (
                <div className="text-sm text-muted-foreground">Cargando...</div>
              ) : orders.length === 0 ? (
                <div className="text-sm text-muted-foreground">No hay pedidos registrados.</div>
              ) : (
                <div className="rounded-md border overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Cliente</TableHead>
                        <TableHead>Teléfono</TableHead>
                        <TableHead>Total</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Datos principales</TableHead>
                        <TableHead className="text-right">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orders.map((o) => {
                        const fd = typeof o.form_data === 'string' ? JSON.parse(o.form_data) : (o.form_data || {})
                        const phone = o.contacts?.phone || o.contacts?.wa_id || '-'
                        const customer = o.contacts?.display_name || 'Sin nombre'
                        const orderTotal = formatOrderTotal(fd)
                        const summary = Object.entries(fd).slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(', ')

                        return (
                          <TableRow key={o.id}>
                            <TableCell className="font-medium">{new Date(o.created_at).toLocaleDateString()}</TableCell>
                            <TableCell>{customer}</TableCell>
                            <TableCell>{phone}</TableCell>
                            <TableCell>{orderTotal || '-'}</TableCell>
                            <TableCell>{o.status}</TableCell>
                            <TableCell className="max-w-[220px] truncate">{summary || '-'}</TableCell>
                            <TableCell className="text-right space-x-1">
                              <Button variant="ghost" size="icon" onClick={() => printGuide(o)} title="Imprimir Guía / Ticket">
                                <Printer className="h-4 w-4 text-blue-600" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => setSelectedOrder(o)} title="Ver detalles">
                                <Plus className="h-4 w-4 text-slate-600" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="fields">
          <Card>
            <CardHeader>
              <CardTitle>Campos del Formulario</CardTitle>
              <CardDescription>
                Define qué datos debe pedirle la IA al cliente para agendar un pedido. 
                (Ej: Nombre completo, Dirección, Barrio, Producto de interés).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={addField} className="flex flex-col gap-2 sm:flex-row">
                <Input 
                  placeholder="Nuevo campo (ej. Dirección de entrega)" 
                  value={newFieldName} 
                  onChange={(e) => setNewFieldName(e.target.value)} 
                  className="flex-1"
                />
                <Button type="submit" className="sm:w-auto">
                  <Plus className="mr-2 h-4 w-4" />
                  Agregar Campo
                </Button>
              </form>

              <div className="rounded-md border mt-6 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nombre del Campo</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Obligatorio</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fields.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground h-24">
                          No has definido ningún campo.
                        </TableCell>
                      </TableRow>
                    )}
                    {fields.map((f) => (
                      <TableRow key={f.id}>
                        <TableCell className="font-medium">{f.name}</TableCell>
                        <TableCell>Texto</TableCell>
                        <TableCell>Sí</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => deleteField(f.id)}>
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(selectedOrder)} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Detalle de Pedido</DialogTitle>
          </DialogHeader>
          {selectedOrder ? (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border bg-slate-50 p-4">
                  <p className="text-sm text-muted-foreground">Cliente</p>
                  <p className="font-medium">{selectedOrder.contacts?.display_name || 'Sin nombre'}</p>
                </div>
                <div className="rounded-lg border bg-slate-50 p-4">
                  <p className="text-sm text-muted-foreground">Teléfono</p>
                  <p className="font-medium">{selectedOrder.contacts?.phone || selectedOrder.contacts?.wa_id || '-'}</p>
                </div>
                <div className="rounded-lg border bg-slate-50 p-4">
                  <p className="text-sm text-muted-foreground">Valor</p>
                  <p className="font-medium">{formatOrderTotal(typeof selectedOrder.form_data === 'string' ? JSON.parse(selectedOrder.form_data) : (selectedOrder.form_data || {})) || 'No especificado'}</p>
                </div>
                <div className="rounded-lg border bg-slate-50 p-4">
                  <p className="text-sm text-muted-foreground">Estado</p>
                  <p className="font-medium">{selectedOrder.status}</p>
                </div>
              </div>

              <div className="rounded-md border p-4">
                <h3 className="text-sm font-semibold mb-3">Campos del pedido</h3>
                <div className="grid gap-3">
                  {Object.entries(typeof selectedOrder.form_data === 'string' ? JSON.parse(selectedOrder.form_data) : (selectedOrder.form_data || {})).map(([key, value]) => (
                    <div key={key} className="rounded-lg border bg-white p-3">
                      <p className="text-xs text-muted-foreground">{key}</p>
                      <p className="text-sm font-medium">{String(value)}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 justify-end">
                <Button variant="destructive" onClick={() => deleteOrder(selectedOrder.id)}>
                  Eliminar pedido
                </Button>
                <Button onClick={() => printGuide(selectedOrder)}>
                  Imprimir Guía
                </Button>
                <Button variant="secondary" onClick={() => setSelectedOrder(null)}>
                  Cerrar
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
