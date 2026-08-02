import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { PilotDatabase } from "./database.js";
import { DEFAULT_PORT, startPilotServer } from "./server.js";

app.setName("Maple Local Pilot");
let database: PilotDatabase;

async function createWindow() {
  const userData = app.getPath("userData");
  database = new PilotDatabase(join(userData, "maple-local-pilot.sqlite"));
  await startPilotServer(database, join(userData, "media"), DEFAULT_PORT);

  ipcMain.handle("pilot:status", () => ({
    url: `http://127.0.0.1:${DEFAULT_PORT}`,
    token: database.getOrCreateToken(),
    messages: database.recentMessages(),
  }));
  ipcMain.handle("pilot:enqueue", (_event, chatId: string, text: string) => {
    if (!chatId.trim() || !text.trim()) throw new Error("Chat ID and text are required");
    return database.enqueueCommand("SEND_MESSAGE", { chatId: chatId.trim(), text: text.trim() });
  });

  const window = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      // CommonJS preload: package.json is "type": "module", so preload.js ESM fails silently.
      preload: join(import.meta.dirname, "..", "..", "src", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  await window.loadFile(join(import.meta.dirname, "..", "..", "src", "ui.html"));
}

app.whenReady().then(createWindow).catch((error) => {
  console.error("Local pilot failed to start:", error);
  app.quit();
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => database?.close());
