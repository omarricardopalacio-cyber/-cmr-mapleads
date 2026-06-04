// ============================================================
// MAPLE WA ENGINE — Polling Service
// Fallback para recibir comandos cuando WebSocket no está disponible
// ============================================================

import { backendClient } from "./backend-client";
import type { BackendCommand } from "../shared/types";

class PollingService {
  private active = false;
  private intervalMs = 3000;
  private timer: ReturnType<typeof setInterval> | null = null;
  private commandHandler: ((cmd: BackendCommand) => void) | null = null;

  start(handler: (cmd: BackendCommand) => void, intervalMs = 3000): void {
    if (this.active) return;
    this.active = true;
    this.commandHandler = handler;
    this.intervalMs = intervalMs;

    // Primer poll inmediato
    this.poll();

    // Luego cada intervalo
    this.timer = setInterval(() => this.poll(), intervalMs);
  }

  stop(): void {
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.commandHandler = null;
  }

  private async poll(): Promise<void> {
    if (!this.active || !this.commandHandler) return;

    try {
      const commands = await backendClient.getCommands();
      for (const cmd of commands) {
        this.commandHandler(cmd);
      }
    } catch (err) {
      // Silenciar errores de red para no spamear
    }
  }

  isActive(): boolean {
    return this.active;
  }
}

export const pollingService = new PollingService();
