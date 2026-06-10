(() => {
  const RESUME_KEY = "gmaps_lead_extractor_resume_v2";
  const RESUME_MAX_AGE_MS = 15 * 60 * 1000;

  const state = {
    running: false,
    paused: false,
    leads: [],
    seenKeys: new Set(),
    processedPlaceUrls: new Set(),
    currentQuery: "",
    withPhone: 0,
    campaignName: "",
    filters: {},
    delays: {
      betweenActionsMin: 200,
      betweenActionsMax: 600,
      slowdownMultiplier: 1.15
    },
    /** Contexto del bucle actual { tasks, index } para re-navegar a /maps/search/ si Maps vuelve a ferreteria u otra busqueda vieja. */
    currentTaskContext: null
  };

  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Pausa humana configurable + soporte de pausa sin detener del todo. */
  async function pacingSleep(ms) {
    while (state.paused && state.running) {
      await sleep(400);
    }
    if (!state.running) {
      return;
    }
    const minE = state.delays?.betweenActionsMin ?? 0;
    const maxE = state.delays?.betweenActionsMax ?? 0;
    const extra = maxE > minE ? randomBetween(minE, maxE) : minE;
    const mult = state.delays?.slowdownMultiplier ?? 1.1;
    await sleep(Math.round((ms + extra) * mult));
  }

  function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function makeLeadKey(lead) {
    return `${lead.name.toLowerCase()}|${lead.phone.toLowerCase()}|${lead.address.toLowerCase()}`;
  }

  function findResultsFeed() {
    return document.querySelector('div[role="feed"]');
  }

  /** Quita tildes para comparar texto con Maps (acentos variables). */
  function foldAccents(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function clearResume() {
    try {
      sessionStorage.removeItem(RESUME_KEY);
    } catch {
      /* ignore */
    }
  }

  function serializeTasks(tasks) {
    return tasks.map((t) => ({
      query: t.query,
      city: t.city,
      zone: t.zone,
      category: t.category
    }));
  }

  function buildMapsSearchUrl(query) {
    return `https://www.google.com/maps/search/${encodeURIComponent(normalizeText(query))}`;
  }

  /**
   * True si la URL es la de resultados de busqueda y coincide con la categoria/consulta del task.
   * Forzar /maps/search/... evita que Maps restaure "ferreteria" desde estado anterior de la SPA.
   */
  function isMapsSearchPathForTask(task) {
    const path = location.pathname || "";
    if (!path.startsWith("/maps/search/")) {
      return false;
    }
    const slug = path.slice("/maps/search/".length).split("/")[0];
    let slugDecoded = slug;
    try {
      slugDecoded = decodeURIComponent(slug.replace(/\+/g, "%20"));
    } catch {
      slugDecoded = slug.replace(/\+/g, " ");
    }
    const folded = foldAccents(slugDecoded);
    const cat = foldAccents(task.category || "");
    if (cat.length >= 2 && folded.includes(cat)) {
      return true;
    }
    const fullQ = foldAccents(normalizeText(task.query || "").replace(/\s+/g, " "));
    const compactSlug = folded.replace(/\s+/g, "");
    const compactQ = fullQ.replace(/\s+/g, "");
    return (
      compactSlug.length > 0 &&
      compactQ.length > 0 &&
      (compactSlug.includes(compactQ.slice(0, Math.min(18, compactQ.length))) ||
        compactQ.includes(compactSlug.slice(0, Math.min(18, compactSlug.length))))
    );
  }

  function saveResumeBeforeNavigate(tasks, taskIndex, midExtract) {
    const payload = {
      v: 2,
      savedAt: Date.now(),
      midExtract: Boolean(midExtract),
      tasks: serializeTasks(tasks),
      taskIndex,
      leads: state.leads,
      seenKeys: Array.from(state.seenKeys),
      withPhone: state.withPhone,
      processedPlaceUrls: midExtract ? Array.from(state.processedPlaceUrls) : [],
      filters: state.filters,
      delays: state.delays,
      paused: state.paused,
      campaignName: state.campaignName
    };
    sessionStorage.setItem(RESUME_KEY, JSON.stringify(payload));
  }

  /**
   * Si Google Maps cambia de vista/recarga inesperadamente, persistimos el job en curso.
   * Esto evita que se "detenga" cuando la SPA hace saltos de pagina.
   */
  function persistRunningJobForUnexpectedNavigation() {
    if (!state.running) {
      return;
    }
    const ctx = state.currentTaskContext;
    if (!ctx || !Array.isArray(ctx.tasks)) {
      return;
    }
    saveResumeBeforeNavigate(ctx.tasks, ctx.index, true);
  }

  /** Si ya no estamos en /maps/search/categoria..., recarga esa URL y continua tras sessionStorage. */
  function ensureSearchUrlOrNavigate(task) {
    if (!state.running) {
      return;
    }
    if (isMapsSearchPathForTask(task)) {
      return;
    }
    const ctx = state.currentTaskContext;
    if (ctx && Array.isArray(ctx.tasks)) {
      saveResumeBeforeNavigate(ctx.tasks, ctx.index, true);
    }
    window.location.assign(buildMapsSearchUrl(task.query));
  }

  async function waitForSearchResultsPanel() {
    for (let i = 0; i < 28; i += 1) {
      if (!state.running) {
        return;
      }
      if (findResultsFeed() && getPlaceAnchors().length > 0) {
        return;
      }
      if (getName()) {
        return;
      }
      await sleep(500);
    }
  }

  /** Cierra ficha de negocio para volver a la lista y no arrastrar URL vieja. */
  async function tryClosePlaceDetail() {
    for (let i = 0; i < 2; i += 1) {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          keyCode: 27,
          which: 27,
          bubbles: true
        })
      );
      await pacingSleep(randomBetween(280, 450));
    }
  }

  function sendUiError(message) {
    chrome.runtime.sendMessage({
      type: "EXTRACTION_ERROR",
      message
    });
  }

  function getPlaceAnchors() {
    const feed = findResultsFeed();
    if (!feed) {
      return [];
    }

    // Google Maps puede cambiar clases, por eso se usa un selector robusto
    const anchors = Array.from(feed.querySelectorAll('a[href*="/maps/place/"]'));
    return anchors.filter((anchor) => anchor.offsetParent !== null);
  }

  function placeUrlToId(url) {
    try {
      const full = new URL(url, location.origin);
      const cleaned = full.href.split("&")[0];
      return cleaned;
    } catch {
      return url;
    }
  }

  function getName() {
    const nameEl =
      document.querySelector("h1.DUwDvf") ||
      document.querySelector('h1[class*="fontHeadlineLarge"]') ||
      document.querySelector('h1[class*="fontHeadlineSmall"]');
    return normalizeText(nameEl?.textContent || "");
  }

  function readFromItemId(itemIdPart) {
    const el = document.querySelector(`[data-item-id*="${itemIdPart}"]`);
    if (!el) {
      return "";
    }

    const aria = normalizeText(el.getAttribute("aria-label") || "");
    if (aria.includes(":")) {
      return normalizeText(aria.split(":").slice(1).join(":"));
    }

    return normalizeText(el.textContent || "");
  }

  function getAddress() {
    return readFromItemId("address");
  }

  function getPhone() {
    const fromItem = readFromItemId("phone");
    if (fromItem) {
      return fromItem;
    }

    // Fallback: busca texto con formato telefonico
    const bodyText = document.body.innerText || "";
    const phoneMatch = bodyText.match(/(\+?\d[\d\s().-]{7,}\d)/);
    return normalizeText(phoneMatch ? phoneMatch[1] : "");
  }

  function getWebsite() {
    const link =
      document.querySelector('a[data-item-id="authority"]') ||
      document.querySelector('a[aria-label*="sitio web" i]') ||
      document.querySelector('a[aria-label*="website" i]');
    const href = link?.href || "";
    if (!href || href.startsWith("javascript:")) {
      return "";
    }
    return normalizeText(href);
  }

  function getRatingText() {
    const candidates = document.querySelectorAll("[aria-label], span, div");
    for (const el of candidates) {
      const label = `${el.getAttribute?.("aria-label") || ""} ${el.textContent || ""}`;
      const m = label.match(/(\d+[.,]\d|\d+[.,]\d{2}|\d)\s*(?:estrellas|stars|star)/i);
      if (m) {
        return m[1].replace(",", ".");
      }
    }
    const alt = document.querySelector('span[role="img"]');
    const t = alt?.getAttribute("aria-label") || "";
    const m2 = t.match(/(\d+[.,]?\d*)/);
    return m2 ? m2[1].replace(",", ".") : "";
  }

  function getReviewCountText() {
    const body = document.body?.innerText || "";
    const m = body.match(/([\d.,]+)\s*(?:reseñas|reviews|opiniones)/i);
    if (m) {
      const n = m[1].replace(/\./g, "").replace(",", ".");
      return n;
    }
    return "";
  }

  function getMapsCategoryLine() {
    const btns = document.querySelectorAll("button");
    for (const b of btns) {
      const t = normalizeText(b.textContent || "");
      if (t && t.length < 80 && /·|,/.test(t) === false && b.closest('[role="main"]')) {
        const near = b.closest("div");
        if (near && near.querySelector("h1")) {
          return t;
        }
      }
    }
    const sub = document.querySelector("h1 + div, h1 ~ div button");
    return normalizeText(sub?.textContent || "").slice(0, 120);
  }

  function getOpenStatusText() {
    const body = document.body?.innerText?.slice(0, 8000) || "";
    if (/cerrado\s+definitivamente|permanentemente\s+cerrado/i.test(body)) {
      return "Cerrado";
    }
    if (/\babierto\b/i.test(body) && !/abre\s+el/i.test(body)) {
      return "Abierto";
    }
    if (/\bcerrado\b/i.test(body)) {
      return "Cerrado";
    }
    return "";
  }

  function estimateHasPhotos() {
    const imgs = document.querySelectorAll('[role="main"] img[src*="googleusercontent"], [role="main"] img[src*="ggpht"]');
    return imgs.length >= 4;
  }

  function pushLead(lead) {
    const key = makeLeadKey(lead);
    if (state.seenKeys.has(key)) {
      return false;
    }

    state.seenKeys.add(key);
    state.leads.push(lead);
        try { globalThis.MLBackendSync?.sendBatch([lead]); } catch(e){}
    if (lead.phone) {
      state.withPhone += 1;
    }
    return true;
  }

  function notifyProgress() {
    chrome.runtime.sendMessage({
      type: "EXTRACTION_PROGRESS",
      running: state.running,
      paused: state.paused,
      count: state.leads.length,
      withPhone: state.withPhone,
      currentQuery: state.currentQuery
    });
  }

  async function clickAndExtract(anchor, task) {
    try {
      anchor.scrollIntoView({ behavior: "smooth", block: "center" });
      await pacingSleep(randomBetween(300, 900));

      // Click directo para abrir detalle del negocio
      anchor.click();
      await pacingSleep(randomBetween(1300, 2200));

      const name = getName();
      const address = getAddress();
      const phone = getPhone();

      if (!name) {
        return;
      }

      if (!globalThis.LeadScoring) {
        console.warn("LeadScoring no disponible");
        return;
      }

      const raw = {
        name,
        phone,
        address,
        city: task.city || "",
        zone: task.zone || "",
        category: task.category || "",
        maps_category: getMapsCategoryLine(),
        website: getWebsite(),
        rating: getRatingText(),
        review_count: getReviewCountText(),
        open_status: getOpenStatusText(),
        has_photos: estimateHasPhotos(),
        campaign_name: state.campaignName || ""
      };

      if (!globalThis.LeadScoring.passesFilters(raw, state.filters)) {
        return;
      }

      const enriched = globalThis.LeadScoring.enrichLead(raw, state.filters);
      const inserted = pushLead(enriched);
      if (inserted) {
        notifyProgress();
      }

      // Al abrir ficha Maps pasa a /maps/place/... y suele restaurar ferreteria u otra busqueda vieja: volver por URL.
      if (state.running) {
        await tryClosePlaceDetail();
        ensureSearchUrlOrNavigate(task);
      }
    } catch (error) {
      console.warn("Error extrayendo un negocio:", error);
    }
  }

  async function extractCurrentResults(task, opts = {}) {
    let sameCountCycles = 0;
    let lastLeadCount = state.leads.length;
    if (!opts.preserveProcessed) {
      state.processedPlaceUrls = new Set();
    }

    while (state.running) {
      if (!isMapsSearchPathForTask(task)) {
        ensureSearchUrlOrNavigate(task);
        break;
      }

      const feed = findResultsFeed();
      if (!feed) {
        // En algunas consultas Maps abre directamente un unico negocio.
        const directName = getName();
        if (directName && globalThis.LeadScoring) {
          const raw = {
            name: directName,
            phone: getPhone(),
            address: getAddress(),
            city: task.city || "",
            zone: task.zone || "",
            category: task.category || "",
            maps_category: getMapsCategoryLine(),
            website: getWebsite(),
            rating: getRatingText(),
            review_count: getReviewCountText(),
            open_status: getOpenStatusText(),
            has_photos: estimateHasPhotos(),
            campaign_name: state.campaignName || ""
          };
          if (!globalThis.LeadScoring.passesFilters(raw, state.filters)) {
            break;
          }
          const inserted = pushLead(globalThis.LeadScoring.enrichLead(raw, state.filters));
          if (inserted) {
            notifyProgress();
          }
          break;
        }

        await pacingSleep(1200);
        sameCountCycles += 1;
        if (sameCountCycles >= 4) {
          // En modo persistente no detenemos; reforzamos ruta de busqueda y seguimos.
          ensureSearchUrlOrNavigate(task);
          sameCountCycles = 0;
        }
        continue;
      }

      const anchors = getPlaceAnchors();

      for (const anchor of anchors) {
        if (!state.running) {
          break;
        }

        const href = anchor.getAttribute("href");
        if (!href) {
          continue;
        }

        const placeId = placeUrlToId(href);
        if (state.processedPlaceUrls.has(placeId)) {
          continue;
        }

        state.processedPlaceUrls.add(placeId);
        await clickAndExtract(anchor, task);
        await pacingSleep(randomBetween(400, 1200));
      }

      if (!state.running) {
        break;
      }

      // Scroll del panel para cargar nuevos resultados
      const previousScrollTop = feed.scrollTop;
      feed.scrollBy({
        top: Math.max(450, Math.floor(feed.clientHeight * 0.85)),
        behavior: "smooth"
      });
      await pacingSleep(randomBetween(1500, 2400));

      if (state.leads.length === lastLeadCount && Math.abs(feed.scrollTop - previousScrollTop) < 8) {
        sameCountCycles += 1;
      } else {
        sameCountCycles = 0;
      }

      lastLeadCount = state.leads.length;

      // Si no hay cambios durante varios ciclos, se detiene para evitar bucle infinito
      if (sameCountCycles >= 5) {
        // Modo persistente: nunca auto-detener, intentar re-sincronizar y continuar.
        ensureSearchUrlOrNavigate(task);
        sameCountCycles = 0;
        await pacingSleep(900);
      }
    }
  }

  function buildTasksFromQueue(payload) {
    if (!payload) {
      return [];
    }
    const q = payload.searchQueue;
    if (Array.isArray(q) && q.length > 0) {
      const merged = [];
      for (const item of q) {
        const block = {
          categories: item.categories ?? payload.categories,
          cities: item.cities ?? payload.cities,
          zonesMap: item.zonesMap ?? payload.zonesMap,
          sharedZones: item.sharedZones ?? payload.sharedZones
        };
        merged.push(...buildTasks(block));
      }
      return merged;
    }
    return buildTasks(payload);
  }

  function buildTasks(config) {
    const categories = (config?.categories || []).map((item) => normalizeText(item)).filter(Boolean);
    const cities = (config?.cities || []).map((item) => normalizeText(item)).filter(Boolean);
    const zonesMap = config?.zonesMap || {};
    const sharedZones = (config?.sharedZones || []).map((item) => normalizeText(item)).filter(Boolean);
    const tasks = [];

    for (const city of cities) {
      const cityKey = city.toLowerCase();
      const citySpecificZones = Array.isArray(zonesMap[cityKey]) ? zonesMap[cityKey] : [];
      const zonesForCity = citySpecificZones.length ? citySpecificZones : sharedZones;

      for (const category of categories) {
        if (zonesForCity.length) {
          for (const zone of zonesForCity) {
            const safeZone = normalizeText(zone);
            if (!safeZone) {
              continue;
            }
            const query = `${category} en ${safeZone}, ${city}`;
            tasks.push({ query, city, zone: safeZone, category });
          }
        } else {
          const query = `${category} en ${city}`;
          tasks.push({ query, city, zone: "", category });
        }
      }
    }

    return tasks;
  }

  async function runTasks(tasks, startIndex = 0) {
    let i = startIndex;
    while (state.running) {
      if (i >= tasks.length) {
        i = 0; // ciclo continuo hasta que el usuario pulse Detener
      }

      const task = tasks[i];
      state.currentQuery = task.query;
      state.currentTaskContext = { tasks, index: i };
      notifyProgress();

      if (!isMapsSearchPathForTask(task)) {
        saveResumeBeforeNavigate(tasks, i, false);
        window.location.assign(buildMapsSearchUrl(task.query));
        return;
      }

      try {
        await waitForSearchResultsPanel();
        await extractCurrentResults(task);
      } catch (error) {
        sendUiError(`Fallo en consulta "${task.query}": ${error.message || "error desconocido"}`);
      }

      i += 1;
      await pacingSleep(randomBetween(900, 1700));
    }

    state.currentQuery = "";
    state.currentTaskContext = null;
    notifyProgress();
  }

  function startExtraction(config) {
    if (state.running) {
      return { ok: true, running: true, count: state.leads.length, withPhone: state.withPhone };
    }

    clearResume();

    if (!globalThis.LeadScoring) {
      return { ok: false, error: "Modulo LeadScoring no cargado. Recarga la pagina." };
    }

    const tasks = buildTasksFromQueue(config);
    if (!tasks.length) {
      return { ok: false, error: "No hay combinaciones validas para buscar." };
    }

    state.filters = { ...globalThis.LeadScoring.defaultFilters(), ...(config.filters || {}) };
    if (config.delays && typeof config.delays === "object") {
      state.delays = { ...state.delays, ...config.delays };
    }
    state.paused = false;
    state.campaignName = normalizeText(config.campaignName || "");
    state.running = true;
    state.currentQuery = "";
    state.currentTaskContext = null;
    notifyProgress();
    runTasks(tasks, 0).catch((error) => {
      state.running = false;
      state.currentQuery = "";
      state.currentTaskContext = null;
      notifyProgress();
      sendUiError(error.message || "Error general de extraccion.");
      console.error("Error general de extraccion:", error);
    });

    return {
      ok: true,
      running: true,
      count: state.leads.length,
      withPhone: state.withPhone,
      totalTasks: tasks.length
    };
  }

  function stopExtraction() {
    clearResume();
    state.running = false;
    state.paused = false;
    state.currentQuery = "";
    state.currentTaskContext = null;
    notifyProgress();
    return { ok: true, running: false, count: state.leads.length, withPhone: state.withPhone };
  }

  function getStatus() {
    return {
      ok: true,
      running: state.running,
      paused: state.paused,
      count: state.leads.length,
      withPhone: state.withPhone,
      currentQuery: state.currentQuery
    };
  }

  function getLeads() {
    return {
      ok: true,
      leads: [...state.leads]
    };
  }

  function registerMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      try {
        switch (message?.type) {
          case "START_EXTRACTION":
            sendResponse(startExtraction(message?.payload || {}));
            return true;
          case "STOP_EXTRACTION":
            sendResponse(stopExtraction());
            return true;
          case "GET_STATUS":
            sendResponse(getStatus());
            return true;
          case "GET_LEADS":
            sendResponse(getLeads());
            return true;
          case "PAUSE_EXTRACTION":
            state.paused = true;
            notifyProgress();
            sendResponse({ ok: true, paused: true });
            return true;
          case "RESUME_EXTRACTION":
            state.paused = false;
            notifyProgress();
            sendResponse({ ok: true, paused: false });
            return true;
          default:
            sendResponse({ ok: false, error: "Comando no reconocido." });
            return true;
        }
      } catch (error) {
        sendResponse({ ok: false, error: error.message || "Error inesperado." });
        return true;
      }
    });
  }

  /** Tras location.assign a /maps/search/... la pagina recarga; aqui se reanuda el trabajo. */
  function resumeAfterNavigationIfNeeded() {
    const raw = sessionStorage.getItem(RESUME_KEY);
    if (!raw) {
      return;
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      clearResume();
      return;
    }
    if (!data || data.v !== 2 || !Array.isArray(data.tasks) || typeof data.taskIndex !== "number") {
      clearResume();
      return;
    }
    if (Date.now() - (data.savedAt || 0) > RESUME_MAX_AGE_MS) {
      clearResume();
      return;
    }
    const task = data.tasks[data.taskIndex];
    if (!task) {
      clearResume();
      return;
    }
    if (!isMapsSearchPathForTask(task)) {
      // Google puede aterrizar en /maps/place/... aunque pedimos /maps/search/.
      // Reforzamos navegacion para no perder el job.
      window.location.assign(buildMapsSearchUrl(task.query));
      return;
    }

    sessionStorage.removeItem(RESUME_KEY);
    state.leads = data.leads || [];
    state.seenKeys = new Set(data.seenKeys || []);
    state.withPhone = data.withPhone || 0;
    state.filters = data.filters || state.filters;
    state.delays = data.delays || state.delays;
    state.paused = data.paused ?? false;
    state.campaignName = data.campaignName || "";
    state.running = true;
    state.processedPlaceUrls = new Set(
      data.midExtract && Array.isArray(data.processedPlaceUrls) ? data.processedPlaceUrls : []
    );
    state.currentQuery = task.query;
    state.currentTaskContext = { tasks: data.tasks, index: data.taskIndex };
    notifyProgress();

    const resumeFlow = async () => {
      try {
        if (data.midExtract) {
          await waitForSearchResultsPanel();
          await extractCurrentResults(task, { preserveProcessed: true });
          await runTasks(data.tasks, data.taskIndex + 1);
        } else {
          await runTasks(data.tasks, data.taskIndex);
        }
      } catch (error) {
        state.running = false;
        state.currentQuery = "";
        state.currentTaskContext = null;
        notifyProgress();
        sendUiError(error.message || "Error al reanudar extraccion.");
        console.error(error);
      }
    };

    resumeFlow();
  }

  registerMessageListener();
  window.addEventListener("beforeunload", persistRunningJobForUnexpectedNavigation);
  window.addEventListener("pagehide", persistRunningJobForUnexpectedNavigation);
  setTimeout(resumeAfterNavigationIfNeeded, 800);
})();
