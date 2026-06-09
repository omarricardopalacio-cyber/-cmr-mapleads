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
          .neq('status', 'deleted')
          .order('created_at', { ascending: false }),
        supabase
          .from('order_fields')
          .select('*')
          .eq('org_id', orgId)
          .order('display_order', { ascending: true })
      ])

      if (ordersRes.error) throw ordersRes.error
      if (fieldsRes.error) throw fieldsRes.error
      
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

  function getOrderFieldValue(formData: Record<string, unknown>, pattern: RegExp) {
    const entry = Object.entries(formData).find(([key]) => pattern.test(key))
    return entry ? String(entry[1] ?? '') : ''
  }

  async function deleteOrder(orderId: string) {
    if (!orgId) return
    if (!window.confirm('¿Deseas eliminar este pedido/agendamiento? Esta acción no se puede deshacer.')) return

    const { error } = await supabase
      .from('orders')
      .update({ status: 'deleted' })
      .eq('id', orderId)
      .eq('org_id', orgId)

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

  function exportToCSV() {
    if (orders.length === 0) {
      toast.error('No hay pedidos para exportar.')
      return
    }

    const headers = ['Fecha', 'Cliente', 'Teléfono', 'Total', 'Estado', 'Datos principales']
    const rows = orders.map((order) => {
      const fd = typeof order.form_data === 'string' ? JSON.parse(order.form_data) : (order.form_data || {})
      const orderTotal = formatOrderTotal(fd)
      const summary = Object.entries(fd).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join('; ')
      return [
        new Date(order.created_at).toLocaleString(),
        order.contacts?.display_name || '',
        order.contacts?.phone || order.contacts?.wa_id || '',
        orderTotal,
        order.status || '',
        summary,
      ]
    })

    const csvContent = [headers, ...rows]
      .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\r\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `orders_${orgId || 'export'}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  function printGuide(order: any) {
    const fd = typeof order.form_data === 'string' ? JSON.parse(order.form_data) : (order.form_data || {})
    const tracking = getOrderFieldValue(fd, /tracking|rastreo|c[oó]digo|guia|guía/i) || 'No disponible'
    const contactPhone = order.contacts?.phone || order.contacts?.wa_id || getOrderFieldValue(fd, /tel[eé]fono|celular|whatsapp|wa/i) || 'No registrado'
    const address = getOrderFieldValue(fd, /direcci[oó]n|address|direccion|addr/i) || 'No especificado'
    const references = getOrderFieldValue(fd, /referencia|referencias|referencia(s)?|ref/i) || 'Sin referencias'
    const notes = getOrderFieldValue(fd, /nota|notas|observaci[oó]n|obs|comentario/i) || 'Sin notas'
    const cobranza = getOrderFieldValue(fd, /cobranza|recibo|pago|charge/i) || '$0.00'
    const sender = getOrderFieldValue(fd, /remite|env[ií]a|sender|origin/i) || order.contacts?.display_name || 'No especificado'
    const orderTotal = formatOrderTotal(fd) || 'No especificado'
    const printWindow = window.open('', '_blank')
    if (!printWindow) return toast.error('Bloqueador de ventanas emergentes activado')

    const logoHtml = logoUrl
      ? `<img src="${logoUrl}" alt="Logo" style="max-height:72px; max-width:180px; object-fit:contain;" />`
      : '<div style="font-size:1.1rem;font-weight:700;color:#111;">Guía de Pedido</div>'

    const html = `
      <html>
        <head>
          <title>Guía de Pedido</title>
          <style>
            body { font-family: system-ui, sans-serif; margin: 0; padding: 14px; color: #111; }
            .page { width: 100%; max-width: 520px; margin: 0 auto; }
            .card { border: 1px solid #d1d5db; border-radius: 14px; padding: 14px; margin-bottom: 14px; }
            .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
            .title { font-size: 1.2rem; font-weight: 800; margin: 0; }
            .subtitle { font-size: 0.85rem; color: #475569; margin: 4px 0 0; }
            .grid { display: grid; gap: 10px; }
            .grid-2 { grid-template-columns: 1fr 1fr; }
            .field { padding: 10px 12px; background: #f8fafc; border-radius: 12px; }
            .field-label { font-size: 0.75rem; color: #475569; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
            .field-value { font-size: 1rem; font-weight: 700; color: #0f172a; }
            .section-title { font-size: 0.95rem; font-weight: 700; margin-bottom: 8px; }
            .row { margin-bottom: 8px; }
            .row strong { display: inline-block; width: 120px; color: #334155; }
            .footer { margin-top: 12px; font-size: 0.8rem; color: #64748b; text-align: center; }
            table { width: 100%; border-collapse: collapse; }
            td { padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
            .nowrap { white-space: nowrap; }
            @media print { body { margin: 0; } .card { border-color: #cbd5e1; } }
          </style>
        </head>
        <body>
          <div class="page">
            <div class="card">
              <div class="header">
                <div>${logoHtml}</div>
                <div style="text-align:right;">
                  <div class="title">Envíos Pronto</div>
                  <div class="subtitle">Guía de pedido</div>
                </div>
              </div>
            </div>

            <div class="card grid grid-2">
              <div class="field"><div class="field-label">Tracking</div><div class="field-value">${tracking}</div></div>
              <div class="field"><div class="field-label">Fecha</div><div class="field-value">${new Date(order.created_at).toLocaleString()}</div></div>
              <div class="field"><div class="field-label">Teléfono</div><div class="field-value">${contactPhone}</div></div>
              <div class="field"><div class="field-label">Valor pedido</div><div class="field-value">${orderTotal}</div></div>
            </div>

            <div class="card">
              <div class="section-title">Dirección de envío</div>
              <div class="field-value">${address}</div>
            </div>

            <div class="card grid grid-2">
              <div class="field"><div class="field-label">Referencias</div><div class="field-value">${references}</div></div>
              <div class="field"><div class="field-label">Cobranza</div><div class="field-value">${cobranza}</div></div>
            </div>

            <div class="card grid grid-2">
              <div class="field"><div class="field-label">Remitente</div><div class="field-value">${sender}</div></div>
              <div class="field"><div class="field-label">Estado</div><div class="field-value">${order.status || 'Sin estado'}</div></div>
            </div>

            <div class="card">
              <div class="section-title">Detalles del pedido</div>
              <table>
                ${Object.entries(fd).map(([key, value]) => `
                  <tr>
                    <td class="nowrap"><strong>${key}</strong></td>
                    <td>${String(value ?? '')}</td>
                  </tr>
                `).join('')}
              </table>
            </div>

            <div class="footer">Generado por Plan Maestro CRM IA</div>
          </div>
          <script>window.onload = function() { window.print(); window.close(); }</script>
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detalle de Pedido</DialogTitle>
          </DialogHeader>
          {selectedOrder ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border bg-slate-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Cliente</p>
                  <p className="mt-2 text-base font-semibold">{selectedOrder.contacts?.display_name || 'Sin nombre'}</p>
                </div>
                <div className="rounded-lg border bg-slate-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Teléfono</p>
                  <p className="mt-2 text-base font-semibold">{selectedOrder.contacts?.phone || selectedOrder.contacts?.wa_id || '-'}</p>
                </div>
                <div className="rounded-lg border bg-slate-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Valor</p>
                  <p className="mt-2 text-base font-semibold">{formatOrderTotal(typeof selectedOrder.form_data === 'string' ? JSON.parse(selectedOrder.form_data) : (selectedOrder.form_data || {})) || 'No especificado'}</p>
                </div>
                <div className="rounded-lg border bg-slate-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Estado</p>
                  <p className="mt-2 text-base font-semibold">{selectedOrder.status}</p>
                </div>
              </div>

              <div className="rounded-lg border bg-white p-4">
                <h3 className="text-sm font-semibold mb-3">Campos del pedido</h3>
                <div className="grid gap-2 md:grid-cols-2">
                  {Object.entries(typeof selectedOrder.form_data === 'string' ? JSON.parse(selectedOrder.form_data) : (selectedOrder.form_data || {})).map(([key, value]) => (
                    <div key={key} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">{key}</p>
                      <p className="mt-1 text-sm font-medium text-slate-900">{String(value)}</p>
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
