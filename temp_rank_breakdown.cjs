function singularizeSpanish(word) {
  const w = word.toLowerCase().trim();
  if (w.length < 4) return w;
  const TYPO_MAP = {
    siyas: "silla",
    siya: "silla",
    sillas: "silla",
    zapateros: "zapatero",
    zapatro: "zapatero",
    zapatera: "zapatero",
    organizadores: "organizador",
    masajeadores: "masajeador",
    masajeader: "masajeador",
  };
  if (TYPO_MAP[w]) return TYPO_MAP[w];
  if (w.endsWith("iones")) return w.slice(0, -2);
  if (w.endsWith("es") && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) return w.slice(0, -1);
  return w;
}
function normalize(text) {
  return text.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function rankProductsMeta(products, query) {
  const q = normalize(query);
  const queryTokens = q.split(/\s+/).filter(Boolean);
  const results = products.map((p) => {
    const breakdown = {
      phraseMatch: 0,
      tokenMatchName: 0,
      tokenMatchDescription: 0,
      skuMatch: 0,
      singularMatch: 0,
      typoMatch: 0,
      finalScore: 0,
      nameHit: false,
    };
    const nameClean = normalize(p.name);
    const descClean = normalize(p.description || '');
    const skuClean = normalize(p.sku || '');
    if (nameClean.includes(q)) {
      breakdown.phraseMatch += 50;
      breakdown.nameHit = true;
    } else if (descClean.includes(q)) {
      breakdown.phraseMatch += 20;
    }
    if (p.sku && skuClean.includes(q)) {
      breakdown.skuMatch += 60;
      breakdown.nameHit = true;
    }
    for (const token of queryTokens) {
      if (token.length < 2) continue;
      const sing = singularizeSpanish(token);
      const corr = token; // no typo vocabulary in this isolated test
      if (nameClean.includes(token)) {
        breakdown.tokenMatchName += 10;
        breakdown.nameHit = true;
      } else if (descClean.includes(token)) {
        breakdown.tokenMatchDescription += 5;
      }
      if (p.sku && skuClean.includes(token)) {
        breakdown.skuMatch += 15;
        breakdown.nameHit = true;
      }
      if (sing !== token) {
        if (nameClean.includes(sing)) {
          breakdown.singularMatch += 8;
          breakdown.nameHit = true;
        } else if (descClean.includes(sing)) {
          breakdown.singularMatch += 4;
        }
      }
      if (corr !== token && corr !== sing) {
        if (nameClean.includes(corr)) {
          breakdown.typoMatch += 6;
          breakdown.nameHit = true;
        } else if (descClean.includes(corr)) {
          breakdown.typoMatch += 3;
        }
      }
    }
    breakdown.finalScore = breakdown.phraseMatch + breakdown.tokenMatchName + breakdown.tokenMatchDescription + breakdown.skuMatch + breakdown.singularMatch + breakdown.typoMatch;
    return { product: p.name, breakdown };
  });
  return results;
}
const products = [{ id: '1', name: 'Zapatero de madera', description: 'Zapatero elegante para casa', sku: '' }];
const query = 'estoy buscando zapateros';
const result = rankProductsMeta(products, query)[0];
console.log(JSON.stringify({ query, product: result.product, breakdown: result.breakdown }, null, 2));
console.log('singularize zapateros =>', singularizeSpanish('zapateros'));
