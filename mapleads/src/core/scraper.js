(() => {
  const normalizeText = globalThis.MLTextUtils?.normalizeText || ((v) => String(v || "").trim());

  function findResultsFeed() {
    return document.querySelector('div[role="feed"]');
  }

  function getPlaceAnchors() {
    const feed = findResultsFeed();
    if (!feed) return [];
    return Array.from(feed.querySelectorAll('a[href*="/maps/place/"]')).filter((a) => a.offsetParent !== null);
  }

  function placeUrlToId(url) {
    try {
      const full = new URL(url, location.origin);
      return full.href.split("&")[0];
    } catch {
      return url;
    }
  }

  function readFromItemId(itemIdPart) {
    const el = document.querySelector(`[data-item-id*="${itemIdPart}"]`);
    if (!el) return "";
    const aria = normalizeText(el.getAttribute("aria-label") || "");
    if (aria.includes(":")) return normalizeText(aria.split(":").slice(1).join(":"));
    return normalizeText(el.textContent || "");
  }

  function getName() {
    const nameEl =
      document.querySelector("h1.DUwDvf") ||
      document.querySelector('h1[class*="fontHeadlineLarge"]') ||
      document.querySelector('h1[class*="fontHeadlineSmall"]');
    return normalizeText(nameEl?.textContent || "");
  }

  function getAddress() {
    return readFromItemId("address");
  }

  function getPhone() {
    const fromItem = readFromItemId("phone");
    if (fromItem) return fromItem;
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
    if (!href || href.startsWith("javascript:")) return "";
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
      if (m) return m[1].replace(",", ".");
    }
    const alt = document.querySelector('span[role="img"]');
    const t = alt?.getAttribute("aria-label") || "";
    const m2 = t.match(/(\d+[.,]?\d*)/);
    return m2 ? m2[1].replace(",", ".") : "";
  }

  function getReviewCountText() {
    const body = document.body?.innerText || "";
    const m = body.match(/([\d.,]+)\s*(?:reseñas|reviews|opiniones)/i);
    if (!m) return "";
    return m[1].replace(/\./g, "").replace(",", ".");
  }

  function getMapsCategoryLine() {
    const btns = document.querySelectorAll("button");
    for (const b of btns) {
      const t = normalizeText(b.textContent || "");
      if (t && t.length < 80 && /·|,/.test(t) === false && b.closest('[role="main"]')) {
        const near = b.closest("div");
        if (near && near.querySelector("h1")) return t;
      }
    }
    const sub = document.querySelector("h1 + div, h1 ~ div button");
    return normalizeText(sub?.textContent || "").slice(0, 120);
  }

  function getOpenStatusText() {
    const body = document.body?.innerText?.slice(0, 8000) || "";
    if (/cerrado\s+definitivamente|permanentemente\s+cerrado/i.test(body)) return "Cerrado";
    if (/\babierto\b/i.test(body) && !/abre\s+el/i.test(body)) return "Abierto";
    if (/\bcerrado\b/i.test(body)) return "Cerrado";
    return "";
  }

  function estimateHasPhotos() {
    const imgs = document.querySelectorAll('[role="main"] img[src*="googleusercontent"], [role="main"] img[src*="ggpht"]');
    return imgs.length >= 4;
  }

  function extractRawLead(task, campaignName) {
    return {
      name: getName(),
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
      campaign_name: campaignName || ""
    };
  }

  globalThis.MLScraper = {
    findResultsFeed,
    getPlaceAnchors,
    placeUrlToId,
    extractRawLead
  };
})();
