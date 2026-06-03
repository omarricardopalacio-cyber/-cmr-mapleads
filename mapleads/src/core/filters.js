(() => {
  function defaultFilters() {
    return {
      minRating: 0,
      minReviews: 0,
      openStatus: "any",
      hasWebsite: "any",
      hasPhone: "any"
    };
  }

  function passesFilters(lead, inputFilters) {
    const filters = { ...defaultFilters(), ...(inputFilters || {}) };
    const rating = Number(String(lead.rating || "").replace(",", ".")) || 0;
    const reviews = Number(String(lead.review_count || "0").replace(/[^\d]/g, "")) || 0;
    const hasWebsite = Boolean(String(lead.website || "").trim());
    const hasPhone = Boolean(String(lead.phone || "").trim());
    const openStatus = String(lead.open_status || "").toLowerCase();

    if (rating < Number(filters.minRating || 0)) {
      return false;
    }
    if (reviews < Number(filters.minReviews || 0)) {
      return false;
    }
    if (filters.openStatus === "open" && !openStatus.includes("abierto")) {
      return false;
    }
    if (filters.openStatus === "closed" && !openStatus.includes("cerrado")) {
      return false;
    }
    if (filters.hasWebsite === "yes" && !hasWebsite) {
      return false;
    }
    if (filters.hasWebsite === "no" && hasWebsite) {
      return false;
    }
    if (filters.hasPhone === "yes" && !hasPhone) {
      return false;
    }
    if (filters.hasPhone === "no" && hasPhone) {
      return false;
    }
    return true;
  }

  globalThis.MLFilters = { defaultFilters, passesFilters };
})();
