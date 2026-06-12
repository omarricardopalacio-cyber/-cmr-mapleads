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
        if (!String(configRes.error.message ?? '').includes('order_logo_url')) {
          toast.error('Error cargando logo de pedidos: ' + configRes.error.message)
        }
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
          .upsert({ org_id: orgId, order_logo_url: url }, { onConflict: 'org_id' })

      if (error) {
        const missingColumn = String(error.message ?? '').includes('order_logo_url')
        toast.error(
          missingColumn
            ? 'Error guardando logo del módulo de pedidos: la columna order_logo_url no existe en la base de datos. Ejecuta la migración.'
            : 'Error guardando logo del módulo de pedidos: ' + error.message,
        )
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
    let fd: Record<string, unknown> = {}
    try {
      fd = typeof order.form_data === 'string'
        ? JSON.parse(order.form_data || '{}')
        : order.form_data || {}
    } catch {
      fd = {}
    }

    const orderLogoUrl = String(fd.logo_url || fd.logoUrl || fd.logo || '')
    const logoUrl = organizationOrderLogoUrl || orderLogoUrl || ''
    const orderFieldsList = Array.isArray(fields) ? fields.map((field) => String(field.name)) : []

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

    const FIELD_ALIASES: Record<string, string[]> = {
      Nombre: ['nombre', 'nombre completo', 'cliente', 'nombre del cliente', 'name'],
      'Teléfono': ['telefono', 'teléfono', 'celular', 'movil', 'móvil', 'whatsapp'],
      Ciudad: ['ciudad', 'municipio', 'localidad'],
      Barrio: ['barrio', 'sector'],
      'Dirección': ['direccion', 'dirección', 'domicilio', 'dir'],
      Producto: ['producto', 'productos', 'articulo', 'artículo', 'pedido', 'referencia'],
      Valor: ['valor', 'precio', 'total', 'monto', 'costo'],
      Cantidad: ['cantidad', 'unidades', 'qty'],
    }

    const normalize = (value: string) =>
      value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9 ]/g, '')
        .trim()

    const extractFromText = (text: string): Record<string, string> => {
      const found: Record<string, string> = {}
      if (!text) return found

      const lines = text.split(/\r?\n|•|·|\*|-/)
      const productLines: string[] = []

      for (const raw of lines) {
        const cleaned = raw
          .replace(/^[\s*·•\-]+/, '')
          .replace(/\*\*/g, '')
          .replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*/u, '')
          .trim()

        const match = cleaned.match(/^([A-Za-zÁÉÍÓÚÑáéíóúñ0-9 ]{2,60})\s*[:\-]\s*(.+)$/)
        if (!match) continue

        const key = normalize(match[1])
        const value = match[2].trim().replace(/^[\*\s]+|[\*\s]+$/g, '')
        if (!value) continue

        for (const [canonical, aliases] of Object.entries(FIELD_ALIASES)) {
          if (aliases.some((alias) => normalize(alias) === key || key.startsWith(normalize(alias)))) {
            if (canonical === 'Producto') {
              productLines.push(value)
            } else if (!found[canonical]) {
              found[canonical] = value
            }
            break
          }
        }
      }

      if (productLines.length && !found.Producto) {
        found.Producto = productLines.join(', ')
      }

      return found
    }

    const directLookup = (label: string): string | null => {
      const normalizedLabel = normalize(label)
      const aliases = FIELD_ALIASES[label]?.map(normalize) ?? [normalizedLabel]

      for (const [key, value] of Object.entries(fd)) {
        if (value === null || value === undefined || value === '') continue
        if (typeof value === 'object') continue
        const normalizedKey = normalize(String(key))
        if (aliases.includes(normalizedKey) || normalizedKey === normalizedLabel) {
          return String(value)
        }
      }

      return null
    }

    const textBlob = Object.values(fd)
      .filter((value) => typeof value === 'string')
      .join('\n')

    const parsed = extractFromText(textBlob)
    const itemRows = Array.isArray(fd.items) ? fd.items : []
    if (itemRows.length && !parsed.Producto) {
      parsed.Producto = itemRows
        .map((item: any) => `${item.name || item.product || item.description || 'Artículo'}${item.quantity ? ` x${item.quantity}` : ''}`)
        .join(', ')
    }

    const fixedRows = ['Nombre', 'Teléfono', 'Ciudad', 'Barrio', 'Dirección', 'Producto', 'Valor', 'Cantidad'].map((label) => {
      const value = directLookup(label) || parsed[label] || '-'
      return { label, value }
    })

    const excludedKeys = new Set([
      'logo_url',
      'logoUrl',
      'logo',
      '_source_message_id',
      'Origen',
      'Historial reciente',
      'Confirmación cliente',
      'Respuesta de confirmación enviada',
      'Registrado en',
      'Resumen mostrado al cliente',
      'items',
    ])

    const fixedLabels = new Set(['Nombre', 'Teléfono', 'Ciudad', 'Barrio', 'Dirección', 'Producto', 'Valor', 'Cantidad'])
    const fixedAliasKeys = new Set(
      Object.entries(FIELD_ALIASES).flatMap(([, aliases]) => aliases.map(normalize)),
    )

    const extras = Object.entries(fd)
      .filter(([key]) => !excludedKeys.has(key) && !orderFieldsList.includes(key) && !fixedLabels.has(key) && !fixedAliasKeys.has(normalize(key)))
      .map(([key, value]) => ({ label: key, value: formatValue(value) }))

    const printWindow = window.open('', '_blank')
    if (!printWindow) return toast.error('Bloqueador de ventanas emergentes activado')

    const html = `
      <html>
        <head>
          <title>Guía de Pedido</title>
          <style>
            @page {
              size: 80mm auto;
              margin: 0;
            }
            body {
              font-family: 'Courier New', Courier, monospace, system-ui, sans-serif;
              width: 72mm;
              max-width: 72mm;
              margin: 0 auto;
              padding: 10px 5px;
              font-size: 11px;
              line-height: 1.3;
              color: #000;
              background-color: #fff;
            }
            .header { text-align: center; margin-bottom: 10px; border-bottom: 1px dashed #000; padding-bottom: 8px; }
            .logo { max-height: 50px; max-width: 100%; object-fit: contain; margin-bottom: 6px; filter: grayscale(100%); }
            h2 { margin: 0; font-size: 1.1rem; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; }
            .subtitle { font-size: 0.75rem; margin-top: 3px; }
            .section { margin-bottom: 10px; padding-bottom: 5px; border-bottom: 1px dashed #000; }
            .section-title { font-size: 0.8rem; font-weight: bold; text-transform: uppercase; margin-bottom: 6px; }
            .row { display: flex; justify-content: space-between; margin-bottom: 4px; align-items: flex-start; }
            .label { font-weight: bold; padding-right: 5px; }
            .val { text-align: right; word-break: break-word; max-width: 65%; white-space: pre-wrap; }
            .item-table { width: 100%; border-collapse: collapse; margin-top: 5px; font-size: 11px; }
            .item-table th, .item-table td { padding: 3px 0; text-align: left; border-bottom: 1px dashed #ccc; }
            .item-table th { font-weight: bold; text-transform: uppercase; border-bottom: 1px dashed #000; }
            .item-table td.num, .item-table th.num { text-align: right; }
            .footer { margin-top: 15px; text-align: center; font-size: 0.75rem; border-top: 1px dashed #000; padding-top: 8px; }
            @media print {
              @page { margin: 0; }
              body { margin: 0 auto; padding: 10px 5px; width: 72mm; }
              .no-print { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            ${logoUrl ? `<img class="logo" src="${escapeHtml(logoUrl)}" alt="Logo" />` : ''}
            <h2>Guía de Pedido</h2>
            <div class="subtitle">Pedido #${escapeHtml(String(order.id))}</div>
          </div>

          <div class="section">
            <div class="section-title">Datos del Pedido</div>
            <div class="row"><div class="label">Fecha</div><div class="val">${escapeHtml(new Date(order.created_at).toLocaleString())}</div></div>
            <div class="row"><div class="label">Teléfono</div><div class="val">${escapeHtml(String(order.contacts?.phone || 'No registrado'))}</div></div>
            <div class="row"><div class="label">Estado</div><div class="val">${escapeHtml(String(order.status || 'Sin estado'))}</div></div>
          </div>

          <div class="section">
            <div class="section-title">Detalles del Pedido</div>
            ${fixedRows.length ? fixedRows.map((row) => `
              <div class="row"><div class="label">${escapeHtml(String(row.label))}</div><div class="val">${escapeHtml(String(row.value))}</div></div>
            `).join('') : '<div class="row"><div class="val">No hay datos estructurados.</div></div>'}
            ${extras.length ? extras.map((row) => `
              <div class="row"><div class="label">${escapeHtml(String(row.label))}</div><div class="val">${escapeHtml(String(row.value))}</div></div>
            `).join('') : ''}
          </div>

          ${itemRows.length ? `
            <div class="section">
              <div class="section-title">Artículos</div>
              <table class="item-table">
                <thead><tr><th>Producto</th><th class="num">Cant</th><th class="num">Precio</th></tr></thead>
                <tbody>
                  ${itemRows.map((item: any) => `
                    <tr>
                      <td>${escapeHtml(String(item.name || item.product || item.description || 'Artículo'))}</td>
                      <td class="num">${escapeHtml(String(item.quantity ?? item.qty ?? '-'))}</td>
                      <td class="num">${escapeHtml(String(item.price ?? item.unit_price ?? '-'))}</td>
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

