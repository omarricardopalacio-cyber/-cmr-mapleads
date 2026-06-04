// ============================================================
// MAPLE WA ENGINE — Sender Engine (Injected Script)
// Envío robusto de mensajes con cola, retry, rate limit
// ============================================================

import { getWPP } from "./wpp-bootstrap";
import { postFromInjected } from "../bridge/postmessage";

interface SendTask {
  taskId: string;
  chatId: string;
  text?: string;
  media?: string; // base64 data URL
  caption?: string;
  quotedMsgId?: string;
  options?: Record<string, any>;
  retryCount: number;
  status: "pending" | "sending" | "sent" | "failed";
  createdAt: number;
  sentAt?: number;
  error?: string;
  resolve?: (result: { success: boolean; messageId?: string; error?: string }) => void;
}

const RATE_LIMIT_PER_MINUTE = 30;
const SEND_TIMEOUT = 30000;
const SEND_RETRY_MAX = 3;
const SEND_RETRY_DELAY = 2000;

class SenderEngine {
  private queue: SendTask[] = [];
  private processing = false;
  private sentTimestamps: number[] = [];
  private activeTasks: Map<string, AbortController> = new Map();

  async send(payload: Omit<SendTask, "taskId" | "retryCount" | "status" | "createdAt" | "resolve">): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const task: SendTask = {
      ...payload,
      taskId: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      retryCount: 0,
      status: "pending",
      createdAt: Date.now(),
    };

    const promise = new Promise<{ success: boolean; messageId?: string; error?: string }>((resolve) => {
      task.resolve = resolve;
    });

    this.queue.push(task);
    this.processQueue();
    return promise;
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const task = this.queue[0];
      if (!task) break;

      await this.waitForRateLimit();
      const result = await this.executeTask(task);

      if (result.success) {
        this.queue.shift();
        task.status = "sent";
        this.emitStatus(task.taskId, "sent", result.messageId);
        task.resolve?.({ success: true, messageId: result.messageId });
      } else if (task.retryCount < SEND_RETRY_MAX) {
        task.retryCount++;
        task.status = "pending";
        this.emitStatus(task.taskId, "retry", undefined, `Retry ${task.retryCount}/${SEND_RETRY_MAX}`);
        await this.delay(SEND_RETRY_DELAY * task.retryCount);
      } else {
        this.queue.shift();
        task.status = "failed";
        task.error = result.error;
        this.emitStatus(task.taskId, "failed", undefined, result.error);
        task.resolve?.({ success: false, error: result.error });
      }
    }

    this.processing = false;
  }

  private normalizeChatId(chatId: string): string {
    if (!chatId) return chatId;
    if (chatId.includes("@")) return chatId;
    // Por defecto asumimos @c.us si no tiene sufijo
    return `${chatId}@c.us`;
  }

  private async executeTask(task: SendTask): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const WPP = getWPP();
    if (!WPP) {
      return { success: false, error: "WPP no disponible" };
    }

    const normalizedChatId = this.normalizeChatId(task.chatId);
    let targetChatId = normalizedChatId;

    // ── Fallback robusto para asegurar LID antes de enviar ──
    try {
      if (WPP.contact && typeof WPP.contact.queryExists === "function" && !normalizedChatId.endsWith("@g.us")) {
        const result = await Promise.race([
          WPP.contact.queryExists(normalizedChatId),
          new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), 8000))
        ]);
        if (result && (result as any).wid && (result as any).wid._serialized) {
          targetChatId = (result as any).wid._serialized;
        }
      }
    } catch (e) {
      console.warn("[SenderEngine] Fallback queryExists timeout o error", e);
    }

    const controller = new AbortController();
    this.activeTasks.set(task.taskId, controller);

    const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT);

    try {
      let result: any;

      if (task.media) {
        // Enviar archivo desde base64
        result = await WPP.chat.sendFileMessage(
          targetChatId,
          task.media,
          {
            type: task.options?.mimetype || "application/octet-stream",
            caption: task.caption || task.text,
            quotedMsg: task.quotedMsgId,
            createChat: true,
          }
        );
      } else {
        // Enviar texto
        result = await WPP.chat.sendTextMessage(
          targetChatId,
          task.text || "",
          {
            quotedMsg: task.quotedMsgId,
            createChat: true,
            ...task.options,
          }
        );
      }

      if (controller.signal.aborted) {
        throw new Error("SEND_ABORTED");
      }

      clearTimeout(timeout);
      this.activeTasks.delete(task.taskId);

      return {
        success: true,
        messageId: result?.id?._serialized || result?.id || task.taskId,
      };
    } catch (err: any) {
      clearTimeout(timeout);
      this.activeTasks.delete(task.taskId);
      return {
        success: false,
        error: err?.message || "SEND_ERROR",
      };
    }
  }

  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Limpiar timestamps antiguos
    this.sentTimestamps = this.sentTimestamps.filter((t) => t > oneMinuteAgo);

    if (this.sentTimestamps.length >= RATE_LIMIT_PER_MINUTE) {
      const oldest = this.sentTimestamps[0];
      const wait = oldest + 60000 - now + 100;
      console.log(`[SenderEngine] Rate limit alcanzado, esperando ${wait}ms`);
      await this.delay(wait);
    }

    this.sentTimestamps.push(Date.now());
  }

  private emitStatus(
    taskId: string,
    status: "sent" | "failed" | "retry",
    messageId?: string,
    error?: string
  ): void {
    postFromInjected("WA_EVENT", {
      event: status === "sent" ? "MESSAGE_SENT" : status === "failed" ? "MESSAGE_FAILED" : "MESSAGE_ACK",
      payload: { taskId, status, messageId, error, timestamp: Date.now() },
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getQueue(): SendTask[] {
    return [...this.queue];
  }

  cancelTask(taskId: string): boolean {
    const controller = this.activeTasks.get(taskId);
    if (controller) {
      controller.abort();
      this.activeTasks.delete(taskId);
      return true;
    }

    const index = this.queue.findIndex((t) => t.taskId === taskId);
    if (index >= 0) {
      this.queue.splice(index, 1);
      return true;
    }
    return false;
  }

  destroy(): void {
    for (const [_, controller] of this.activeTasks) {
      controller.abort();
    }
    this.activeTasks.clear();
    this.queue = [];
    this.sentTimestamps = [];
    this.processing = false;
  }
}

export const senderEngine = new SenderEngine();
