import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listContacts } from "@/lib/crm.functions";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/contacts")({
  component: ContactsPage,
});

function ContactsPage() {
  const fn = useServerFn(listContacts);
  const { data, isLoading } = useQuery({ queryKey: ["contacts"], queryFn: () => fn({}) });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Contactos</h1>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>WhatsApp ID</TableHead>
              <TableHead>Teléfono</TableHead>
              <TableHead>Actualizado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Cargando...</TableCell></TableRow>
            )}
            {!isLoading && (data?.contacts.length ?? 0) === 0 && (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Sin contactos todavía. Conecta una sesión de WhatsApp.</TableCell></TableRow>
            )}
            {data?.contacts.map((c) => (
              <TableRow key={c.id}>
                <TableCell>{c.display_name || "—"}</TableCell>
                <TableCell className="font-mono text-xs">{c.wa_id}</TableCell>
                <TableCell>{c.phone || "—"}</TableCell>
                <TableCell>{new Date(c.updated_at).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
