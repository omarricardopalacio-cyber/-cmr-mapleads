(() => {
  function generateWhatsAppText(name, opportunity) {
    if (!globalThis.MLMessageGenerator) return "";
    return globalThis.MLMessageGenerator.generateWhatsAppMessage({
      name,
      tipo_oportunidad: opportunity
    });
  }

  function generateEmailText(name, opportunity) {
    if (!globalThis.MLMessageGenerator) return "";
    const r = globalThis.MLMessageGenerator.generateEmailMessage({
      name,
      tipo_oportunidad: opportunity
    });
    return `${r.subject}\n\n${r.body}`;
  }

  async function copyToClipboard(text) {
    await navigator.clipboard.writeText(text);
  }

  globalThis.MLPopupMessaging = { generateWhatsAppText, generateEmailText, copyToClipboard };
})();
