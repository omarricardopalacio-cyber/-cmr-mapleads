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
function normalizeForRank(text) {
  return text.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function rankProductsMeta(products, query, limit) {
  const q = normalizeForRank(query);
  const queryTokens = q.split(/\s+/).filter(Boolean);
  const scoredProducts = products.map((p) => {
    let score = 0;
    let nameHit = false;
    const nameClean = normalizeForRank(p.name);
    const descClean = normalizeForRank(p.description || '');
    const skuClean = normalizeForRank(p.sku || '');
    if (nameClean.includes(q)) {
      score += 50;
      nameHit = true;
    } else if (descClean.includes(q)) {
      score += 20;
    }
    if (p.sku && skuClean.includes(q)) {
      score += 60;
      nameHit = true;
    }
    for (const token of queryTokens) {
      if (token.length < 2) continue;
      const sing = singularizeSpanish(token);
      if (nameClean.includes(token)) {
        score += 10;
        nameHit = true;
      } else if (descClean.includes(token)) {
        score += 5;
      }
      if (p.sku && skuClean.includes(token)) {
        score += 15;
        nameHit = true;
      }
      if (sing !== token) {
        if (nameClean.includes(sing)) {
          score += 8;
          nameHit = true;
        } else if (descClean.includes(sing)) {
          score += 4;
        }
      }
    }
    return { product: p, score, nameHit };
  });
  return scoredProducts;
}
const query = 'estoy buscando zapateros';
const products = [
  { id: '1', name: 'Zapatero de madera', description: 'Zapatero elegante para casa', sku: '' },
  { id: '2', name: 'Zapatero metálico', description: 'Zapatero con múltiples niveles', sku: '' },
];
const scored = rankProductsMeta(products, query, 6);
console.log('query normalized:', query);
console.log('singularize zapateros ->', singularizeSpanish('zapateros'));
console.log('scores:', scored.map((s) => ({ id: s.product.id, name: s.product.name, score: s.score, nameHit: s.nameHit })));