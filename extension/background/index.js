// background/index.js — Service worker (MV3). Punto de entrada.
// Usa chrome.alarms en vez de setInterval (más resiliente al sleep del SW).

importScripts(
  "../shared/contracts.js",
  "../shared/constants.js",
  "bridge-client.js",
  "command-dispatcher.js",
  "alarms.js"
);

const { ALARMS } = self.__engineConst;

async function bootstrap() {
  await self.__engineBridge.loadConfig();
  // Alarms (mín. 30s en producción, pero en dev MV3 acepta menores).
  chrome.alarms.create(ALARMS.POLL, { periodInMinutes: 0.05 });       // ~3s
  chrome.alarms.create(ALARMS.FLUSH, { periodInMinutes: 0.05 });
  chrome.alarms.create(ALARMS.HEARTBEAT, { periodInMinutes: 0.25 });  // 15s
  chrome.alarms.create(ALARMS.HEALTH, { periodInMinutes: 0.5 });      // 30s
  self.__engineAlarms.register();
  // disparo inmediato
  self.__engineBridge.enqueue(self.__engineContracts.makeEvent("heartbeat"));
  self.__engineBridge.flush();
  self.__engineBridge.poll();
}

chrome.runtime.onInstalled.addListener(bootstrap);
chrome.runtime.onStartup.addListener(bootstrap);

chrome.storage.onChanged.addListener(async (changes) => {
  if (changes.backendUrl || changes.sessionToken) {
    await self.__engineBridge.loadConfig();
    self.__engineBridge.poll();
  }
});

// Eventos enviados desde content scripts → cola de outbox
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.__engine && msg.payload) {
    self.__engineBridge.enqueue(msg.payload);
    sendResponse({ ok: true });
  }
  return true;
});

// Bootstrap también en cold start del SW
bootstrap();
