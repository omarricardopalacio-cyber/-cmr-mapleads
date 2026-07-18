export const WAIT_UNITS = [
  { value: "seconds", label: "Segundos" },
  { value: "minutes", label: "Minutos" },
  { value: "hours", label: "Horas" },
  { value: "days", label: "Días" },
  { value: "weeks", label: "Semanas" },
  { value: "months", label: "Meses" },
];

export const TRIGGERS = [
  { id: "mapleads_new_prospect", label: "Nuevo prospecto de Mapleads", group: "mapleads", needsValue: false },
  { id: "mapleads_imported", label: "Importación de Mapleads", group: "mapleads", needsValue: false },
  { id: "new_contact", label: "Nuevo Contacto Registrado", group: "crm", needsValue: false },
  { id: "wa_new_message", label: "Mensaje de WhatsApp Recibido", group: "whatsapp", needsValue: false },
  { id: "wa_first_conversation", label: "Primera conversación iniciada", group: "whatsapp", needsValue: false },
  { id: "wa_customer_reply", label: "Cliente Respondió", group: "whatsapp", needsValue: false },
  { id: "tag_added", label: "Etiqueta Añadida", group: "crm", needsValue: true },
  { id: "tag_removed", label: "Etiqueta Removida", group: "crm", needsValue: true },
  { id: "pipeline_changed", label: "Cambio de Pipeline", group: "crm", needsValue: true },
  { id: "stage_changed", label: "Cambio de Etapa (Stage)", group: "crm", needsValue: true },
  { id: "ai_enabled", label: "IA Activada", group: "ai", needsValue: false },
  { id: "ai_disabled", label: "IA Desactivada", group: "ai", needsValue: false },
  { id: "purchase_made", label: "Compra Realizada", group: "sales", needsValue: false },
  { id: "quote_sent", label: "Cotización Enviada", group: "sales", needsValue: false },
  { id: "manual", label: "Ejecución Manual", group: "system", needsValue: false },
];

export const STEPS = [
  // Comunicación
  { id: "send_text", label: "Enviar Mensaje de Texto", category: "comunicacion", icon: "MessageSquare", isCondition: false, defaultConfig: { text: "" } },
  { id: "send_image", label: "Enviar Imagen", category: "comunicacion", icon: "Image", isCondition: false, defaultConfig: { media_url: "", caption: "" } },
  { id: "send_video", label: "Enviar Video", category: "comunicacion", icon: "Video", isCondition: false, defaultConfig: { media_url: "", caption: "" } },
  { id: "send_document", label: "Enviar Documento", category: "comunicacion", icon: "FileText", isCondition: false, defaultConfig: { media_url: "", mime_type: "", caption: "" } },
  { id: "send_catalog", label: "Enviar Catálogo", category: "comunicacion", icon: "ShoppingBag", isCondition: false, defaultConfig: { media_url: "", mime_type: "", caption: "" } },
  { id: "send_product", label: "Enviar Producto", category: "comunicacion", icon: "Package", isCondition: false, defaultConfig: { product_id: "" } },
  
  // Tiempo
  { id: "wait", label: "Esperar", category: "tiempo", icon: "Clock", isCondition: false, defaultConfig: { amount: 1, unit: "minutes" } },
  
  // IA
  { id: "ai_enable", label: "Activar IA", category: "ia", icon: "Bot", isCondition: false, defaultConfig: {} },
  { id: "ai_disable", label: "Desactivar IA", category: "ia", icon: "BotOff", isCondition: false, defaultConfig: {} },
  { id: "ai_transfer_human", label: "Transferir a Humano", category: "ia", icon: "UserCheck", isCondition: false, defaultConfig: { user_id: "" } },
  { id: "ai_change_profile", label: "Cambiar Perfil de IA", category: "ia", icon: "Settings", isCondition: false, defaultConfig: { profile_id: "" } },
  
  // CRM
  { id: "tag_add", label: "Añadir Etiqueta", category: "crm", icon: "Tag", isCondition: false, defaultConfig: { tag_id: "" } },
  { id: "tag_remove", label: "Quitar Etiqueta", category: "crm", icon: "Tag", isCondition: false, defaultConfig: { tag_id: "" } },
  { id: "pipeline_move", label: "Mover de Etapa", category: "crm", icon: "Trello", isCondition: false, defaultConfig: { stage_id: "" } },
  { id: "note_create", label: "Crear Nota", category: "crm", icon: "StickyNote", isCondition: false, defaultConfig: { text: "" } },
  { id: "assign_user", label: "Asignar a Usuario", category: "crm", icon: "UserPlus", isCondition: false, defaultConfig: { user_id: "" } },
  
  // Condicionales (Tienen branch yes/no)
  { id: "if_has_tag", label: "¿Tiene etiqueta?", category: "condicionales", icon: "GitBranch", isCondition: true, defaultConfig: { tag_id: "" } },
  { id: "if_not_has_tag", label: "¿No tiene etiqueta?", category: "condicionales", icon: "GitBranch", isCondition: true, defaultConfig: { tag_id: "" } },
  { id: "if_bought", label: "¿Realizó compra?", category: "condicionales", icon: "GitBranch", isCondition: true, defaultConfig: {} },
  { id: "if_replied", label: "¿Respondió al mensaje?", category: "condicionales", icon: "GitBranch", isCondition: true, defaultConfig: { wait_amount: 1, wait_unit: "days" } },
  
  // Navegación
  { id: "goto_flow", label: "Ir a otro Flujo", category: "navegacion", icon: "ArrowRight", isCondition: false, defaultConfig: { flow_id: "" } },
  { id: "end_flow", label: "Terminar Flujo", category: "navegacion", icon: "StopCircle", isCondition: false, defaultConfig: {} },
];

export function waitMs(amount: number, unit: string): number {
  const multipliers: Record<string, number> = {
    seconds: 1000,
    minutes: 60 * 1000,
    hours: 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
    weeks: 7 * 24 * 60 * 60 * 1000,
    months: 30 * 24 * 60 * 60 * 1000,
  };
  return amount * (multipliers[unit] || multipliers.minutes);
}
