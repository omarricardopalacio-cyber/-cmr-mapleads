import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Printer, Download, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

export const Route = createFileRoute('/_authenticated/orders')({
  component: OrdersModule,
})

function OrdersModule() {
  const { session } = useAuth()
  const orgId = session?.user?.user_metadata?.org_id
  
  const [orders, setOrders] = useState<any[]>([])
  const [fields, setFields] = useState<any[]>([])
  const [newFieldName, setNewFieldName] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (orgId) {
      loadData()
    }
  }, [orgId])

  async function loadData() {
    setLoading(true)
    try {
      const [ordersRes, fieldsRes] = await Promise.all([
        supabase
          .from('orders')
          .select('*, contacts(phone, name, first_name)')
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
    if (!newFieldName.trim() || !orgId) return
    
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
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Pedidos Registrados</CardTitle>
                <CardDescription>
                  Datos recopilados por la IA o agentes humanos.
                </CardDescription>
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
                        const summary = Object.entries(fd).slice(0, 2).map(([k,v]) => \`\${k}: \${v}\`).join(', ')
                        
                        return (
                          <TableRow key={o.id}>
                            <TableCell className="font-medium">{new Date(o.created_at).toLocaleDateString()}</TableCell>
                            <TableCell>{o.contacts?.phone || '-'}</TableCell>
                            <TableCell>{o.status}</TableCell>
                            <TableCell className="max-w-[200px] truncate">{summary || '-'}</TableCell>
                            <TableCell className="text-right">
                              <Button variant="ghost" size="icon" onClick={() => printGuide(o)} title="Imprimir Guía / Ticket">
                                <Printer className="h-4 w-4 text-blue-600" />
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
    </div>
  )
}
