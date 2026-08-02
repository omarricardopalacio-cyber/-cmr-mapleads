const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pilot", {
  status: () => ipcRenderer.invoke("pilot:status"),
  enqueue: (chatId, text) => ipcRenderer.invoke("pilot:enqueue", chatId, text),
});
