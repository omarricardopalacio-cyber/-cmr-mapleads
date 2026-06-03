import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import {
  listTransferRules,
  upsertTransferRule,
  deleteTransferRule,
} from "@/lib/automations.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Save, X, UserCheck, AlertTriangle, ShoppingCart, HeadphonesIcon, MessageSquare, Settings } from "lucide-react";

interface TransferRule {
  id: string;
  name: string;
  condition_type: string;
  condition_config: Record<string, unknown>;
  is_active: boolean;
}

export const Route = createFileRoute("/_authenticated/transfer-rules")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
  component: TransferRulesPage,
});

function TransferRulesPage() {
  const [editingRule, setEditingRule] = useState<TransferRule | null>(null);
  const qc = useQueryClient();
  const listFn = useServerFn(listTransferRules);
  const { data } = useQuery({ queryKey: ["transferRules"], queryFn: () => listFn({}) });
  const rules = (data as { items?: TransferRule[] })?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Reglas de Transferencia</h1>
        <Button onClick={() => setEditingRule({ id: "", name: "", condition_type: "request_human", condition_config: {}, is_active: true } as TransferRule)}>
          <Plus className="h-4 w-4 mr-1" /> Nueva regla
        </Button>
      </div>
      {editingRule && (
        <RuleEditor rule={editingRule} onClose={() => { setEditingRule(null); qc.invalidateQueries({ queryKey: ["transferRules"] }); }} />
      )}
      <div className="grid gap-3">
        {rules.map((r: TransferRule) => (
          <RuleCard key={r.id} rule={r} onEdit={() => setEditingRule(r)} />
        ))}
        {rules.length === 0 && (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            No hay reglas de transferencia. Crea una para definir cuándo transferir a un agente humano.
          </Card>
        )}
      </div>
    </div>
  );
}

function RuleCard({ rule, onEdit }: { rule: TransferRule; onEdit: () => void }) {
  const qc = useQueryClient();
  const deleteFn = useServerFn(deleteTransferRule);
  const icon = ruleIcons[rule.condition_type] ?? <UserCheck className="h-4 w-4" />;

  return (
    <Card className="p-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="p-2 rounded-md bg-muted">{icon}</div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate">{rule.name}</p>
            <Badge variant={rule.is_active ? "default" : "secondary"} className="text-[10px]">
              {rule.is_active ? "Activo" : "Inactivo"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground truncate">{ruleLabels[rule.condition_type] ?? rule.condition_type}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Settings className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            if (!confirm("Eliminar regla de transferencia?")) return;
            await deleteFn({ data: { id: rule.id } });
            qc.invalidateQueries({ queryKey: ["transferRules"] });
          }}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </Card>
  );
}

const ruleLabels: Record<string, string> = {
  request_human: "Solicita hablar con persona",
  ai_no_response: "IA no tiene respuesta",
  purchase_intent: "Intención de compra",
  complaint: "Reclamo",
  support_request: "Solicitud de soporte",
  custom: "Personalizado",
};

const ruleIcons: Record<string, React.ReactNode> = {
  request_human: <UserCheck className="h-4 w-4" />,
  ai_no_response: <AlertTriangle className="h-4 w-4" />,
  purchase_intent: <ShoppingCart className="h-4 w-4" />,
  complaint: <AlertTriangle className="h-4 w-4" />,
  support_request: <HeadphonesIcon className="h-4 w-4" />,
  custom: <Settings className="h-4 w-4" />,
};

function RuleEditor({ rule, onClose }: { rule: TransferRule; onClose: () => void }) {
  const qc = useQueryClient();
  const upsertFn = useServerFn(upsertTransferRule);

  const [name, setName] = useState(rule.name);
  const [conditionType, setConditionType] = useState(rule.condition_type);
  const [isActive, setIsActive] = useState(rule.is_active);

  const saveRule = async () => {
    const res = await upsertFn({
      data: {
        id: rule.id || undefined,
        name,
        condition_type: conditionType,
        is_active: isActive,
        condition_config: {},
      },
    });
    const saved = (res as any)?.item;
    if (saved) {
      toast.success("Regla guardada");
      onClose();
    }
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{rule.id ? "Editar regla" : "Nueva regla"}</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Nombre</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Transferir por reclamo" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Condición</Label>
          <Select value={conditionType} onValueChange={setConditionType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="request_human">Solicita hablar con persona</SelectItem>
              <SelectItem value="ai_no_response">IA no tiene respuesta</SelectItem>
              <SelectItem value="purchase_intent">Intención de compra</SelectItem>
              <SelectItem value="complaint">Reclamo</SelectItem>
              <SelectItem value="support_request">Solicitud de soporte</SelectItem>
              <SelectItem value="custom">Personalizado</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={isActive} onCheckedChange={setIsActive} />
        <Label className="text-xs">Activo</Label>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={saveRule}>
          <Save className="h-4 w-4 mr-1" /> Guardar
        </Button>
        <Button size="sm" variant="outline" onClick={onClose}>
          <X className="h-4 w-4 mr-1" /> Cancelar
        </Button>
      </div>
    </Card>
  );
}
