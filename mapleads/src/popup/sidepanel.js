const els = {
  startBtn: document.getElementById("startBtn"),
  continueBtn: document.getElementById("continueBtn"),
  stopBtn: document.getElementById("stopBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  resumeBtn: document.getElementById("resumeBtn"),
  exportCsvBtn: document.getElementById("exportCsvBtn"),
  exportXlsBtn: document.getElementById("exportXlsBtn"),
  clearFormBtn: document.getElementById("clearFormBtn"),
  leadCountEl: document.getElementById("leadCount"),
  phoneCountEl: document.getElementById("phoneCount"),
  runBadge: document.getElementById("runBadge"),
  messageEl: document.getElementById("message"),
  campaignName: document.getElementById("campaignName"),
  categoriesInput: document.getElementById("categoriesInput"),
  citiesInput: document.getElementById("citiesInput"),
  zonesInput: document.getElementById("zonesInput"),
  minRating: document.getElementById("minRating"),
  minReviews: document.getElementById("minReviews"),
  openStatus: document.getElementById("openStatus"),
  hasWebsite: document.getElementById("hasWebsite"),
  hasPhone: document.getElementById("hasPhone"),
  delayMin: document.getElementById("delayMin"),
  delayMax: document.getElementById("delayMax"),
  slowMult: document.getElementById("slowMult"),
  addQueueBtn: document.getElementById("addQueueBtn"),
  clearQueueBtn: document.getElementById("clearQueueBtn"),
  queueList: document.getElementById("queueList"),
  saveCampaignBtn: document.getElementById("saveCampaignBtn"),
  savedCampaignSelect: document.getElementById("savedCampaignSelect"),
  loadCampaignBtn: document.getElementById("loadCampaignBtn"),
  taskProgressBar: document.getElementById("taskProgressBar"),
  taskProgressText: document.getElementById("taskProgressText"),
  searchRateText: document.getElementById("searchRateText")
};

let memoryQueue = [];
let statusPoller = null;

const setMessage = (txt, err = false) => globalThis.MLPopupUi.setMessage(els.messageEl, txt, err);

function parseZones(input) {
  const map = {};
  const shared = [];
  for (const line of String(input || "").split("\n").map((l) => l.trim()).filter(Boolean)) {
    const d = line.indexOf(":");
    if (d === -1) shared.push(...globalThis.MLTextUtils.parseCsvLine(line));
    else {
      const city = line.slice(0, d).trim().toLowerCase();
      const zones = globalThis.MLTextUtils.parseCsvLine(line.slice(d + 1));
      if (city && zones.length) map[city] = zones;
    }
  }
  return { map, sharedZones: shared };
}

function getFormPayload() {
  const z = parseZones(els.zonesInput.value);
  return {
    campaignName: els.campaignName.value.trim(),
    categories: globalThis.MLTextUtils.parseCsvLine(els.categoriesInput.value),
    cities: globalThis.MLTextUtils.parseCsvLine(els.citiesInput.value),
    zonesMap: z.map,
    sharedZones: z.sharedZones,
    filters: {
      minRating: Number(els.minRating.value) || 0,
      minReviews: Number(els.minReviews.value) || 0,
      openStatus: els.openStatus.value,
      hasWebsite: els.hasWebsite.value,
      hasPhone: els.hasPhone.value
    },
    delays: {
      betweenActionsMin: Number(els.delayMin.value) || 0,
      betweenActionsMax: Number(els.delayMax.value) || 0,
      slowdownMultiplier: Number(els.slowMult.value) || 1.1
    },
    searchQueue: memoryQueue.length ? [...memoryQueue] : undefined
  };
}

function renderQueue() {
  if (!memoryQueue.length) {
    els.queueList.textContent = "Cola vacía";
    return;
  }
  els.queueList.innerHTML = memoryQueue
    .map((q, i) => `<div class="queue-item">${i + 1}. cat: ${(q.categories || []).join(", ")} · ciud: ${(q.cities || []).join(", ")}</div>`)
    .join("");
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
      const transient = String(e.message || "").includes("Receiving end does not exist");
      if (!transient || attempt === 4) throw new Error("No hay conexion temporal con Maps. Espera o recarga F5.");
      await new Promise((r) => setTimeout(r, 600));
    }
  }
}

async function refreshStatus() {
  try {
    const r = await sendToContent("GET_STATUS");
    globalThis.MLPopupUi.setUiRunning(els, Boolean(r?.running), Boolean(r?.paused));
    globalThis.MLPopupUi.setCounts(els, Number(r?.count || 0), Number(r?.withPhone || 0));
    globalThis.MLPopupUi.setProgress(
      els,
      Number(r?.progressPercent || 0),
      Number(r?.tasksCompleted || 0),
      Number(r?.tasksTotal || 0),
      Number(r?.searchesPerMin || 0)
    );
    if (els.continueBtn) {
      els.continueBtn.disabled = Boolean(r?.running) || !Boolean(r?.canContinue);
    }
  } catch (e) {
    setMessage(e.message, true);
  }
}

async function onStart() {
  try {
    const payload = getFormPayload();
    if (!payload.categories.length) throw new Error("Indica al menos una categoría.");
    if (!payload.cities.length) throw new Error("Indica al menos una ciudad.");
    setMessage("Iniciando…");
    const r = await sendToContent("START_EXTRACTION", payload);
    if (!r?.ok) throw new Error(r?.error || "No se pudo iniciar.");
    globalThis.MLPopupUi.setUiRunning(els, true, false);
    setMessage(`Tareas: ${r.totalTasks || 0}`);
  } catch (e) {
    setMessage(e.message, true);
  }
}

async function onStop() {
  await sendToContent("STOP_EXTRACTION");
  globalThis.MLPopupUi.setUiRunning(els, false, false);
  setMessage("Detenido. Puedes exportar y luego continuar desde avance.");
}

async function onContinue() {
  const r = await sendToContent("CONTINUE_EXTRACTION");
  if (!r?.ok) throw new Error(r?.error || "No se pudo continuar.");
  globalThis.MLPopupUi.setUiRunning(els, true, false);
  setMessage("Continuando desde el último avance…");
}

async function onPause() {
  await sendToContent("PAUSE_EXTRACTION");
  setMessage("Pausa activa.");
  await refreshStatus();
}

async function onResume() {
  await sendToContent("RESUME_EXTRACTION");
  setMessage("Reanudado.");
  await refreshStatus();
}

async function downloadByType(type) {
  const r = await sendToContent("GET_LEADS");
  const leads = r?.leads || [];
  if (!leads.length) {
    setMessage("No hay leads para exportar.");
    return;
  }
  const content =
    type === "csv" ? globalThis.MLPopupExports.exportCsv(leads) : globalThis.MLPopupExports.exportExcelHtml(leads);
  const mime = type === "csv" ? "text/csv;charset=utf-8;" : "application/vnd.ms-excel;charset=utf-8;";
  const ext = type === "csv" ? "csv" : "xls";
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({ url, filename: `leads_${Date.now()}.${ext}`, saveAs: true });
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  setMessage(`${type.toUpperCase()}: ${leads.length} filas.`);
}

function clearForm() {
  els.campaignName.value = "";
  els.categoriesInput.value = "";
  els.citiesInput.value = "";
  els.zonesInput.value = "";
  els.minRating.value = "0";
  els.minReviews.value = "0";
  els.openStatus.value = "any";
  els.hasWebsite.value = "any";
  els.hasPhone.value = "any";
  memoryQueue = [];
  renderQueue();
  setMessage("Formulario vaciado.");
}

async function saveCampaign() {
  const name = els.campaignName.value.trim() || `Campaña ${Date.now()}`;
  await globalThis.MLPopupCampaigns.saveCampaignSnapshot(name, getFormPayload());
  await globalThis.MLPopupCampaigns.loadCampaignOptions(els.savedCampaignSelect);
  setMessage("Campaña guardada.");
}

async function loadCampaign() {
  const idx = els.savedCampaignSelect.value;
  if (idx === "" || idx == null) return;
  const c = await globalThis.MLPopupCampaigns.getCampaignByIndex(idx);
  if (!c?.snapshot) return;
  const d = c.snapshot;
  els.campaignName.value = d.campaignName || "";
  els.categoriesInput.value = (d.categories || []).join(", ");
  els.citiesInput.value = (d.cities || []).join(", ");
  els.minRating.value = String(d.filters?.minRating ?? 0);
  els.minReviews.value = String(d.filters?.minReviews ?? 0);
  els.openStatus.value = d.filters?.openStatus || "any";
  els.hasWebsite.value = d.filters?.hasWebsite || "any";
  els.hasPhone.value = d.filters?.hasPhone || "any";
  els.delayMin.value = String(d.delays?.betweenActionsMin ?? 200);
  els.delayMax.value = String(d.delays?.betweenActionsMax ?? 600);
  els.slowMult.value = String(d.delays?.slowdownMultiplier ?? 1.15);
  memoryQueue = Array.isArray(d.searchQueue) ? [...d.searchQueue] : [];
  renderQueue();
  setMessage("Campaña cargada.");
}

function boot() {
  globalThis.MLPopupUi.setUiRunning(els, false, false);
  globalThis.MLPopupUi.setCounts(els, 0, 0);
  globalThis.MLPopupUi.setProgress(els, 0, 0, 0, 0);
  els.stopBtn.disabled = true;
  els.pauseBtn.disabled = true;
  els.resumeBtn.disabled = true;
  if (els.continueBtn) els.continueBtn.disabled = true;
  renderQueue();
  globalThis.MLPopupCampaigns.loadCampaignOptions(els.savedCampaignSelect);
  refreshStatus();
  statusPoller = setInterval(refreshStatus, 1400);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "EXTRACTION_PROGRESS") {
    globalThis.MLPopupUi.setUiRunning(els, Boolean(msg.running), Boolean(msg.paused));
    globalThis.MLPopupUi.setCounts(els, Number(msg.count || 0), Number(msg.withPhone || 0));
    globalThis.MLPopupUi.setProgress(
      els,
      Number(msg.progressPercent || 0),
      Number(msg.tasksCompleted || 0),
      Number(msg.tasksTotal || 0),
      Number(msg.searchesPerMin || 0)
    );
    if (msg.currentQuery) setMessage(`Buscando: ${msg.currentQuery}`);
  }
  if (msg?.type === "EXTRACTION_ERROR") setMessage(msg.message || "Error", true);
});

els.startBtn.addEventListener("click", onStart);
els.continueBtn?.addEventListener("click", () => onContinue().catch((e) => setMessage(e.message, true)));
els.stopBtn.addEventListener("click", () => onStop().catch((e) => setMessage(e.message, true)));
els.pauseBtn.addEventListener("click", () => onPause().catch((e) => setMessage(e.message, true)));
els.resumeBtn.addEventListener("click", () => onResume().catch((e) => setMessage(e.message, true)));
els.exportCsvBtn.addEventListener("click", () => downloadByType("csv").catch((e) => setMessage(e.message, true)));
els.exportXlsBtn.addEventListener("click", () => downloadByType("xls").catch((e) => setMessage(e.message, true)));
els.clearFormBtn.addEventListener("click", clearForm);
els.addQueueBtn.addEventListener("click", () => {
  const z = parseZones(els.zonesInput.value);
  memoryQueue.push({
    categories: globalThis.MLTextUtils.parseCsvLine(els.categoriesInput.value),
    cities: globalThis.MLTextUtils.parseCsvLine(els.citiesInput.value),
    zonesMap: z.map,
    sharedZones: z.sharedZones
  });
  renderQueue();
  setMessage(`Cola: ${memoryQueue.length} bloque(s).`);
});
els.clearQueueBtn.addEventListener("click", () => {
  memoryQueue = [];
  renderQueue();
  setMessage("Cola vaciada.");
});
els.saveCampaignBtn.addEventListener("click", () => saveCampaign().catch((e) => setMessage(e.message, true)));
els.loadCampaignBtn.addEventListener("click", () => loadCampaign().catch((e) => setMessage(e.message, true)));

boot();


// --- BACKEND SYNC AND STATUS ---
const urlEl = document.getElementById('mlsBackendUrl');
const tokEl = document.getElementById('mlsBackendToken');
const btnSave = document.getElementById('mlsSaveBackend');
const btnTest = document.getElementById('mlsTestBackend');
const mlsConnDot = document.getElementById('mlsConnDot');
const mlsConnText = document.getElementById('mlsConnText');
const mlsStatus = document.getElementById('mlsBackendStatus');

function setDot(state, text) {
  if (mlsConnDot) mlsConnDot.className = 'conn-dot ' + state;
  if (mlsConnText) mlsConnText.textContent = text;
}

async function ping() {
  const url = (urlEl.value || '').trim().replace(/\/$/, '');
  const token = (tokEl.value || '').trim();
  if (!url || !token) return setDot('idle', 'Sin configurar');
  setDot('idle', 'Verificando...');
  try {
    const r = await fetch(url + '/api/public/mapleads/ingest', { method: 'GET', headers: { 'X-Mapleads-Token': token } });
    if (r.ok) setDot('ok', 'Conectado \u2713');
    else if (r.status === 401) setDot('err', 'Token inv�lido');
    else setDot('err', 'Error HTTP ' + r.status);
  } catch (e) { setDot('err', 'Sin conexi�n'); }
}

if (globalThis.MLBackendSync) {
  globalThis.MLBackendSync.getConfig().then(c => {
    if (urlEl) urlEl.value = c.url || '';
    if (tokEl) tokEl.value = c.token || '';
    ping();
  });
}

if (btnSave) {
  btnSave.addEventListener('click', async () => {
    const url = (urlEl.value || '').trim().replace(/\/$/, '');
    const token = (tokEl.value || '').trim();
    if (globalThis.MLBackendSync) await globalThis.MLBackendSync.setConfig(url, token);
    if (mlsStatus) { mlsStatus.textContent = 'Guardado.'; setTimeout(() => { mlsStatus.textContent = ''; }, 2000); }
    ping();
  });
}

if (btnTest) {
  btnTest.addEventListener('click', ping);
}

setInterval(ping, 30000);

