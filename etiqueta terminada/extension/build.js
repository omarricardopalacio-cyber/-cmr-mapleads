import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopPilot = process.env.MAPLE_DESKTOP_PILOT === "1";
const outputDirectory = desktopPilot ? "dist-desktop" : "dist";
const buildDefine = {
  __MAPLE_DESKTOP_PILOT__: JSON.stringify(desktopPilot),
};

// latest en npm (= 4.4.3 hoy). El parche isBot + fallback getMessages cubre WA Web nuevo.
const WPP_CDN = "https://cdn.jsdelivr.net/npm/@wppconnect/wa-js@latest/dist/wppconnect-wa.js";
const WPP_LOCAL = resolve(__dirname, "public", "vendor", "wppconnect-wa.min.js");
const WPP_DIST = resolve(__dirname, "dist", "vendor", "wppconnect-wa.min.js");

async function ensureWppJs() {
  if (desktopPilot) {
    if (!fs.existsSync(WPP_LOCAL)) {
      throw new Error("Desktop pilot requires the existing local WA-JS vendor file.");
    }
    console.log("🧪 Desktop pilot: using existing local WA-JS without modifying shared assets.");
    return;
  }
  // Siempre intenta bajar la ÚLTIMA versión de WA-JS. WhatsApp Web cambia sus
  // módulos internos con frecuencia; si se reutiliza una copia vieja, el engine
  // deja de encontrar módulos (isAuthenticated, ChatStore, MsgStore...) y no
  // recibe mensajes. Si no hay internet, se usa la copia local existente.
  console.log("📥 Descargando WA-JS (última versión) desde CDN...");
  try {
    const res = await fetch(WPP_CDN);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    fs.mkdirSync(dirname(WPP_LOCAL), { recursive: true });
    fs.writeFileSync(WPP_LOCAL, text, "utf-8");
    console.log(`✅ WA-JS actualizado (${(text.length / 1024).toFixed(1)} KB)`);
  } catch (err) {
    if (fs.existsSync(WPP_LOCAL)) {
      console.warn("⚠️ No se pudo actualizar WA-JS; se usa la copia local existente:", err.message);
      return;
    }
    console.error("❌ No se pudo descargar WA-JS:", err.message);
    console.error("   La extensión necesita WA-JS para funcionar.");
    console.error("   Descárgalo manualmente de: " + WPP_CDN);
    console.error("   Y guárdalo en: public/vendor/wppconnect-wa.min.js");
    throw err;
  }
}

async function runBuilds() {
  await ensureWppJs();
  console.log("=====================================================");
  console.log("🚀 Starting Chrome Extension Build Pipeline...");
  console.log("=====================================================");

  // 1. Popup & Service Worker Build (ESM)
  console.log("\n📦 Building Popup and Service Worker...");
  await build({
    configFile: false,
    // Chrome extension pages cannot load absolute "/popup.js" URLs.
    base: "./",
    // Vite only replaces globals when `define` is top-level (not under build).
    define: buildDefine,
    plugins: [react()],
    build: {
      outDir: outputDirectory,
      emptyOutDir: true,
      rollupOptions: {
        input: {
          popup: resolve(__dirname, "popup/index.html"),
          "background/service-worker": resolve(__dirname, "background/service-worker.ts"),
        },
        output: {
          entryFileNames: "[name].js",
          chunkFileNames: "assets/[name]-[hash].js",
          assetFileNames: "assets/[name]-[hash].[ext]",
        }
      }
    }
  });

  // 2. Content Script Build (IIFE / Self-contained)
  console.log("\n📦 Building Content Script (Self-contained IIFE)...");
  await build({
    configFile: false,
    define: buildDefine,
    build: {
      outDir: outputDirectory,
      emptyOutDir: false,
      lib: {
        entry: resolve(__dirname, "content/index.ts"),
        name: "ContentScript",
        formats: ["iife"],
        fileName: () => "content/index.js"
      },
      rollupOptions: {
        output: {
          extend: true
        }
      }
    }
  });

  // 3. Injected Engine Build (IIFE / Self-contained)
  console.log("\n📦 Building Injected Engine (Self-contained IIFE)...");
  await build({
    configFile: false,
    define: buildDefine,
    build: {
      outDir: outputDirectory,
      emptyOutDir: false,
      lib: {
        entry: resolve(__dirname, "injected/whatsapp-engine.ts"),
        name: "WhatsappEngine",
        formats: ["iife"],
        fileName: () => "injected/whatsapp-engine.js"
      },
      rollupOptions: {
        output: {
          extend: true
        }
      }
    }
  });

  // Chrome extension pages break on absolute Vite asset URLs and crossorigin.
  const popupHtmlPath = resolve(__dirname, outputDirectory, "popup", "index.html");
  if (fs.existsSync(popupHtmlPath)) {
    const fixedHtml = fs
      .readFileSync(popupHtmlPath, "utf-8")
      .replace(/\s+crossorigin(?:="[^"]*")?/g, "")
      .replace(/(src|href)="\/([^"]+)"/g, '$1="../$2"');
    fs.writeFileSync(popupHtmlPath, fixedHtml, "utf-8");
    console.log("\n✅ popup/index.html normalized for Chrome extension loading");
  }

  // Copy manifest.json
  const manifestContent = JSON.parse(fs.readFileSync(resolve(__dirname, "manifest.json"), "utf-8"));
  
  // Clean up content_scripts type parameter (not standard in Chrome MV3)
  if (manifestContent.content_scripts && manifestContent.content_scripts[0]) {
    delete manifestContent.content_scripts[0].type;
  }

  // Add vendor to web_accessible_resources
  const war = manifestContent.web_accessible_resources?.[0];
  if (war && !war.resources.includes("vendor/*")) {
    war.resources.push("vendor/*");
  }

  if (desktopPilot) {
    manifestContent.name = "MAPLE WA Engine (Local)";
    manifestContent.description = "Local desktop pilot bridge for Maple SQLite on 127.0.0.1:4317";
    // Chrome only accepts 1-4 dot-separated integers (no suffixes like -local).
    manifestContent.version = "1.0.10";
  }

  fs.writeFileSync(
    resolve(__dirname, outputDirectory, "manifest.json"),
    JSON.stringify(manifestContent, null, 2),
    "utf-8"
  );
  console.log(`\n✅ Manifest copied and normalized to ${outputDirectory}/manifest.json`);

  // Copy vendor folder to dist
  if (fs.existsSync(dirname(WPP_LOCAL))) {
    fs.mkdirSync(resolve(__dirname, outputDirectory, "vendor"), { recursive: true });
    const vendorFiles = fs.readdirSync(dirname(WPP_LOCAL));
    for (const file of vendorFiles) {
      fs.copyFileSync(
        resolve(dirname(WPP_LOCAL), file),
        resolve(__dirname, outputDirectory, "vendor", file)
      );
    }
    console.log(`📁 Copied ${vendorFiles.length} vendor files to ${outputDirectory}/vendor/`);
  }
  console.log("=====================================================");
  console.log("🎉 All builds completed successfully!");
  console.log("=====================================================");
}

runBuilds().catch(err => {
  console.error("❌ Build failed:", err);
  process.exit(1);
});
