import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const WPP_CDN = "https://cdn.jsdelivr.net/npm/@wppconnect/wa-js@latest/dist/wppconnect-wa.min.js";
const WPP_LOCAL = resolve(__dirname, "public", "vendor", "wppconnect-wa.min.js");
const WPP_DIST = resolve(__dirname, "dist", "vendor", "wppconnect-wa.min.js");

async function ensureWppJs() {
  if (fs.existsSync(WPP_LOCAL)) {
    console.log("✅ WA-JS ya descargado localmente");
    return;
  }
  console.log("📥 Descargando WA-JS desde CDN...");
  try {
    const res = await fetch(WPP_CDN);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    fs.mkdirSync(dirname(WPP_LOCAL), { recursive: true });
    fs.writeFileSync(WPP_LOCAL, text, "utf-8");
    console.log(`✅ WA-JS descargado (${(text.length / 1024).toFixed(1)} KB)`);
  } catch (err) {
    console.error("❌ No se pudo descargar WA-JS:", err.message);
    console.error("   La extensión necesita WA-JS para funcionar.");
    console.error("   Descárgalo manualmente de:");
    console.error("   " + WPP_CDN);
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
    plugins: [react()],
    build: {
      outDir: "dist",
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
    build: {
      outDir: "dist",
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
    build: {
      outDir: "dist",
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

  fs.writeFileSync(
    resolve(__dirname, "dist/manifest.json"),
    JSON.stringify(manifestContent, null, 2),
    "utf-8"
  );
  console.log("\n✅ Manifest copied and normalized to dist/manifest.json");

  // Copy vendor folder to dist
  if (fs.existsSync(dirname(WPP_LOCAL))) {
    fs.mkdirSync(resolve(__dirname, "dist", "vendor"), { recursive: true });
    const vendorFiles = fs.readdirSync(dirname(WPP_LOCAL));
    for (const file of vendorFiles) {
      fs.copyFileSync(
        resolve(dirname(WPP_LOCAL), file),
        resolve(__dirname, "dist", "vendor", file)
      );
    }
    console.log(`📁 Copied ${vendorFiles.length} vendor files to dist/vendor/`);
  }
  console.log("=====================================================");
  console.log("🎉 All builds completed successfully!");
  console.log("=====================================================");
}

runBuilds().catch(err => {
  console.error("❌ Build failed:", err);
  process.exit(1);
});
