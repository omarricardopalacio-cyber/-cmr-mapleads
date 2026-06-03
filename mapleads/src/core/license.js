(() => {
  const FREE_LIMITS = {
    maxTasks: 30,
    maxLeads: 1000
  };

  function validateKey(rawKey) {
    const key = String(rawKey || "").trim().toUpperCase();
    if (!key) return { valid: false, key: "", reason: "Sin licencia", plan: "free", limits: FREE_LIMITS };
    const valid = /^MLS-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key);
    return {
      valid,
      key,
      reason: valid ? "" : "Formato invalido",
      plan: valid ? "pro" : "free",
      limits: valid ? { maxTasks: Number.POSITIVE_INFINITY, maxLeads: Number.POSITIVE_INFINITY } : FREE_LIMITS
    };
  }

  function enforceLimits({ totalTasks = 0, currentLeads = 0, license }) {
    const normalized = validateKey(license?.key || "");
    if (normalized.valid) return { ok: true, license: normalized };
    if (totalTasks > normalized.limits.maxTasks) {
      return { ok: false, error: `Modo free: maximo ${normalized.limits.maxTasks} tareas por corrida.`, license: normalized };
    }
    if (currentLeads >= normalized.limits.maxLeads) {
      return { ok: false, error: `Modo free: maximo ${normalized.limits.maxLeads} leads por corrida.`, license: normalized };
    }
    return { ok: true, license: normalized };
  }

  globalThis.MLLicense = { validateKey, enforceLimits, FREE_LIMITS };
})();
