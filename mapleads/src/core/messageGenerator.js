(() => {
  function getTemplate(opportunityType) {
    const t = String(opportunityType || "").toLowerCase();
    if (t.includes("web")) {
      return "Hola {{name}}, vi que tu negocio tiene muy buen potencial en Google Maps y quiero ayudarte a captar mas clientes con una web optimizada.";
    }
    if (t.includes("reputacion")) {
      return "Hola {{name}}, detecte oportunidades para mejorar la reputacion online de tu negocio y aumentar conversiones.";
    }
    return "Hola {{name}}, analice tu presencia en Google Maps y tengo una propuesta rapida para mejorar resultados.";
  }

  function generateWhatsAppMessage({ name, tipo_oportunidad }) {
    return getTemplate(tipo_oportunidad).replace("{{name}}", name || "equipo");
  }

  function generateEmailMessage({ name, tipo_oportunidad }) {
    const body = generateWhatsAppMessage({ name, tipo_oportunidad });
    return {
      subject: `Propuesta para ${name || "tu negocio"}`,
      body: `${body}\n\nSi te interesa, te comparto un mini plan en 24h.`
    };
  }

  globalThis.MLMessageGenerator = {
    generateWhatsAppMessage,
    generateEmailMessage
  };
})();
