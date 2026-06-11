import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useRef } from 'react'
import { useServerFn } from "@tanstack/react-start"
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { ensureOrg } from "@/lib/org.functions"
import { uploadMedia } from '@/lib/upload-media'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Printer, Download, Plus, Trash2, ImagePlus } from 'lucide-react'
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
  const [organizationOrderLogoUrl, setOrganizationOrderLogoUrl] = useState<string | null>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const ensure = useServerFn(ensureOrg)

  useEffect(() => {
    async function initOrg() {
      if (!session?.user?.id) return;
      
      try {
        // Primero intentar obtener del user_metadata
        if (session.user.user_metadata?.org_id) {
          setOrgId(session.user.user_metadata.org_id);
          return;
        }
        
        // Si no, consultar directamente desde el cliente Supabase
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
        
        // Si aún no existe, usar el serverFn para crear la organización
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
    if (orgId) {
      loadData()
    }
  }, [orgId])

  async function loadData() {
    if (!orgId) return;
    setLoading(true)
    try {
      const [ordersRes, fieldsRes, configRes] = await Promise.all([
        supabase
          .from('orders')
          .select('*, contacts:contact_id(id, display_name, wa_id, phone, profile_picture_url)')
          .eq('org_id', orgId)
          .order('created_at', { ascending: false }),
        supabase
          .from('order_fields')
          .select('*')
          .eq('org_id', orgId)
          .order('display_order', { ascending: true }),
        supabase
          .from('ai_configs')
          .select('order_logo_url')
          .eq('org_id', orgId)
          .maybeSingle(),
      ])

      if (ordersRes.error) {
        console.error('Error cargando pedidos:', ordersRes.error)
        toast.error('Error cargando pedidos: ' + ordersRes.error.message)
      } else if (ordersRes.data) {
        setOrders(ordersRes.data)
      }

      if (fieldsRes.error) {
        console.error('Error cargando campos de pedido:', fieldsRes.error)
        toast.error('Error cargando campos de pedido: ' + fieldsRes.error.message)
      } else if (fieldsRes.data) {
        setFields(fieldsRes.data)
      }

      if (configRes.error) {
        console.error('Error cargando logo de pedidos:', configRes.error)
      } else if (configRes.data) {
        setOrganizationOrderLogoUrl(configRes.data.order_logo_url ?? null)
      }
    } catch (err: any) {
      console.error('Error inesperado cargando datos del módulo de pedidos:', err)
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

  async function deleteOrder(id: string) {
    if (!window.confirm('¿Estás seguro de eliminar este pedido? Esta acción no se puede deshacer.')) return;
    const { error } = await supabase.from('orders').delete().eq('id', id)
    if (error) {
      toast.error('Error eliminando pedido: ' + error.message)
    } else {
      toast.success('Pedido eliminado')
      setOrders(orders.filter((o) => o.id !== id))
    }
  }

  function startLogoUpload() {
    fileInputRef.current?.click()
  }

  async function handleLogoFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (!file.type.startsWith('image/')) {
      toast.error('Solo se admite imagen para el logo')
      return
    }

    if (!orgId) {
      toast.error('No se ha cargado tu organización. Por favor, refresca la página.')
      return
    }

    setUploadingLogo(true)
    try {
      const { url } = await uploadMedia(file)
      const { data, error } = await supabase
        .from('ai_configs')
        .upsert({ org_id: orgId, order_logo_url: url }, { onConflict: ['org_id'] })
        .select()
        .single()

      if (error) {
        toast.error('Error guardando logo del módulo de pedidos: ' + error.message)
      } else {
        toast.success('Logo del módulo de pedidos guardado')
        setOrganizationOrderLogoUrl((data as any)?.order_logo_url ?? null)
      }
    } catch (err: any) {
      toast.error('Error subiendo logo: ' + err.message)
    } finally {
      setUploadingLogo(false)
    }
  }

  function exportToCSV() {
    if (!orders.length) return toast.info('No hay pedidos para exportar')
    
    // Obtener todos los keys únicos de los formularios
    const allKeys = new Set<string>()
    orders.forEach(o => {
      const fd = typeof o.form_data === 'string' ? JSON.parse(o.form_data) : (o.form_data || {})
      Object.keys(fd).forEach(k => allKeys.add(k))
    })
    
    const keys = Array.from(allKeys)
    const header = ['ID', 'Fecha', 'Estado', 'Teléfono', ...keys].join(',')
    
    const rows = orders.map(o => {
      const fd = typeof o.form_data === 'string' ? JSON.parse(o.form_data) : (o.form_data || {})
      const date = new Date(o.created_at).toLocaleString()
      const phone = o.contacts?.phone || ''
      const rowData = [
        o.id,
        date,
        o.status,
        phone,
        ...keys.map(k => `"${(fd[k] || '').toString().replace(/"/g, '""')}"`)
      ]
      return rowData.join(',')
    })
    
    const csvContent = [header, ...rows].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.setAttribute('download', `Pedidos_${new Date().toISOString().split('T')[0]}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  function printGuide(order: any) {
    const fd = typeof order.form_data === 'string' ? JSON.parse(order.form_data) : (order.form_data || {})
    const orderLogoUrl = fd.logo_url || fd.logoUrl || fd.logo || ''
    const logoUrl = organizationOrderLogoUrl || orderLogoUrl || ''
    const orderFieldsList = fields.map((field) => field.name)
    const formatValue = (value: unknown) => {
      if (value === null || value === undefined || value === '') return '-'
      if (typeof value === 'object') return JSON.stringify(value, null, 2)
      return String(value)
    }
    const escapeHtml = (text: string) =>
      text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')

    const fixedRows = orderFieldsList
      .filter((name) => name in fd)
      .map((name) => ({ label: name, value: formatValue(fd[name]) }))

    const extras = Object.entries(fd)
      .filter(
        ([key]) =>
          !['logo_url', 'logoUrl', 'logo', '_source_message_id', 'Origen', 'Historial reciente', 'Confirmación cliente', 'Respuesta de confirmación enviada', 'Registrado en'].includes(key) &&
          !orderFieldsList.includes(key),
      )
      .map(([key, value]) => ({ label: key, value: formatValue(value) }))

    const itemRows = Array.isArray(fd.items) ? fd.items : []
    const printWindow = window.open('', '_blank')
    if (!printWindow) return toast.error('Bloqueador de ventanas emergentes activado')

    const html = `
      <html>
        <head>
          <title>Guía de Pedido</title>
          <style>
            body { font-family: system-ui, sans-serif; max-width: 420px; margin: 20px auto; padding: 20px; border: 1px dashed #ccc; }
            .header { text-align: center; margin-bottom: 20px; }
            .logo { max-height: 80px; max-width: 100%; object-fit: contain; margin-bottom: 12px; }
            h2 { margin: 0; font-size: 1.6rem; }
            .subtitle { color: #666; font-size: 0.9rem; margin-top: 4px; }
            .section { margin-bottom: 18px; }
            .section-title { font-size: 0.95rem; font-weight: 700; margin-bottom: 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
            .row { margin-bottom: 8px; }
            .label { font-weight: 700; color: #444; font-size: 0.85rem; }
            .val { font-size: 1rem; margin-top: 2px; white-space: pre-wrap; }
            .item-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
            .item-table th, .item-table td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            .item-table th { background: #f7f7f7; }
            .footer { margin-top: 24px; text-align: center; font-size: 0.8rem; color: #666; }
            @media print { body { border: none; } }
          </style>
        </head>
        <body>
          <div class="header">
            ${logoUrl ? `<img class="logo" src="${escapeHtml(logoUrl)}" alt="Logo" />` : ''}
            <h2>Guía de Pedido</h2>
            <div class="subtitle">Pedido #${escapeHtml(order.id)}</div>
          </div>

          <div class="section">
            <div class="section-title">Datos del Pedido</div>
            <div class="row"><div class="label">Fecha</div><div class="val">${escapeHtml(new Date(order.created_at).toLocaleString())}</div></div>
            <div class="row"><div class="label">Teléfono</div><div class="val">${escapeHtml(order.contacts?.phone || 'No registrado')}</div></div>
            <div class="row"><div class="label">Estado</div><div class="val">${escapeHtml(order.status || 'Sin estado')}</div></div>
          </div>

          <div class="section">
            <div class="section-title">Detalles del Pedido</div>
            ${fixedRows.length ? fixedRows.map((row) => `
              <div class="row"><div class="label">${escapeHtml(row.label)}</div><div class="val">${escapeHtml(row.value)}</div></div>
            `).join('') : '<div class="row"><div class="val">No hay datos estructurados.</div></div>'}
            ${extras.length ? extras.map((row) => `
              <div class="row"><div class="label">${escapeHtml(row.label)}</div><div class="val">${escapeHtml(row.value)}</div></div>
            `).join('') : ''}
          </div>

          ${itemRows.length ? `
            <div class="section">
              <div class="section-title">Artículos</div>
              <table class="item-table">
                <thead><tr><th>Producto</th><th>Cantidad</th><th>Precio</th></tr></thead>
                <tbody>
                  ${itemRows.map((item: any) => `
                    <tr>
                      <td>${escapeHtml(item.name || item.product || item.description || 'Artículo')}</td>
                      <td>${escapeHtml(item.quantity?.toString() || item.qty?.toString() || '-')}</td>
                      <td>${escapeHtml(item.price?.toString() || item.unit_price?.toString() || '-')}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : ''}

          <div class="footer">Generado por Sistema CRM IA</div>
          <script>window.onload=function(){window.print();window.close();}</script>
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
            <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                  <div>
                    <CardTitle>Pedidos Registrados</CardTitle>
                    <CardDescription>
                      Datos recopilados por la IA o agentes humanos.
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-3 rounded-md border border-muted/50 bg-muted/5 p-3">
                    {organizationOrderLogoUrl ? (
                      <img
                        src={organizationOrderLogoUrl}
                        alt="Logo de pedidos"
                        className="h-10 w-24 rounded object-contain"
                      />
                    ) : (
                      <div className="flex h-10 w-24 items-center justify-center rounded border border-dashed border-slate-300 text-xs text-slate-500">
                        Sin logo
                      </div>
                    )}
                    <div className="min-w-40 text-sm">
                      <div className="font-medium">Logo del módulo de pedidos</div>
                      <div className="text-xs text-muted-foreground">Se usa en las guías/tickets.</div>
                    </div>
                  </div>
                </div>
                <Button onClick={startLogoUpload} variant="outline" size="sm" disabled={uploadingLogo}>
                  <ImagePlus className="mr-2 h-4 w-4" />
                  {organizationOrderLogoUrl ? 'Actualizar logo' : 'Subir logo'}
                </Button>
              </div>
              <Button onClick={exportToCSV} variant="outline" size="sm">
                <Download className="mr-2 h-4 w-4" />
                Exportar CSV
              </Button>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-sm text-muted-foreground">Cargando...</div>
              ) : orders.length === 0 ? (
                <div className="text-sm text-muted-foreground">No hay pedidos registrados.</div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Teléfono</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Datos principales</TableHead>
                        <TableHead className="text-right">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orders.map((o) => {
                        const fd = typeof o.form_data === 'string' ? JSON.parse(o.form_data) : (o.form_data || {})
                        // Mostramos un par de valores clave para no saturar la tabla
                        const summary = Object.entries(fd).slice(0, 2).map(([k,v]) => `${k}: ${v}`).join(', ')
                        
                        return (
                          <TableRow key={o.id}>
                            <TableCell className="font-medium">{new Date(o.created_at).toLocaleDateString()}</TableCell>
                            <TableCell>{o.contacts?.phone || '-'}</TableCell>
                            <TableCell>{o.status}</TableCell>
                            <TableCell className="max-w-50 truncate">{summary || '-'}</TableCell>
                            <TableCell className="text-right space-x-1">
                              <Button variant="ghost" size="icon" onClick={() => printGuide(o)} title="Imprimir Guía / Ticket">
                                <Printer className="h-4 w-4 text-blue-600" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => deleteOrder(o.id)} title="Eliminar pedido">
                                <Trash2 className="h-4 w-4 text-red-500" />
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
              <form onSubmit={addField} className="flex gap-2">
                <Input 
                  placeholder="Nuevo campo (ej. Dirección de entrega)" 
                  value={newFieldName} 
                  onChange={(e) => setNewFieldName(e.target.value)} 
                  className="max-w-sm"
                />
                <Button type="submit">
                  <Plus className="mr-2 h-4 w-4" />
                  Agregar Campo
                </Button>
              </form>

              <div className="rounded-md border mt-6">
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
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleLogoFileSelected}
      />
    </div>
  )
}
