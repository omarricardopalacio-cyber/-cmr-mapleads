const K = {
  campaigns: "mls_campaigns",
  queue: "mls_queue"
};

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const pauseBtn = document.getElementById("pauseBtn");
const resumeBtn = document.getElementById("resumeBtn");
const exportCsvBtn = document.getElementById("exportCsvBtn");
const exportXlsBtn = document.getElementById("exportXlsBtn");
const clearFormBtn = document.getElementById("clearFormBtn");
const leadCountEl = document.getElementById("leadCount");
const phoneCountEl = document.getElementById("phoneCount");
const runBadge = document.getElementById("runBadge");
const messageEl = document.getElementById("message");

const campaignName = document.getElementById("campaignName");
const categoriesInput = document.getElementById("categoriesInput");
const citiesInput = document.getElementById("citiesInput");
const zonesInput = document.getElementById("zonesInput");
const minRating = document.getElementById("minRating");
const minReviews = document.getElementById("minReviews");
const openStatus = document.getElementById("openStatus");
const hasWebsite = document.getElementById("hasWebsite");
const hasPhone = document.getElementById("hasPhone");
const delayMin = document.getElementById("delayMin");
const delayMax = document.getElementById("delayMax");
const slowMult = document.getElementById("slowMult");

const addQueueBtn = document.getElementById("addQueueBtn");
const clearQueueBtn = document.getElementById("clearQueueBtn");
const queueList = document.getElementById("queueList");
const saveCampaignBtn = document.getElementById("saveCampaignBtn");
const savedCampaignSelect = document.getElementById("savedCampaignSelect");
const loadCampaignBtn = document.getElementById("loadCampaignBtn");

let statusPoller = null;
let memoryQueue = [];

function setMessage(text, isError = false) {
  messageEl.textContent = text;
  messageEl.classList.toggle("err", isError);
}

async function getMapsTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const t = tabs[0];
  if (!t?.id || !t.url?.startsWith("https://www.google.com/maps")) {
    throw new Error("Abre una pestaña de Google Maps activa.");
  }
  return t;
}

async function sendToContent(type, payload = {}) {
  const tab = await getMapsTab();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage(tab.id, { type, payload });
    } catch (e) {
      const msg = String(e.message || "");
      const transient = msg.includes("Receiving end does not exist");
      if (!transient || attempt === 4) {
        throw new Error("No hay conexion temporal con Maps. Espera 2-3 segundos o recarga F5.");
      }
      // Durante navegaciones/reloads del content script, reintentar en caliente
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }
}

function parseCsvLine(input) {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseZones(input) {
  const map = {};
  const shared = [];
  for (const line of input.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const d = line.indexOf(":");
    if (d === -1) {
      shared.push(...parseCsvLine(line));
    } else {
      const city = line.slice(0, d).trim().toLowerCase();
      const zones = parseCsvLine(line.slice(d + 1));
      if (city && zones.length) {
        map[city] = zones;
      }
    }
  }
  return { map, sharedZones: shared };
}

function getFormPayload() {
  const z = parseZones(zonesInput.value);
  return {
    campaignName: campaignName.value.trim(),
    categories: parseCsvLine(categoriesInput.value),
    cities: parseCsvLine(citiesInput.value),
    zonesMap: z.map,
    sharedZones: z.sharedZones,
    filters: {
      minRating: Number(minRating.value) || 0,
      minReviews: Number(minReviews.value) || 0,
      openStatus: openStatus.value,
      hasWebsite: hasWebsite.value,
      hasPhone: hasPhone.value
    },
    delays: {
      betweenActionsMin: Number(delayMin.value) || 0,
      betweenActionsMax: Number(delayMax.value) || 0,
      slowdownMultiplier: Number(slowMult.value) || 1.1
    },
    searchQueue: memoryQueue.length ? [...memoryQueue] : undefined
  };
}

function renderQueue() {
  if (!memoryQueue.length) {
    queueList.textContent = "Cola vacía";
    return;
  }
  queueList.innerHTML = memoryQueue
    .map(
      (q, i) =>
        `<div class="queue-item">${i + 1}. cat: ${(q.categories || []).join(", ")} · ` +
        `ciud: ${(q.cities || []).join(", ")}</div>`
    )
    .join("");
}

function setUiRunning(running, paused = false) {
  startBtn.disabled = running;
  stopBtn.disabled = !running;
  pauseBtn.disabled = !running || paused;
  resumeBtn.disabled = !running || !paused;
  if (running && paused) {
    runBadge.textContent = "Pausado";
    runBadge.className = "badge badge-pause";
  } else if (running) {
    runBadge.textContent = "Extrayendo";
    runBadge.className = "badge badge-run";
  } else {
    runBadge.textContent = "Listo";
    runBadge.className = "badge badge-stop";
  }
}

function setCounts(count, withPhone) {
  leadCountEl.textContent = String(count);
  phoneCountEl.textContent = String(withPhone);
}

function escapeCsvCell(v) {
  const s = String(v ?? "").replace(/"/g, '""');
  return `"${s}"`;
}

function exportCsv(leads) {
  const headers = [
    "nombre",
    "telefono",
    "direccion",
    "ciudad",
    "zona",
    "categoria",
    "maps_categoria",
    "sitio_web",
    "rating",
    "reseñas",
    "estado_apertura",
    "tiene_fotos",
    "lead_score",
    "tipo_oportunidad",
    "oportunidades_tags",
    "campaña"
  ];
  const rows = leads.map((l) => [
    l.name,
    l.phone,
    l.address,
    l.city,
    l.zone,
    l.category,
    l.maps_category,
    l.website,
    l.rating,
    l.review_count,
    l.open_status,
    l.has_photos,
    l.lead_score,
    l.tipo_oportunidad,
    (l.oportunidades_tags || []).join("; "),
    l.campaign_name
  ]);
  return [headers, ...rows].map((r) => r.map(escapeCsvCell).join(",")).join("\n");
}

function exportExcelHtml(leads) {
  const headers = [
    "nombre",
    "telefono",
    "direccion",
    "ciudad",
    "zona",
    "categoria",
    "maps_categoria",
    "sitio_web",
    "rating",
    "reseñas",
    "estado_apertura",
    "tiene_fotos",
    "lead_score",
    "tipo_oportunidad",
    "oportunidades_tags",
    "campaña"
  ];
  const esc = (v) =>
    String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const rows = leads.map((l) => [
    l.name,
    l.phone,
    l.address,
    l.city,
    l.zone,
    l.category,
    l.maps_category,
    l.website,
    l.rating,
    l.review_count,
    l.open_status,
    l.has_photos,
    l.lead_score,
    l.tipo_oportunidad,
    (l.oportunidades_tags || []).join("; "),
    l.campaign_name
  ]);
  const th = headers.map((h) => `<th>${esc(h)}</th>`).join("");
  const tr = rows
    .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
    .join("");
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>
    table{border-collapse:collapse;font-family:Arial,sans-serif;font-size:11px}
    th,td{border:1px solid #ccc;padding:4px 6px}</style></head><body><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></body></html>`;
}

async function refreshStatus() {
  try {
    const r = await sendToContent("GET_STATUS");
    if (r) {
      setUiRunning(Boolean(r.running), Boolean(r.paused));
      setCounts(Number(r.count || 0), Number(r.withPhone || 0));
    }
  } catch (e) {
    setMessage(e.message, true);
  }
}

async function onStart() {
  try {
    const payload = getFormPayload();
    if (!payload.categories.length) {
      throw new Error("Indica al menos una categoría.");
    }
    if (!payload.cities.length) {
      throw new Error("Indica al menos una ciudad.");
    }
    setMessage("Iniciando…");
    const r = await sendToContent("START_EXTRACTION", payload);
    if (!r?.ok) {
      throw new Error(r?.error || "No se pudo iniciar.");
    }
    setUiRunning(true, false);
    setMessage(`Tareas: ${r.totalTasks || 0}`);
  } catch (e) {
    setMessage(e.message, true);
  }
}

async function onStop() {
  try {
    await sendToContent("STOP_EXTRACTION");
    setUiRunning(false);
    setMessage("Detenido.");
    await refreshStatus();
  } catch (e) {
    setMessage(e.message, true);
  }
}

async function onPause() {
  try {
    await sendToContent("PAUSE_EXTRACTION");
    setMessage("Pausa activa (reanudar cuando quieras).");
    await refreshStatus();
  } catch (e) {
    setMessage(e.message, true);
  }
}

async function onResume() {
  try {
    await sendToContent("RESUME_EXTRACTION");
    setMessage("Reanudado.");
    await refreshStatus();
  } catch (e) {
    setMessage(e.message, true);
  }
}

async function onExportCsv() {
  try {
    const r = await sendToContent("GET_LEADS");
    const leads = r?.leads || [];
    if (!leads.length) {
      setMessage("No hay leads para exportar.");
      return;
    }
    const blob = new Blob([exportCsv(leads)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    await chrome.downloads.download({
      url,
      filename: `leads_${Date.now()}.csv`,
      saveAs: true
    });
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    setMessage(`CSV: ${leads.length} filas.`);
  } catch (e) {
    setMessage(e.message, true);
  }
}

async function onExportXls() {
  try {
    const r = await sendToContent("GET_LEADS");
    const leads = r?.leads || [];
    if (!leads.length) {
      setMessage("No hay leads para exportar.");
      return;
    }
    const blob = new Blob([exportExcelHtml(leads)], { type: "application/vnd.ms-excel;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    await chrome.downloads.download({
      url,
      filename: `leads_${Date.now()}.xls`,
      saveAs: true
    });
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    setMessage(`Excel: ${leads.length} filas.`);
  } catch (e) {
    setMessage(e.message, true);
  }
}

function onClearForm() {
  campaignName.value = "";
  categoriesInput.value = "";
  citiesInput.value = "";
  zonesInput.value = "";
  minRating.value = "0";
  minReviews.value = "0";
  openStatus.value = "any";
  hasWebsite.value = "any";
  hasPhone.value = "any";
  memoryQueue = [];
  renderQueue();
  setMessage("Formulario vaciado.");
}

function onAddQueue() {
  const z = parseZones(zonesInput.value);
  memoryQueue.push({
    categories: parseCsvLine(categoriesInput.value),
    cities: parseCsvLine(citiesInput.value),
    zonesMap: z.map,
    sharedZones: z.sharedZones
  });
  renderQueue();
  setMessage(`Cola: ${memoryQueue.length} bloque(s).`);
}

function onClearQueue() {
  memoryQueue = [];
  renderQueue();
  setMessage("Cola vaciada.");
}

async function loadSettings() {
  const s = await chrome.storage.local.get([K.campaigns]);
  const camps = s[K.campaigns] || [];
  savedCampaignSelect.innerHTML = camps.length
    ? camps.map((c, i) => `<option value="${i}">${(c.name || "Sin nombre").replace(/</g, "")}</option>`).join("")
    : `<option value="">—</option>`;
}

async function onSaveCampaign() {
  const name = campaignName.value.trim() || `Campaña ${Date.now()}`;
  const data = getFormPayload();
  const s = await chrome.storage.local.get(K.campaigns);
  const list = s[K.campaigns] || [];
  list.push({ name, savedAt: Date.now(), snapshot: data });
  await chrome.storage.local.set({ [K.campaigns]: list });
  await loadSettings();
  setMessage("Campaña guardada.");
}

async function onLoadCampaign() {
  const idx = savedCampaignSelect.value;
  if (idx === "" || idx == null) {
    return;
  }
  const s = await chrome.storage.local.get(K.campaigns);
  const c = (s[K.campaigns] || [])[Number(idx)];
  if (!c?.snapshot) {
    return;
  }
  const d = c.snapshot;
  campaignName.value = d.campaignName || "";
  categoriesInput.value = (d.categories || []).join(", ");
  citiesInput.value = (d.cities || []).join(", ");
  minRating.value = String(d.filters?.minRating ?? 0);
  minReviews.value = String(d.filters?.minReviews ?? 0);
  openStatus.value = d.filters?.openStatus || "any";
  hasWebsite.value = d.filters?.hasWebsite || "any";
  hasPhone.value = d.filters?.hasPhone || "any";
  delayMin.value = String(d.delays?.betweenActionsMin ?? 200);
  delayMax.value = String(d.delays?.betweenActionsMax ?? 600);
  slowMult.value = String(d.delays?.slowdownMultiplier ?? 1.15);
  memoryQueue = Array.isArray(d.searchQueue) ? [...d.searchQueue] : [];
  renderQueue();
  setMessage("Campaña cargada.");
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "EXTRACTION_PROGRESS") {
    setUiRunning(Boolean(msg.running), Boolean(msg.paused));
    setCounts(Number(msg.count || 0), Number(msg.withPhone || 0));
    if (msg.currentQuery) {
      setMessage(`Buscando: ${msg.currentQuery}`);
    }
  }
  if (msg?.type === "EXTRACTION_ERROR") {
    setMessage(msg.message || "Error", true);
  }
});

startBtn.addEventListener("click", onStart);
stopBtn.addEventListener("click", onStop);
pauseBtn.addEventListener("click", onPause);
resumeBtn.addEventListener("click", onResume);
exportCsvBtn.addEventListener("click", onExportCsv);
exportXlsBtn.addEventListener("click", onExportXls);
clearFormBtn.addEventListener("click", onClearForm);
addQueueBtn.addEventListener("click", onAddQueue);
clearQueueBtn.addEventListener("click", onClearQueue);
saveCampaignBtn.addEventListener("click", onSaveCampaign);
loadCampaignBtn.addEventListener("click", onLoadCampaign);

setUiRunning(false);
setCounts(0, 0);
stopBtn.disabled = true;
pauseBtn.disabled = true;
resumeBtn.disabled = true;
loadSettings();
refreshStatus();
statusPoller = setInterval(refreshStatus, 1400);

// === Backend config UI ===
(async () => {
  const urlEl = document.getElementById('mlsBackendUrl');
  const tokEl = document.getElementById('mlsBackendToken');
  const btn = document.getElementById('mlsSaveBackend');
  const testBtn = document.getElementById('mlsTestBackend');
  const status = document.getElementById('mlsBackendStatus');
  const dot = document.getElementById('mlsConnDot');
  const txt = document.getElementById('mlsConnText');
  if (!urlEl || !tokEl || !btn) return;

  const setDot = (state, label) => {
    dot.className = 'conn-dot ' + state;
    txt.textContent = label;
  };

  async function ping() {
    const url = (urlEl.value || '').trim().replace(/\/$/, '');
    const token = (tokEl.value || '').trim();
    if (!url || !token) { setDot('idle', 'Sin configurar'); return; }
    setDot('idle', 'Verificando...');
    try {
      const r = await fetch(`${url}/api/public/mapleads/ingest`, {
        method: 'GET',
        headers: { 'X-Mapleads-Token': token },
      });
      if (r.redirected || (r.headers.get('content-type') || '').includes('text/html')) {
        setDot('err', 'URL inválida (Preview/Login)');
      } else if (r.ok) {
        setDot('ok', 'Conectado ✓');
      } else if (r.status === 401) {
        setDot('err', 'Token inválido');
      } else {
        let msg = `Error HTTP ${r.status}`;
        try { const d = await r.json(); if (d.error) msg += `: ${d.error}`; } catch(e){}
        setDot('err', msg);
      }
    } catch (e) {
      setDot('err', 'Sin conexión: ' + (e?.message || e));
    }
  }

  const s = await chrome.storage.local.get(['mls_backend_url','mls_backend_token']);
  urlEl.value = s.mls_backend_url || '';
  tokEl.value = s.mls_backend_token || '';
  ping();
  setInterval(ping, 30000);

  btn.addEventListener('click', async () => {
    await chrome.storage.local.set({
      mls_backend_url: urlEl.value.trim().replace(/\/$/,''),
      mls_backend_token: tokEl.value.trim()
    });
    status.textContent = 'Guardado ✓';
    setTimeout(()=>status.textContent='', 2500);
    ping();
  });
  testBtn?.addEventListener('click', ping);
})();
