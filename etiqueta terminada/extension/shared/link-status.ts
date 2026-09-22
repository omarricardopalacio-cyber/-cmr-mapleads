// Estado de conexión del popup.
// Un tick fallido (poll 504, probe WPP, reinicio del SW) no debe pintar DESCONECTADO.

/** Fallos seguidos del poll/ingest antes de soltar el enlace. */
export const LINK_FAILS_TO_DOWN = 4;
/** Además del conteo, el último OK tiene que quedar atrás al menos esto. */
export const LINK_GRACE_MS = 8_000;
/** El engine/sesión/bridge aguantan este hueco antes de verse caídos. */
export const ENGINE_GRACE_MS = 15_000;

export function shouldMarkLinkDown(opts: {
  configured: boolean;
  failStreak: number;
  lastOkAt: number;
  now: number;
}): boolean {
  if (!opts.configured) return true;
  if (opts.failStreak < LINK_FAILS_TO_DOWN) return false;
  if (!opts.lastOkAt) return true;
  return opts.now - opts.lastOkAt >= LINK_GRACE_MS;
}

/**
 * Poll de comandos reciente: un POST /ingest vacío o sin red no debe
 * dejar el error rojo pegado bajo OK BACKEND.
 */
export function ingestFailureShouldStick(lastLinkOkAt: number, now: number, graceMs = 20_000): boolean {
  if (!lastLinkOkAt) return true;
  return now - lastLinkOkAt >= graceMs;
}

/** Hubo al menos un OK y el fallo todavía no es sostenido. */
export function linkIsUp(opts: {
  configured: boolean;
  failStreak: number;
  lastOkAt: number;
  now: number;
}): boolean {
  if (!opts.configured || !opts.lastOkAt) return false;
  return !shouldMarkLinkDown({ ...opts, configured: true });
}

export function signalHeld(rawUp: boolean, lastOkAt: number, now: number, graceMs = ENGINE_GRACE_MS): boolean {
  if (rawUp) return true;
  return lastOkAt > 0 && now - lastOkAt < graceMs;
}

export type PresentedConnection = {
  wppReady: boolean;
  sessionReady: boolean;
  backendConnected: boolean;
  uiConnected: boolean;
};

/**
 * La insignia del header es la conjunción de los tres puntos ya amortiguados.
 * No se pone roja si el bridge sigue OK y el backend acaba de responder.
 */
export function presentConnection(input: {
  now: number;
  configured: boolean;
  failStreak: number;
  lastLinkOkAt: number;
  engineRaw: boolean;
  sessionRaw: boolean;
  bridgeRaw: boolean;
  lastEngineOkAt: number;
  lastSessionOkAt: number;
  lastBridgeOkAt: number;
}): PresentedConnection {
  const linkUp = linkIsUp({
    configured: input.configured,
    failStreak: input.failStreak,
    lastOkAt: input.lastLinkOkAt,
    now: input.now,
  });
  const engineAnchor = Math.max(input.lastEngineOkAt, input.lastBridgeOkAt);
  const sessionAnchor = Math.max(input.lastSessionOkAt, input.lastEngineOkAt, input.lastBridgeOkAt);
  const wppReady = signalHeld(input.engineRaw || input.bridgeRaw, engineAnchor, input.now);
  const sessionReady = signalHeld(
    input.sessionRaw || input.engineRaw || input.bridgeRaw,
    sessionAnchor,
    input.now,
  );
  const backendConnected = input.configured && linkUp;
  return {
    wppReady,
    sessionReady,
    backendConnected,
    uiConnected: wppReady && sessionReady && backendConnected,
  };
}
