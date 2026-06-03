(() => {
  const fallbackFilters = () => ({
    minRating: 0,
    minReviews: 0,
    openStatus: "any",
    hasWebsite: "any",
    hasPhone: "any"
  });

  function classifyOpportunities(lead) {
    const tags = [];
    const rating = Number(String(lead.rating || "").replace(",", ".")) || 0;
    const reviews = Number(String(lead.review_count || "0").replace(/[^\d]/g, "")) || 0;
    const hasWebsite = Boolean(String(lead.website || "").trim());
    const hasPhone = Boolean(String(lead.phone || "").trim());

    if (!hasWebsite) tags.push("Oportunidad web");
    if (rating > 0 && rating < 4) tags.push("Reputacion debil");
    if (reviews < 20) tags.push("Pocas reseñas");
    if (!hasPhone) tags.push("Sin telefono");
    return tags;
  }

  function computeScore(lead, tags) {
    let score = 50;
    const rating = Number(String(lead.rating || "").replace(",", ".")) || 0;
    const reviews = Number(String(lead.review_count || "0").replace(/[^\d]/g, "")) || 0;

    if (!lead.website) score += 20;
    if (!lead.phone) score += 10;
    if (rating > 0 && rating < 4) score += 15;
    if (reviews < 20) score += 10;
    score += Math.min(10, tags.length * 2);
    return Math.max(0, Math.min(100, score));
  }

  function primaryOpportunityType(tags) {
    if (!tags.length) return "General";
    if (tags.includes("Oportunidad web")) return "Oportunidad web";
    if (tags.includes("Reputacion debil")) return "Reputacion debil";
    return tags[0];
  }

  function enrichLead(lead) {
    const tags = classifyOpportunities(lead);
    return {
      ...lead,
      lead_score: computeScore(lead, tags),
      tipo_oportunidad: primaryOpportunityType(tags),
      oportunidades_tags: tags
    };
  }

  const scoringApi = {
    defaultFilters: globalThis.MLFilters?.defaultFilters || fallbackFilters,
    passesFilters: globalThis.MLFilters?.passesFilters || (() => true),
    enrichLead
  };

  globalThis.MLScoring = scoringApi;
  // Compatibilidad hacia atras con el script actual.
  globalThis.LeadScoring = scoringApi;
})();
