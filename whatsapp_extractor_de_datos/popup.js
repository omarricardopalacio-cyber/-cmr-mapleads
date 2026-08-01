let extractionResult = null;
let activeTabId = null;
let isRunning = false;

const STORAGE_KEY = "whatsapp_extractor_data";

const statusEl = document.getElementById("status");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const downloadJsonBtn = document.getElementById("downloadJsonBtn");
const downloadCsvBtn = document.getElementById("downloadCsvBtn");
const downloadExcelBtn = document.getElementById("downloadExcelBtn");
const maxChatsEl = document.getElementById("maxChats");
const delayMsEl = document.getElementById("delayMs");
const sourceSelectEl = document.getElementById("sourceSelect");
const exportFormatEl = document.getElementById("exportFormat");
const accessKeyEl = document.getElementById("accessKey");
const REQUIRED_ACCESS_KEY = "1023";

function setStatus(message) {
  statusEl.textContent = message;
}

async function saveToStorage(data) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: data });
  } catch (err) {
    console.error("Error guardando en storage:", err);
  }
}

async function loadFromStorage() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return result[STORAGE_KEY] || null;
  } catch (err) {
    console.error("Error cargando del storage:", err);
    return null;
  }
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0]);
    });
  });
}

function downloadText(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function extractPhoneNumbers(chatName) {
  const text = String(chatName || "");
  const numbers = text.match(/\d{7,15}/g) || [];
  const uniqueNumbers = [...new Set(numbers)];
  return uniqueNumbers.join(", ");
}

function downloadExcel(filename, data) {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Chats");
  XLSX.writeFile(wb, filename);
}

function toCsv(rows) {
  const headers = [
    "chat_id",
    "contact_name",
    "phone",
    "message_count",
    "first_message_at",
    "last_message_at",
    "all_messages"
  ];

  const escaped = (value) => {
    const text = String(value ?? "");
    return `"${text.replace(/"/g, '""')}"`;
  };

  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      [
        escaped(row.chatId),
        escaped(row.contactName),
        escaped(row.phone),
        escaped(row.messageCount),
        escaped(row.firstMessageAt),
        escaped(row.lastMessageAt),
        escaped(row.allMessages)
      ].join(",")
    );
  }

  return lines.join("\n");
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "EXTRACTION_DIAGNOSTIC") {
    setStatus(
      `Detectados en lista: ${message.detectedChats}\nProcesados: ${message.processed}`
    );
  }

  if (message?.type === "EXTRACTION_PROGRESS") {
    setStatus(
      `Procesando: ${message.current}/${message.total}\nChat: ${message.chatName}\nMensajes: ${message.messageCount ?? 0}\nIntentos abrir: ${message.openAttempts ?? "-"} | Exitos: ${message.openSuccess ?? "-"}`
    );
  }

  if (message?.type === "EXTRACTION_DONE") {
    extractionResult = message.payload;
    const total = extractionResult?.chats?.length ?? 0;
    setStatus(`Completado.\nChats extraidos: ${total}`);
    isRunning = false;
    stopBtn.disabled = true;
    downloadJsonBtn.disabled = total === 0;
    downloadCsvBtn.disabled = total === 0;
    downloadExcelBtn.disabled = total === 0;
    startBtn.disabled = false;

    saveToStorage({
      extractionResult,
      timestamp: new Date().toISOString()
    });

    const format = exportFormatEl.value;
    if (total > 0 && (format === "json" || format === "both")) {
      downloadJsonBtn.click();
    }
    if (total > 0 && (format === "csv" || format === "both")) {
      downloadCsvBtn.click();
    }
    if (total > 0 && format === "excel") {
      downloadExcelBtn.click();
    }
  }

  if (message?.type === "EXTRACTION_ERROR") {
    setStatus(`Error: ${message.error}`);
    isRunning = false;
    stopBtn.disabled = true;
    startBtn.disabled = false;
    saveToStorage({ isRunning: false, activeTabId: null, extractionResult: null });
  }

  if (message?.type === "EXTRACTION_STOPPED") {
    setStatus("Extraccion detenida por usuario.");
    isRunning = false;
    stopBtn.disabled = true;
    startBtn.disabled = false;
    saveToStorage({ isRunning: false, activeTabId: null, extractionResult: null });
  }
});

startBtn.addEventListener("click", async () => {
  if (isRunning) return;
  if ((accessKeyEl?.value || "").trim() !== REQUIRED_ACCESS_KEY) {
    setStatus("Clave incorrecta. No autorizado para iniciar.");
    return;
  }

  startBtn.disabled = true;
  stopBtn.disabled = false;
  isRunning = true;
  extractionResult = null;
  downloadJsonBtn.disabled = true;
  downloadCsvBtn.disabled = true;
  downloadExcelBtn.disabled = true;
  setStatus("Iniciando...");

  saveToStorage({
    isRunning,
    activeTabId: null,
    extractionResult: null,
    timestamp: new Date().toISOString()
  });

  const tab = await getActiveTab();
  activeTabId = tab?.id ?? null;
  if (!tab?.id || !tab.url?.includes("web.whatsapp.com")) {
    setStatus("Debes abrir web.whatsapp.com en la pestaña activa.");
    startBtn.disabled = false;
    stopBtn.disabled = true;
    isRunning = false;
    saveToStorage({ isRunning: false, activeTabId: null, extractionResult: null });
    return;
  }

  saveToStorage({
    isRunning,
    activeTabId,
    extractionResult: null,
    timestamp: new Date().toISOString()
  });

  chrome.tabs.sendMessage(
    tab.id,
    {
      type: "START_EXTRACTION",
      maxChats: Number(maxChatsEl.value || 50),
      delayMs: Number(delayMsEl.value || 1200),
      source: sourceSelectEl.value
    },
    (response) => {
      if (chrome.runtime.lastError) {
        setStatus(
          "No se pudo conectar con la pagina. Recarga WhatsApp Web e intenta de nuevo."
        );
        startBtn.disabled = false;
        stopBtn.disabled = true;
        isRunning = false;
        saveToStorage({ isRunning: false, activeTabId: null, extractionResult: null });
        return;
      }
      if (!response?.ok) {
        setStatus(response?.error || "No se pudo iniciar la extraccion.");
        startBtn.disabled = false;
        stopBtn.disabled = true;
        isRunning = false;
        saveToStorage({ isRunning: false, activeTabId: null, extractionResult: null });
      }
    }
  );
});

stopBtn.addEventListener("click", () => {
  if (!isRunning || !activeTabId) return;
  chrome.tabs.sendMessage(activeTabId, { type: "STOP_EXTRACTION" }, () => {
    if (chrome.runtime.lastError) {
      setStatus("No se pudo detener desde popup. Recarga la pagina.");
      return;
    }
    setStatus("Solicitud de detencion enviada...");
  });
});

downloadJsonBtn.addEventListener("click", () => {
  if (!extractionResult) return;
  const now = new Date().toISOString().replace(/[:.]/g, "-");
  downloadText(
    `whatsapp_chats_${now}.json`,
    JSON.stringify(extractionResult, null, 2),
    "application/json"
  );
});

downloadCsvBtn.addEventListener("click", () => {
  if (!extractionResult?.chats?.length) return;
  const now = new Date().toISOString().replace(/[:.]/g, "-");
  const rows = extractionResult.chats.map((chat) => {
    const first = chat.messages[0];
    const last = chat.messages[chat.messages.length - 1];
    const chatName = chat.chat_name || chat.contactName || chat.chatId || "";
    const allMessages = (chat.messages || [])
      .map((m) => {
        const ts = m?.timestamp || m?.meta || "";
        const type = m?.type || "";
        const txt = m?.text || "";
        return `${ts} ${type} ${txt}`.trim();
      })
      .join("\n");
    return {
      chatId: chatName,
      contactName: chatName,
      phone: "",
      messageCount: chat.messages.length,
      firstMessageAt: first?.timestamp || first?.meta || "",
      lastMessageAt: last?.timestamp || last?.meta || "",
      allMessages
    };
  });
  downloadText(`whatsapp_chats_${now}.csv`, toCsv(rows), "text/csv");
});

downloadExcelBtn.addEventListener("click", () => {
  if (!extractionResult?.chats?.length) return;
  const now = new Date().toISOString().replace(/[:.]/g, "-");
  const rows = extractionResult.chats.map((chat) => {
    const chatName = chat.chat_name || "";
    const first = chat.messages[0];
    const last = chat.messages[chat.messages.length - 1];
    return {
      "Nombre del Chat": chatName,
      "Número de WhatsApp": extractPhoneNumbers(chatName),
      "Cantidad de Mensajes": chat.messages.length,
      "Primer Mensaje": first?.timestamp || first?.meta || "",
      "Último Mensaje": last?.timestamp || last?.meta || ""
    };
  });
  downloadExcel(`whatsapp_numeros_${now}.xlsx`, rows);
});

async function restoreFromStorage() {
  const saved = await loadFromStorage();
  if (saved?.extractionResult) {
    extractionResult = saved.extractionResult;
    const total = extractionResult?.chats?.length ?? 0;
    if (total > 0) {
      downloadJsonBtn.disabled = false;
      downloadCsvBtn.disabled = false;
      downloadExcelBtn.disabled = false;
      const savedTime = saved.timestamp ? new Date(saved.timestamp).toLocaleString() : "";
      setStatus(`Datos restaurados.\nChats: ${total}\nGuardado: ${savedTime}`);
    }
  }

  if (saved?.isRunning) {
    isRunning = false;
    activeTabId = null;
    saveToStorage({ isRunning: false, activeTabId: null, extractionResult: saved.extractionResult || null });
    setStatus("Extracción anterior interrumpida. Puedes descargar los datos guardados o iniciar nueva extracción.");
  }
}

restoreFromStorage();
