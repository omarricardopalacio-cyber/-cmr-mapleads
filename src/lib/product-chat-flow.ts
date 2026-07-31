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

/** Paso de ficha: campo del producto o bloque custom (`custom:<id>`). */
export type FlowOrderItem = FlowFieldId | `custom:${string}`;

export type CustomFlowBlock = {
  id: string;
  type: "text" | "image";
  /** Texto del mensaje (type=text) o pie de foto (type=image) */
  text?: string;
  /** URL de imagen (type=image) */
  url?: string;
  enabled?: boolean;
};

export const FLOW_FIELD_LABELS: Record<FlowFieldId, string> = {
  name: "Nombre",
  badge: "Etiqueta (badge)",
  category: "Categoría",
  price: "Precio",
  sku: "SKU",
  stock: "Stock",
  image: "Imagen principal",
  video: "Video",
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

const MAX_DELAY_SEC = 600;

export function isCustomOrderItem(id: string): id is `custom:${string}` {
  return id.startsWith("custom:") && id.length > "custom:".length;
}

export function customIdFromOrderItem(id: `custom:${string}`): string {
  return id.slice("custom:".length);
}

export function toCustomOrderItem(blockId: string): `custom:${string}` {
  return `custom:${blockId}`;
}

/** Segundos de espera después de un campo (0–600). */
export function clampFlowDelaySec(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(MAX_DELAY_SEC, Math.round(n));
}

export function getFlowFieldDelay(
  delays: Record<string, unknown> | null | undefined,
  id: string,
): number {
  if (!delays || typeof delays !== "object") return 0;
  return clampFlowDelaySec(delays[id]);
}

export function normalizeFlowFieldDelays(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (obj[key] != null) out[key] = clampFlowDelaySec(obj[key]);
  }
  return out;
}

export function normalizeCustomBlocks(raw: unknown): CustomFlowBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomFlowBlock[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = String(o.id || "").trim().slice(0, 40);
    if (!id || seen.has(id)) continue;
    const type = o.type === "image" ? "image" : "text";
    seen.add(id);
    out.push({
      id,
      type,
      text: typeof o.text === "string" ? o.text.slice(0, 4000) : "",
      url: typeof o.url === "string" ? o.url.trim().slice(0, 2000) : "",
      enabled: o.enabled !== false,
    });
  }
  return out.slice(0, 20);
}

export function normalizeFlowFieldOrder(
  raw: unknown,
  customBlocks?: CustomFlowBlock[],
): FlowOrderItem[] {
  const allowedFields = new Set<string>(FLOW_FIELD_IDS);
  const customIds = new Set((customBlocks || []).map((b) => b.id));
  const seen = new Set<string>();
  const out: FlowOrderItem[] = [];

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item !== "string") continue;
      if (allowedFields.has(item)) {
        const id = item as FlowFieldId;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(id);
        continue;
      }
      if (isCustomOrderItem(item)) {
        const cid = customIdFromOrderItem(item);
        if (!customIds.has(cid) || seen.has(item)) continue;
        seen.add(item);
        out.push(item);
      }
    }
  }

  for (const id of DEFAULT_FLOW_FIELD_ORDER) {
    if (!seen.has(id)) out.push(id);
  }
  for (const b of customBlocks || []) {
    const key = toCustomOrderItem(b.id);
    if (!seen.has(key)) out.push(key);
  }

  // Nombre siempre primero
  const withoutName = out.filter((id) => id !== "name");
  return ["name", ...withoutName];
}

export function isFlowFieldEnabled(
  flow: Record<string, unknown> | null | undefined,
  id: FlowOrderItem,
): boolean {
  if (isCustomOrderItem(id)) {
    const blocks = normalizeCustomBlocks(flow?.custom_blocks);
    const block = blocks.find((b) => b.id === customIdFromOrderItem(id));
    return block ? block.enabled !== false : false;
  }
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

export function labelForFlowOrderItem(
  id: FlowOrderItem,
  customBlocks?: CustomFlowBlock[],
): string {
  if (isCustomOrderItem(id)) {
    const block = (customBlocks || []).find((b) => b.id === customIdFromOrderItem(id));
    if (!block) return "Mensaje";
    if (block.type === "image") {
      return block.text?.trim() ? `Imagen: ${block.text.trim().slice(0, 28)}` : "Imagen (mensaje)";
    }
    const t = (block.text || "").trim();
    return t ? `Msg: ${t.slice(0, 36)}${t.length > 36 ? "…" : ""}` : "Mensaje de texto";
  }
  return FLOW_FIELD_LABELS[id];
}
