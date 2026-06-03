(() => {
  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function foldAccents(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function parseCsvLine(input) {
    return String(input || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function parseNumberLoose(value) {
    if (value == null || value === "") {
      return null;
    }
    const parsed = Number(String(value).replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }

  globalThis.MLTextUtils = {
    normalizeText,
    foldAccents,
    parseCsvLine,
    parseNumberLoose
  };
})();
