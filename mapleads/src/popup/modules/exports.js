(() => {
  function escapeCsvCell(v) {
    const s = String(v ?? "").replace(/"/g, '""');
    return `"${s}"`;
  }

  function getHeaders() {
    return [
      "nombre",
      "telefono",
      "direccion",
      "ciudad",
      "zona",
      "categoria",
      "maps_categoria",
      "sitio_web",
      "email",
      "rating",
      "reseñas",
      "estado_apertura",
      "tiene_fotos",
      "lead_score",
      "tipo_oportunidad",
      "oportunidades_tags",
      "campaña"
    ];
  }

  function leadToRow(l) {
    return [
      l.name,
      l.phone,
      l.address,
      l.city,
      l.zone,
      l.category,
      l.maps_category,
      l.website,
      l.email,
      l.rating,
      l.review_count,
      l.open_status,
      l.has_photos,
      l.lead_score,
      l.tipo_oportunidad,
      (l.oportunidades_tags || []).join("; "),
      l.campaign_name
    ];
  }

  function exportCsv(leads) {
    const headers = getHeaders();
    const rows = leads.map(leadToRow);
    return [headers, ...rows].map((r) => r.map(escapeCsvCell).join(",")).join("\n");
  }

  function exportExcelHtml(leads) {
    const headers = getHeaders();
    const esc = (v) =>
      String(v ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    const rows = leads.map(leadToRow);
    const th = headers.map((h) => `<th>${esc(h)}</th>`).join("");
    const tr = rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("");
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>
      table{border-collapse:collapse;font-family:Arial,sans-serif;font-size:11px}
      th,td{border:1px solid #ccc;padding:4px 6px}</style></head><body><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></body></html>`;
  }

  globalThis.MLPopupExports = { exportCsv, exportExcelHtml };
})();
