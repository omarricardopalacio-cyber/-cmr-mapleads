/** Orden y flags del flujo automático de ficha por producto. */

export const FLOW_FIELD_IDS = [
  "name",
  "badge",
  "category",
  "price",
  "sku",
  "stock",
  "image",
  "video",
  "description",
  "gallery",
] as const;

export type FlowFieldId = (typeof FLOW_FIELD_IDS)[number];

export const FLOW_FIELD_LABELS: Record<FlowFieldId, string> = {
  name: "Nombre",
  badge: "Etiqueta",
  category: "Categoría",
  price: "Precio",
  sku: "SKU",
  stock: "Stock",
  image: "URL imagen principal",
  video: "URL video",
  description: "Descripción",
  gallery: "Imágenes extra (galería)",
};

export const DEFAULT_FLOW_FIELD_ORDER: FlowFieldId[] = [...FLOW_FIELD_IDS];

const FLAG_BY_FIELD: Record<Exclude<FlowFieldId, "name">, string> = {
  badge: "send_badge",
  category: "send_category",
  price: "send_price",
  sku: "send_sku",
  stock: "send_stock",
  image: "send_image",
  video: "send_video",
  description: "send_description",
  gallery: "send_gallery",
};

/** Campos que por defecto van apagados (hay que activarlos). */
const OPT_IN_FIELDS = new Set<FlowFieldId>(["image", "video", "description", "gallery"]);

export function normalizeFlowFieldOrder(raw: unknown): FlowFieldId[] {
  const allowed = new Set<string>(FLOW_FIELD_IDS);
  const seen = new Set<FlowFieldId>();
  const out: FlowFieldId[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item !== "string" || !allowed.has(item)) continue;
      const id = item as FlowFieldId;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  for (const id of DEFAULT_FLOW_FIELD_ORDER) {
    if (!seen.has(id)) out.push(id);
  }
  // Nombre siempre primero
  const withoutName = out.filter((id) => id !== "name");
  return ["name", ...withoutName];
}

export function isFlowFieldEnabled(
  flow: Record<string, unknown> | null | undefined,
  id: FlowFieldId,
): boolean {
  if (id === "name") return true;
  const f = flow || {};
  const flag = FLAG_BY_FIELD[id];
  const val = f[flag];
  if (OPT_IN_FIELDS.has(id)) return val === true;
  return val !== false;
}

export function flowFieldFlagKey(id: Exclude<FlowFieldId, "name">): string {
  return FLAG_BY_FIELD[id];
}
