import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getStoreSettings, updateStoreSettings } from "@/lib/store.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Copy, ExternalLink, Tags } from "lucide-react";

export const Route = createFileRoute("/_authenticated/store")({
  component: StoreSettingsPage,
});

function LegalEditor({
  label,
  hint,
  value,
  onChange,
  onSave,
  saving,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold">{label}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </div>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={16}
        className="min-h-[280px] font-mono text-sm"
        placeholder="Escribe el contenido aquí (texto o markdown sencillo)…"
      />
      <Button onClick={onSave} disabled={saving}>
        Guardar {label}
      </Button>
    </div>
  );
}

function StoreSettingsPage() {
  const getFn = useServerFn(getStoreSettings);
  const updateFn = useServerFn(updateStoreSettings);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["storeSettings"],
    queryFn: () => getFn({}),
  });

  const [brand, setBrand] = useState("");
  const [color, setColor] = useState("#0056AD");
  const [accent, setAccent] = useState("#FF2D95");
  const [logo, setLogo] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [socialTitle, setSocialTitle] = useState("");
  const [socialDesc, setSocialDesc] = useState("");
  const [socialImage, setSocialImage] = useState("");

  const [pixelId, setPixelId] = useState("");
  const [capiToken, setCapiToken] = useState("");
  const [pixelEnabled, setPixelEnabled] = useState(false);
  const [hasCapi, setHasCapi] = useState(false);

  const [customDomain, setCustomDomain] = useState("");
  const [gaId, setGaId] = useState("");
  const [gscVerify, setGscVerify] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDesc, setSeoDesc] = useState("");

  const [pageFaq, setPageFaq] = useState("");
  const [pageTerms, setPageTerms] = useState("");
  const [pagePrivacy, setPagePrivacy] = useState("");
  const [pageShipping, setPageShipping] = useState("");

  useEffect(() => {
    if (!data) return;
    const d = data as any;
    setBrand(d.brand_name || "");
    setColor(d.primary_color || "#0056AD");
    setAccent(d.accent_color || "#FF2D95");
    setLogo(d.logo_url || "");
    setEnabled(d.enabled !== false);
    setSocialTitle(d.social_title || "");
    setSocialDesc(d.social_description || "");
    setSocialImage(d.social_image_url || "");
    setPixelId(d.meta_pixel_id || "");
    setCapiToken("");
    setPixelEnabled(d.meta_pixel_enabled === true);
    setHasCapi(Boolean(d._has_capi_token));
    setCustomDomain(d.custom_domain || "");
    setGaId(d.google_analytics_id || "");
    setGscVerify(d.google_site_verification || "");
    setSeoTitle(d.seo_title || "");
    setSeoDesc(d.seo_description || "");
    setPageFaq(d.page_faq || "");
    setPageTerms(d.page_terms || "");
    setPagePrivacy(d.page_privacy || "");
    setPageShipping(d.page_shipping || "");
  }, [data]);

  const mut = useMutation({
    mutationFn: (vars: Record<string, unknown>) => updateFn({ data: vars as any }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["storeSettings"] });
      if (res?._warning) toast.warning(res._warning);
      else toast.success("Guardado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !data) {
    return <div className="p-6 text-sm text-muted-foreground">Cargando tienda…</div>;
  }

  const storeUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/store/${data.store_token}`
      : `/store/${data.store_token}`;

  const pageBase = `${storeUrl}`;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tienda web</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Marca, dominio, Meta Pixel, Google y páginas legales de tu catálogo público.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border bg-card p-4">
        <Label>Link público</Label>
        <div className="flex gap-2">
          <Input readOnly value={storeUrl} className="font-mono text-xs" />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => {
              navigator.clipboard.writeText(storeUrl);
              toast.success("Copiado");
            }}
          >
            <Copy className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" size="icon" asChild>
            <a href={storeUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2">
          <Tags className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <div>
            <p className="text-sm font-medium">Observaciones IA por producto</p>
            <p className="text-xs text-muted-foreground">
              Prompt especial con el que la IA atiende cada producto.
            </p>
          </div>
        </div>
        <Button asChild variant="secondary" size="sm">
          <Link to="/catalog">Abrir</Link>
        </Button>
      </div>

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="mb-4 flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="domain">Dominio</TabsTrigger>
          <TabsTrigger value="pixel">Meta Pixel</TabsTrigger>
          <TabsTrigger value="google">Google / SEO</TabsTrigger>
          <TabsTrigger value="faq">FAQ</TabsTrigger>
          <TabsTrigger value="terms">Términos</TabsTrigger>
          <TabsTrigger value="privacy">Privacidad</TabsTrigger>
          <TabsTrigger value="shipping">Envíos</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <div className="space-y-4 rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold">Logo y marca</h2>
            <div className="space-y-2">
              <Label>Nombre de marca</Label>
              <Input value={brand} onChange={(e) => setBrand(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Logo (URL)</Label>
              <Input value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://…" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Color primario</Label>
                <div className="flex gap-2">
                  <Input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-14 p-1" />
                  <Input value={color} onChange={(e) => setColor(e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Color acento</Label>
                <div className="flex gap-2">
                  <Input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} className="w-14 p-1" />
                  <Input value={accent} onChange={(e) => setAccent(e.target.value)} />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label>Tienda activa</Label>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>
          </div>

          <div className="space-y-4 rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold">Open Graph (Facebook / WhatsApp)</h2>
            <p className="text-xs text-muted-foreground">
              Imagen recomendada 1200×630. Título y descripción al compartir el link.
            </p>
            <div className="space-y-2">
              <Label>Título social</Label>
              <Input value={socialTitle} onChange={(e) => setSocialTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Descripción social</Label>
              <Textarea value={socialDesc} onChange={(e) => setSocialDesc(e.target.value)} rows={3} />
            </div>
            <div className="space-y-2">
              <Label>Imagen social (URL)</Label>
              <Input
                value={socialImage}
                onChange={(e) => setSocialImage(e.target.value)}
                placeholder="https://… (1200×630)"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() =>
                mut.mutate({
                  brand_name: brand,
                  primary_color: color,
                  accent_color: accent,
                  logo_url: logo.trim() || null,
                  social_title: socialTitle.trim() || null,
                  social_description: socialDesc.trim() || null,
                  social_image_url: socialImage.trim() || null,
                  enabled,
                })
              }
              disabled={mut.isPending}
            >
              Guardar general
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (confirm("¿Rotar token? El link anterior dejará de funcionar.")) {
                  mut.mutate({ rotate_token: true });
                }
              }}
            >
              Rotar token
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="domain" className="space-y-4">
          <div className="space-y-4 rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold">Conectar dominio</h2>
            <p className="text-xs text-muted-foreground">
              Indica el dominio (ej. tienda.tudominio.com). En Netlify/DNS crea un CNAME hacia tu sitio
              actual, y añade el mismo dominio en el panel de hosting.
            </p>
            <div className="space-y-2">
              <Label>Dominio personalizado</Label>
              <Input
                value={customDomain}
                onChange={(e) => setCustomDomain(e.target.value)}
                placeholder="tienda.tudominio.com"
              />
            </div>
            <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
              <li>Guarda el dominio aquí.</li>
              <li>En tu DNS: CNAME → el host de Netlify / tu app.</li>
              <li>En Netlify: Domain management → Add domain alias.</li>
              <li>
                La tienda sigue en <code className="rounded bg-muted px-1">/store/…</code>; el dominio
                apunta a la misma app.
              </li>
            </ol>
            <Button
              onClick={() =>
                mut.mutate({
                  custom_domain: customDomain.trim() || null,
                })
              }
              disabled={mut.isPending}
            >
              Guardar dominio
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="pixel" className="space-y-4">
          <div className="space-y-4 rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold">Meta Pixel / Conversions API</h2>
            <p className="text-xs text-muted-foreground">
              Eventos: PageView (visita), Lead (entra al chat), ViewContent (producto), InitiateCheckout
              (cómo pedir / agendar), Purchase (compró — vía CAPI también en WhatsApp).
            </p>
            <div className="flex items-center justify-between">
              <Label>Pixel activo</Label>
              <Switch checked={pixelEnabled} onCheckedChange={setPixelEnabled} />
            </div>
            <div className="space-y-2">
              <Label>Pixel ID</Label>
              <Input
                value={pixelId}
                onChange={(e) => setPixelId(e.target.value)}
                placeholder="Ej. 123456789012345"
              />
            </div>
            <div className="space-y-2">
              <Label>Access token CAPI {hasCapi ? "(ya configurado — pega uno nuevo para reemplazar)" : ""}</Label>
              <Input
                type="password"
                value={capiToken}
                onChange={(e) => setCapiToken(e.target.value)}
                placeholder={hasCapi ? "••••••••" : "EAAB…"}
                autoComplete="off"
              />
            </div>
            <Button
              onClick={() => {
                const payload: Record<string, unknown> = {
                  meta_pixel_id: pixelId.trim() || null,
                  meta_pixel_enabled: pixelEnabled,
                };
                if (capiToken.trim()) payload.meta_capi_access_token = capiToken.trim();
                mut.mutate(payload);
              }}
              disabled={mut.isPending}
            >
              Guardar Meta Pixel
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="google" className="space-y-4">
          <div className="space-y-4 rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold">Google / SEO</h2>
            <div className="space-y-2">
              <Label>Google Analytics ID</Label>
              <Input value={gaId} onChange={(e) => setGaId(e.target.value)} placeholder="G-XXXXXXXX" />
            </div>
            <div className="space-y-2">
              <Label>Search Console — meta verification</Label>
              <Input
                value={gscVerify}
                onChange={(e) => setGscVerify(e.target.value)}
                placeholder="contenido del meta google-site-verification"
              />
            </div>
            <div className="space-y-2">
              <Label>SEO título</Label>
              <Input value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>SEO descripción</Label>
              <Textarea value={seoDesc} onChange={(e) => setSeoDesc(e.target.value)} rows={3} />
            </div>
            <Button
              onClick={() =>
                mut.mutate({
                  google_analytics_id: gaId.trim() || null,
                  google_site_verification: gscVerify.trim() || null,
                  seo_title: seoTitle.trim() || null,
                  seo_description: seoDesc.trim() || null,
                })
              }
              disabled={mut.isPending}
            >
              Guardar Google / SEO
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="faq">
          <LegalEditor
            label="Preguntas frecuentes (FAQ)"
            hint={`Público en ${pageBase}/legal/faq`}
            value={pageFaq}
            onChange={setPageFaq}
            onSave={() => mut.mutate({ page_faq: pageFaq.trim() || null })}
            saving={mut.isPending}
          />
        </TabsContent>
        <TabsContent value="terms">
          <LegalEditor
            label="Términos y Condiciones"
            hint={`Público en ${pageBase}/legal/terms`}
            value={pageTerms}
            onChange={setPageTerms}
            onSave={() => mut.mutate({ page_terms: pageTerms.trim() || null })}
            saving={mut.isPending}
          />
        </TabsContent>
        <TabsContent value="privacy">
          <LegalEditor
            label="Política de Privacidad"
            hint={`Público en ${pageBase}/legal/privacy`}
            value={pagePrivacy}
            onChange={setPagePrivacy}
            onSave={() => mut.mutate({ page_privacy: pagePrivacy.trim() || null })}
            saving={mut.isPending}
          />
        </TabsContent>
        <TabsContent value="shipping">
          <LegalEditor
            label="Envíos, Cambios y Garantías"
            hint={`Público en ${pageBase}/legal/shipping`}
            value={pageShipping}
            onChange={setPageShipping}
            onSave={() => mut.mutate({ page_shipping: pageShipping.trim() || null })}
            saving={mut.isPending}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
