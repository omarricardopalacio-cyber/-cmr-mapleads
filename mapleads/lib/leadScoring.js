/**
 * Clasificacion y puntuacion de leads (DOM ya normalizado en content script).
 * Expone globalThis.LeadScoring para content.js
 */
(function leadScoringIife() {
  const defaultFilters = () => ({
    minRating: 0,
    minReviews: 0,
    openStatus: "any",
    hasWebsite: "any",
    hasPhone: "any"
  });

  function parseNumberLoose(value) {
    if (value == null || value === "") {
      return null;
    }
    const n = Number(String(value).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }

  function passesFilters(lead, filters) {
    const f = { ...defaultFilters(), ...(filters || {}) };
    const rating = parseNumberLoose(lead.rating);
    const reviews = parseNumberLoose(lead.review_count);

    if (f.minRating > 0) {
      if (rating == null || rating < f.minRating) {
        return false;
      }
    }
    if (f.minReviews > 0) {
      if (reviews == null || reviews < f.minReviews) {
        return false;
      }
    }
    if (f.openStatus === "open") {
      if (!/abierto|open|ouvert/i.test(lead.open_status || "")) {
        return false;
      }
    }
    if (f.openStatus === "closed") {
      if (!/cerrado|closed|ferm/i.test(lead.open_status || "")) {
        return false;
      }
    }
    if (f.hasWebsite === "yes" && !lead.website) {
      return false;
    }
    if (f.hasWebsite === "no" && lead.website) {
      return false;
    }
    if (f.hasPhone === "yes" && !lead.phone) {
      return false;
    }
    if (f.hasPhone === "no" && lead.phone) {
      return false;
    }
    return true;
  }

  function classifyOpportunities(lead) {
    const tags = [];
    if (!lead.website) {
      tags.push("Oportunidad web");
    }
    const rating = parseNumberLoose(lead.rating);
    if (rating != null && rating < 4) {
      tags.push("Reputacion debil");
    }
    const reviews = parseNumberLoose(lead.review_count);
    if (reviews != null && reviews < 20) {
      tags.push("Baja presencia");
    }
    if (lead.has_photos === false) {
      tags.push("Perfil incompleto");
    }
    return tags;
  }

  function computeScore(lead, tags) {
    let score = 55;
    const rating = parseNumberLoose(lead.rating);
    const reviews = parseNumberLoose(lead.review_count);
    if (rating != null) {
      score += Math.max(0, Math.min(25, (rating - 3) * 8));
    }
    if (reviews != null) {
      score += Math.min(15, Math.log10(reviews + 1) * 6);
    }
    if (lead.website) {
      score += 8;
    }
    if (lead.phone) {
      score += 7;
    }
    if (lead.has_photos) {
      score += 5;
    }
    tags.forEach((t) => {
      if (t === "Oportunidad web") {
        score += 6;
      }
      if (t === "Reputacion debil") {
        score -= 4;
      }
      if (t === "Baja presencia") {
        score -= 3;
      }
      if (t === "Perfil incompleto") {
        score -= 2;
      }
    });
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  function primaryOpportunityType(tags) {
    if (!tags.length) {
      return "Sin oportunidad destacada";
    }
    return tags[0];
  }

  function enrichLead(lead, filters) {
    const tags = classifyOpportunities(lead);
    const lead_score = computeScore(lead, tags);
    const tipo_oportunidad = primaryOpportunityType(tags);
    return {
      ...lead,
      lead_score,
      tipo_oportunidad,
      oportunidades_tags: tags
    };
  }

  globalThis.LeadScoring = {
    defaultFilters,
    passesFilters,
    enrichLead
  };
})();
