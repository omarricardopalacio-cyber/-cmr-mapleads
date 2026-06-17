// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ─── helpers ─────────────────────────────────────────────────────────────────

async function getUserOrg(userId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("org_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (error || !data) throw new Error("No organization found for user");
  return data.org_id;
}

/** Llama a la REST API del Supabase externo sin auth propia */
async function externalFetch(
  supabaseUrl: string,
  publishableKey: string,
  path: string,
  opts?: RequestInit
): Promise<Response> {
  const url = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/${path}`;
  return fetch(url, {
    ...opts,
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${publishableKey}`,
      "Content-Type": "application/json",
      ...(opts?.headers ?? {}),
    },
  });
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const IntegrationSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  supabase_url: z.string().url(),
  publishable_key: z.string().min(10),
  slug: z.string().min(1).max(120),
  tenants_table: z.string().min(1).max(80).default("tenants"),
  products_table: z.string().min(1).max(80).default("master_products"),
  is_active: z.boolean().default(true),
});

// ─── Functions ───────────────────────────────────────────────────────────────

/** Lista todas las integraciones de catálogo de la org */
export const listCatalogIntegrations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getUserOrg(context.userId);
    const { data, error } = await (supabaseAdmin as any)
      .from("catalog_integrations")
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { integrations: data ?? [] };
  });

/** Crea o actualiza una integración */
export const saveCatalogIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => IntegrationSchema.parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const payload: any = {
      org_id: orgId,
      name: data.name,
      supabase_url: data.supabase_url,
      publishable_key: data.publishable_key,
      slug: data.slug,
      tenants_table: data.tenants_table,
      products_table: data.products_table,
      is_active: data.is_active,
      updated_at: new Date().toISOString(),
    };
    if (data.id) payload.id = data.id;

    const { error } = await (supabaseAdmin as any)
      .from("catalog_integrations")
      .upsert(payload, { onConflict: "id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Elimina una integración (y sus productos synced) */
export const deleteCatalogIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);
    const { error } = await (supabaseAdmin as any)
      .from("catalog_integrations")
      .delete()
      .eq("id", data.id)
      .eq("org_id", orgId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * PROBAR conexión con el catálogo externo
 * Paso 1: resuelve slug → tenant_id
 * Paso 2: cuenta productos activos
 */
export const testCatalogIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);

    // Obtener config de la integración
    const { data: integ, error: ie } = await (supabaseAdmin as any)
      .from("catalog_integrations")
      .select("*")
      .eq("id", data.id)
      .eq("org_id", orgId)
      .maybeSingle();
    if (ie || !integ) throw new Error("Integración no encontrada");

    try {
      // ── Paso 1: resolver slug → tenant ──────────────────────────
      const tenantsPath = `${integ.tenants_table}?slug=eq.${encodeURIComponent(integ.slug)}&select=id,slug,name&limit=1`;
      const r1 = await externalFetch(integ.supabase_url, integ.publishable_key, tenantsPath);
      if (!r1.ok) {
        const body = await r1.text();
        throw { step: "tenants", error: `HTTP ${r1.status}`, hint: body.slice(0, 200) };
      }
      const tenants = await r1.json();
      if (!tenants?.length) {
        throw {
          step: "tenants",
          error: "Slug no encontrado",
          hint: `No hay ningún tenant con slug="${integ.slug}". Verifica el slug y las políticas RLS en la tabla ${integ.tenants_table}.`,
        };
      }
      const tenant = tenants[0];

      // ── Paso 2: contar productos activos ────────────────────────
      const productsPath = `${integ.products_table}?tenant_id=eq.${tenant.id}&is_active=eq.true&select=id`;
      const r2 = await externalFetch(integ.supabase_url, integ.publishable_key, productsPath, {
        headers: { Prefer: "count=exact" },
        method: "HEAD",
      });
      const countRange = r2.headers.get("content-range") ?? "";
      const productCount = parseInt(countRange.split("/")[1] ?? "0", 10) || 0;

      // Cachear tenant_id y marcar status ok
      await (supabaseAdmin as any)
        .from("catalog_integrations")
        .update({
          tenant_id: tenant.id,
          status: "ok",
          last_sync_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.id);

      return { ok: true, productCount, tenant };
    } catch (err: any) {
      const msg = typeof err === "object" ? (err.error ?? String(err)) : String(err);
      await (supabaseAdmin as any)
        .from("catalog_integrations")
        .update({ status: "error", last_sync_error: msg, updated_at: new Date().toISOString() })
        .eq("id", data.id);
      return {
        ok: false,
        step: err?.step ?? "unknown",
        error: msg,
        hint: err?.hint ?? "",
      };
    }
  });

/** Mapa alias para columnas del catálogo externo */
function normalizeNumber(value: any): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const normalized = value.replace(/\s+/g, "").replace(/,/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeBoolean(value: any): boolean {
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  return true;
}

function mapRow(row: any): Record<string, any> | null {
  const externalId = row.id ?? row.external_id;
  if (externalId == null || externalId === "") {
    return null;
  }

  return {
    external_id: String(externalId),
    name: String(row.name ?? row.title ?? externalId ?? ""),
    description: row.long_description ?? row.description ?? null,
    price: normalizeNumber(row.base_price ?? row.price),
    stock: normalizeNumber(row.warehouse_stock ?? row.stock),
    image_url: row.main_image_url ?? row.image_url ?? null,
    video_url: row.main_video_url ?? row.video_url ?? (Array.isArray(row.videos) && row.videos[0]?.url) ?? null,
    slug: row.slug ?? null,
    sku: row.sku ?? null,
    badge: row.badge ?? null,
    is_active: normalizeBoolean(row.is_active ?? true),
  };
}

/**
 * SINCRONIZAR productos del catálogo externo → public.products del CRM
 * Paginación de 200 en 200 para no saturar la API
 */
export const syncCatalogIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);

    const { data: integ, error: ie } = await (supabaseAdmin as any)
      .from("catalog_integrations")
      .select("*")
      .eq("id", data.id)
      .eq("org_id", orgId)
      .maybeSingle();
    if (ie || !integ) throw new Error("Integración no encontrada");
    if (!integ.tenant_id) {
      // Auto-resolve tenant si no está en caché
      const tenantsPath = `${integ.tenants_table}?slug=eq.${encodeURIComponent(integ.slug)}&select=id,slug,name&limit=1`;
      const r1 = await externalFetch(integ.supabase_url, integ.publishable_key, tenantsPath);
      if (!r1.ok) throw new Error(`Error HTTP al buscar tenant: ${r1.status}`);
      const tenants = await r1.json();
      if (!tenants?.length) throw new Error(`Slug de catálogo no encontrado: ${integ.slug}`);
      integ.tenant_id = tenants[0].id;
      // Actualizar en base de datos
      await (supabaseAdmin as any).from("catalog_integrations").update({ tenant_id: integ.tenant_id }).eq("id", data.id);
    }

    // Crear log de sincronización
    const { data: logRow } = await (supabaseAdmin as any)
      .from("catalog_sync_logs")
      .insert({ org_id: orgId, integration_id: data.id, status: "running" })
      .select("id")
      .single();
    const logId = logRow?.id;

    let synced = 0;
    let failed = 0;
    let page = 0;
    const PAGE_SIZE = 200;
    let hasMore = true;

    try {
      while (hasMore) {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        // PostgREST paginates via Range header, NOT offset/limit query params
        const path = `${integ.products_table}?tenant_id=eq.${integ.tenant_id}&is_active=eq.true&select=*`;
        const res = await externalFetch(integ.supabase_url, integ.publishable_key, path, {
          headers: {
            Range: `${from}-${to}`,
            "Range-Unit": "items",
          },
        });
        if (!res.ok && res.status !== 206) throw new Error(`Error al obtener página ${page}: HTTP ${res.status}`);
        const rows: any[] = await res.json();
        const status = res.status;

        if (!rows.length) {
          console.warn(`[SYNC] página ${page} vacía (HTTP ${status}), deteniendo paginación`);
          hasMore = false; break;
        }

        if (page === 0) {
          console.log(`[SYNC] primera fila de página 0:`, JSON.stringify({ ...rows[0], raw: '...' }).slice(0, 500));
          console.log(`[SYNC] external_id mapeado:`, mapRow(rows[0]).external_id);
        }

        const mappedRows = rows.map((r) => mapRow(r));
        const invalidRows = mappedRows
          .map((mapped, idx) => ({ mapped, raw: rows[idx] }))
          .filter((item) => item.mapped === null);
        const validRows = mappedRows.filter((mapped): mapped is Record<string, any> => mapped !== null);

        if (invalidRows.length > 0) {
          failed += invalidRows.length;
          console.warn(
            `[SYNC] página ${page}: ${invalidRows.length} filas inválidas filtradas (missing external_id)`,
            invalidRows.slice(0, 3).map((item) => item.raw),
          );
        }

        const upsertRows = validRows.map((mapped) => ({
          ...mapped,
          org_id: orgId,
          integration_id: data.id,
          updated_at: new Date().toISOString(),
        }));

        if (upsertRows.length === 0) {
          console.warn(`[SYNC] página ${page}: ninguna fila válida para upsert, saltando página`);
          hasMore = rows.length === PAGE_SIZE;
          page++;
          continue;
        }

        const { error: upsertErr, data: upsertData } = await (supabaseAdmin as any)
          .from("products")
          .upsert(upsertRows, { onConflict: "org_id,integration_id,external_id", ignoreDuplicates: false })
          .select("id, external_id");

        if (upsertErr) {
          failed += upsertRows.length;
          console.error(`[SYNC] upsert error (página ${page}):`, upsertErr.message, "sample external_id:", upsertRows[0]?.external_id);
        } else {
          synced += upsertData?.length ?? upsertRows.length;
          console.log(`[SYNC] página ${page}: ${upsertData?.length ?? upsertRows.length} productos insertados/actualizados`);
        }

        hasMore = rows.length === PAGE_SIZE;
        page++;
      }

      // Finalizar log y actualizar integración
      await Promise.all([
        (supabaseAdmin as any)
          .from("catalog_sync_logs")
          .update({
            status: "ok",
            finished_at: new Date().toISOString(),
            products_synced: synced,
            products_failed: failed,
          })
          .eq("id", logId),
        (supabaseAdmin as any)
          .from("catalog_integrations")
          .update({
            last_synced_at: new Date().toISOString(),
            last_sync_count: synced,
            last_sync_error: null,
            status: "ok",
            updated_at: new Date().toISOString(),
          })
          .eq("id", data.id),
      ]);

      return { ok: true, synced, failed };
    } catch (err: any) {
      const msg = (err as Error).message;
      await Promise.all([
        (supabaseAdmin as any)
          .from("catalog_sync_logs")
          .update({ status: "error", finished_at: new Date().toISOString(), error_message: msg })
          .eq("id", logId),
        (supabaseAdmin as any)
          .from("catalog_integrations")
          .update({ status: "error", last_sync_error: msg, updated_at: new Date().toISOString() })
          .eq("id", data.id),
      ]);
      throw new Error(msg);
    }
  });

/**
 * BUSCAR PRODUCTOS — usado por la IA para responder consultas de clientes
 * Busca en public.products del CRM (ya sincronizados)
 */
export const searchCatalogProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ q: z.string().min(1).max(200), limit: z.number().min(1).max(20).default(8) }).parse(d)
  )
  .handler(async ({ context, data }) => {
    const orgId = await getUserOrg(context.userId);

    // Búsqueda por ilike en nombre y descripción
    const { data: products, error } = await (supabaseAdmin as any)
      .from("products")
      .select("id, name, description, price, stock, image_url, video_url, slug, sku, badge")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .or(`name.ilike.%${data.q}%,description.ilike.%${data.q}%,sku.ilike.%${data.q}%`)
      .order("name", { ascending: true })
      .limit(data.limit);

    if (error) throw new Error(error.message);
    return { products: products ?? [] };
  });

/**
 * DIAGNÓSTICO — totales para el panel
 */
export const catalogDiagnostic = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getUserOrg(context.userId);
    const [integResult, productResult] = await Promise.all([
      (supabaseAdmin as any)
        .from("catalog_integrations")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId),
      (supabaseAdmin as any)
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("is_active", true),
    ]);
    return {
      totalIntegrations: integResult.count ?? 0,
      totalProducts: productResult.count ?? 0,
    };
  });
