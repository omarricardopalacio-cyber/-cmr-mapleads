const $ = (id) => document.getElementById(id);

async function load() {
  const { backendUrl, sessionToken, wsStatus } = await chrome.storage.local.get([
    "backendUrl", "sessionToken", "wsStatus",
  ]);
  if (backendUrl) $("backendUrl").value = backendUrl;
  if (sessionToken) $("sessionToken").value = sessionToken;
  const s = $("status");
  s.textContent = wsStatus || "desconectado";
  s.className = wsStatus === "connected" ? "ok" : "bad";
}

$("save").addEventListener("click", async () => {
  await chrome.storage.local.set({
    backendUrl: $("backendUrl").value.trim(),
    sessionToken: $("sessionToken").value.trim(),
  });
  $("status").textContent = "guardado, conectando…";
});

load();
setInterval(load, 2000);
