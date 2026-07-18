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
    currentTaskContext: null,
    license: { valid: false, key: "" },
    lastProgressAt: Date.now(),
    activeTasks: [],
    tasksTotal: 0,
    tasksCompleted: 0,
    runStartedAt: 0,
    checkpoint: null
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

  function markProgress() {
    state.lastProgressAt = Date.now();
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
    const city = foldAccents(task.city || "");
    const zone = foldAccents(task.zone || "");
    if (cat.length >= 2 && folded.includes(cat)) {
      return true;
    }
    if (city.length >= 2 && folded.includes(city)) {
      return true;
    }
    if (zone.length >= 2 && folded.includes(zone)) {
      return true;
    }
    const fullQ = foldAccents(normalizeText(task.query || "").replace(/\s+/g, " "));
    const compactSlug = folded.replace(/\s+/g, "");
    const compactQ = fullQ.replace(/\s+/g, "");
    const variableCandidates = [task.query, task.category, task.city, task.zone]
      .map((v) => foldAccents(normalizeText(v || "")).replace(/\s+/g, ""))
      .filter((v) => v.length > 0);
    return (
      compactSlug.length > 0 &&
      compactQ.length > 0 &&
      ((compactSlug.includes(compactQ.slice(0, Math.min(30, compactQ.length))) ||
        compactQ.includes(compactSlug.slice(0, Math.min(30, compactSlug.length)))) &&
        variableCandidates.some((candidate) => compactSlug.includes(candidate.slice(0, Math.min(30, candidate.length)))))
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
    const closeBtn =
      document.querySelector('button[aria-label*="Cerrar" i]') ||
      document.querySelector('button[aria-label*="Close" i]');
    if (closeBtn) {
      closeBtn.click();
      await pacingSleep(randomBetween(220, 420));
    }
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
    if (globalThis.MLScraper?.getPlaceAnchors) {
      return globalThis.MLScraper.getPlaceAnchors();
    }
    const feed = findResultsFeed();
    if (!feed) {
      return [];
    }

    // Google Maps puede cambiar clases, por eso se usa un selector robusto
    const anchors = Array.from(feed.querySelectorAll('a[href*="/maps/place/"]'));
    return anchors.filter((anchor) => anchor.offsetParent !== null);
  }

  function placeUrlToId(url) {
    if (globalThis.MLScraper?.placeUrlToId) {
      return globalThis.MLScraper.placeUrlToId(url);
    }
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

  function getEmail() {
    const emailLink =
      document.querySelector('a[href^="mailto:"]') ||
      document.querySelector('a[data-item-id*="email"]');
    const href = emailLink?.getAttribute("href") || "";
    if (href.toLowerCase().startsWith("mailto:")) {
      return normalizeText(href.replace(/^mailto:/i, "").split("?")[0]);
    }

    const bodyText = document.body?.innerText || "";
    const emailMatch = bodyText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    return normalizeText(emailMatch ? emailMatch[0] : "");
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
    const guard = globalThis.MLLicense?.enforceLimits?.({
      totalTasks: 0,
      currentLeads: state.leads.length,
      license: state.license
    });
    if (guard && !guard.ok) {
      state.running = false;
      sendUiError(guard.error);
      return false;
    }
    const key = makeLeadKey(lead);
    if (state.seenKeys.has(key)) {
      return false;
    }

    state.seenKeys.add(key);
    state.leads.push(lead);
    if (lead.phone) {
      state.withPhone += 1;
    }
    return true;
  }

  function notifyProgress() {
    const effectiveTotal = Math.max(
      0,
      Number(state.tasksTotal || 0) ||
        Number(state.currentTaskContext?.tasks?.length || 0) ||
        Number(state.activeTasks?.length || 0)
    );
    const effectiveCompleted = Math.max(0, Number(state.tasksCompleted || 0));
    const elapsedMs = Math.max(0, Date.now() - (state.runStartedAt || Date.now()));
    const elapsedMin = elapsedMs / 60000;
    const searchesPerMin = elapsedMin > 0 ? effectiveCompleted / elapsedMin : 0;
    const cycleCompleted = effectiveTotal > 0 ? effectiveCompleted % effectiveTotal : 0;
    const progressPercent = effectiveTotal > 0 ? Math.min(100, Math.round((cycleCompleted / effectiveTotal) * 100)) : 0;
    chrome.runtime.sendMessage({
      type: "EXTRACTION_PROGRESS",
      running: state.running,
      paused: state.paused,
      count: state.leads.length,
      withPhone: state.withPhone,
      currentQuery: state.currentQuery,
      tasksCompleted: effectiveCompleted,
      tasksTotal: effectiveTotal,
      searchesPerMin: Number(searchesPerMin.toFixed(2)),
      progressPercent
    });
  }

  function createCheckpoint() {
    const ctx = state.currentTaskContext;
    if (!ctx || !Array.isArray(ctx.tasks) || !ctx.tasks.length) {
      return null;
    }
    return {
      tasks: serializeTasks(ctx.tasks),
      nextTaskIndex: Math.max(0, Number(ctx.index) || 0),
      leads: state.leads,
      seenKeys: Array.from(state.seenKeys),
      withPhone: state.withPhone,
      processedPlaceUrls: Array.from(state.processedPlaceUrls),
      filters: state.filters,
      delays: state.delays,
      campaignName: state.campaignName,
      license: state.license,
      tasksTotal: state.tasksTotal,
      tasksCompleted: state.tasksCompleted,
      runStartedAt: state.runStartedAt,
      savedAt: Date.now()
    };
  }

  async function clickAndExtract(anchor, task) {
    try {
      anchor.scrollIntoView({ behavior: document.hidden ? "auto" : "smooth", block: "center" });
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

      const raw = globalThis.MLScraper?.extractRawLead
        ? globalThis.MLScraper.extractRawLead(task, state.campaignName || "")
        : {
            name,
            phone,
            address,
            city: task.city || "",
            zone: task.zone || "",
            category: task.category || "",
            maps_category: getMapsCategoryLine(),
            website: getWebsite(),
            email: getEmail(),
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
        markProgress();
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
          const raw = globalThis.MLScraper?.extractRawLead
            ? globalThis.MLScraper.extractRawLead(task, state.campaignName || "")
            : {
                name: directName,
                phone: getPhone(),
                address: getAddress(),
                city: task.city || "",
                zone: task.zone || "",
                category: task.category || "",
                maps_category: getMapsCategoryLine(),
                website: getWebsite(),
                email: getEmail(),
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
            markProgress();
          }
          break;
        }

        await pacingSleep(1200);
        sameCountCycles += 1;
        if (sameCountCycles >= 4) {
          // No hay panel util por varios ciclos: se da por cerrada esta consulta y se pasa a la siguiente.
          break;
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
        behavior: document.hidden ? "auto" : "smooth"
      });
      await pacingSleep(randomBetween(1500, 2400));

      if (state.leads.length === lastLeadCount && Math.abs(feed.scrollTop - previousScrollTop) < 8) {
        sameCountCycles += 1;
      } else {
        sameCountCycles = 0;
        markProgress();
      }

      lastLeadCount = state.leads.length;

      // Si no hay cambios durante varios ciclos, se detiene para evitar bucle infinito
      if (sameCountCycles >= 5) {
        // Sin resultados nuevos: cerrar la consulta actual y pasar a la siguiente variable.
        break;
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

      state.tasksCompleted += 1;
      i += 1;
      markProgress();
      notifyProgress();
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
    const licenseCheck = globalThis.MLLicense?.enforceLimits?.({
      totalTasks: tasks.length,
      currentLeads: state.leads.length,
      license: config.license
    });
    if (licenseCheck && !licenseCheck.ok) {
      return { ok: false, error: licenseCheck.error };
    }

    if (!tasks.length) {
      return { ok: false, error: "No hay combinaciones validas para buscar." };
    }

    state.filters = { ...globalThis.LeadScoring.defaultFilters(), ...(config.filters || {}) };
    if (config.delays && typeof config.delays === "object") {
      state.delays = { ...state.delays, ...config.delays };
    }
    state.paused = false;
    state.license = config.license || { valid: false, key: "" };
    state.campaignName = normalizeText(config.campaignName || "");
    state.running = true;
    state.currentQuery = "";
    state.currentTaskContext = null;
    state.lastProgressAt = Date.now();
    state.activeTasks = tasks;
    state.tasksTotal = tasks.length;
    state.tasksCompleted = 0;
    state.runStartedAt = Date.now();
    state.checkpoint = null;
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

  function stopExtraction(keepCheckpoint = true) {
    clearResume();
    if (keepCheckpoint) {
      state.checkpoint = createCheckpoint();
    } else {
      state.checkpoint = null;
    }
    state.running = false;
    state.paused = false;
    state.currentQuery = "";
    state.currentTaskContext = null;
    notifyProgress();
    return {
      ok: true,
      running: false,
      count: state.leads.length,
      withPhone: state.withPhone,
      canContinue: Boolean(state.checkpoint)
    };
  }

  function continueExtraction() {
    if (state.running) {
      return { ok: true, running: true, count: state.leads.length, withPhone: state.withPhone };
    }
    const cp = state.checkpoint;
    if (!cp || !Array.isArray(cp.tasks) || !cp.tasks.length) {
      return { ok: false, error: "No hay progreso guardado para continuar." };
    }
    state.leads = cp.leads || [];
    state.seenKeys = new Set(cp.seenKeys || []);
    state.withPhone = cp.withPhone || 0;
    state.filters = cp.filters || state.filters;
    state.delays = cp.delays || state.delays;
    state.campaignName = cp.campaignName || "";
    state.license = cp.license || state.license;
    state.processedPlaceUrls = new Set(cp.processedPlaceUrls || []);
    state.activeTasks = cp.tasks;
    state.tasksTotal = cp.tasksTotal || cp.tasks.length;
    state.tasksCompleted = cp.tasksCompleted || 0;
    state.runStartedAt = cp.runStartedAt || Date.now();
    state.running = true;
    state.paused = false;
    state.lastProgressAt = Date.now();
    state.currentQuery = "";
    state.currentTaskContext = null;
    notifyProgress();
    runTasks(cp.tasks, cp.nextTaskIndex || 0).catch((error) => {
      state.running = false;
      state.currentQuery = "";
      state.currentTaskContext = null;
      notifyProgress();
      sendUiError(error.message || "Error al continuar extraccion.");
      console.error("Error al continuar extraccion:", error);
    });
    return {
      ok: true,
      running: true,
      count: state.leads.length,
      withPhone: state.withPhone,
      totalTasks: state.tasksTotal
    };
  }

  function getStatus() {
    const effectiveTotal = Math.max(
      0,
      Number(state.tasksTotal || 0) ||
        Number(state.currentTaskContext?.tasks?.length || 0) ||
        Number(state.activeTasks?.length || 0)
    );
    const effectiveCompleted = Math.max(0, Number(state.tasksCompleted || 0));
    const elapsedMin = state.runStartedAt > 0 ? Math.max(1 / 60, (Date.now() - state.runStartedAt) / 60000) : 1;
    return {
      ok: true,
      running: state.running,
      paused: state.paused,
      count: state.leads.length,
      withPhone: state.withPhone,
      currentQuery: state.currentQuery,
      tasksCompleted: effectiveCompleted,
      tasksTotal: effectiveTotal,
      searchesPerMin: state.runStartedAt > 0 ? Number((effectiveCompleted / elapsedMin).toFixed(2)) : 0,
      progressPercent:
        effectiveTotal > 0
          ? Math.min(100, Math.round(((effectiveCompleted % effectiveTotal) / effectiveTotal) * 100))
          : 0,
      canContinue: Boolean(state.checkpoint)
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
          case "CONTINUE_EXTRACTION":
            sendResponse(continueExtraction());
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
    state.lastProgressAt = Date.now();
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
  setInterval(() => {
    if (!state.running) {
      return;
    }
    const stalledMs = Date.now() - (state.lastProgressAt || 0);
    if (stalledMs < 90000) {
      return;
    }
    const currentTask = state.currentTaskContext?.tasks?.[state.currentTaskContext.index];
    if (currentTask) {
      ensureSearchUrlOrNavigate(currentTask);
    }
    markProgress();
  }, 10000);
  setTimeout(resumeAfterNavigationIfNeeded, 800);
})();
