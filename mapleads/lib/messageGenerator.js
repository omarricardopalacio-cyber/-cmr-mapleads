/** Plantillas de prospeccion B2B (texto orientativo, revisar antes de enviar). */
(function messageGenIife() {
  function whatsappMessage(nombreNegocio, tipoOportunidad) {
    const n = nombreNegocio || "su negocio";
    const t = tipoOportunidad || "mejorar su presencia online";
    return (
      `Hola, le escribo respecto a ${n}. ` +
      `Vi en Google Maps que podria haber una oportunidad (${t}). ` +
      `¿Le interesaria una propuesta breve sin compromiso?`
    );
  }

  function emailMessage(nombreNegocio, tipoOportunidad) {
    const n = nombreNegocio || "su negocio";
    const t = tipoOportunidad || "reforzar su presencia digital";
    return (
      `Estimado equipo de ${n},\n\n` +
      `Me pongo en contacto porque notamos una posible mejora relacionada con: ${t}.\n` +
      `Si les resulta util, puedo enviarles un resumen de 3 lineas con ideas concretas.\n\n` +
      `Saludos cordiales`
    );
  }

  globalThis.MessageGenerator = { whatsappMessage, emailMessage };
})();
