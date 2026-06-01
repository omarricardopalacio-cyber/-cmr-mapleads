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
const SEND_TIMEOUT_MEDIA = 120000;
const SEND_RETRY_MAX = 3;
const SEND_RETRY_DELAY = 2000;
const LID_RESOLVE_ERROR =
  "El número no está registrado en WhatsApp o no se pudo resolver su LID.";

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
        this.emitStatus(task, "sent", result.messageId);
        task.resolve?.({ success: true, messageId: result.messageId });
      } else if (task.retryCount < SEND_RETRY_MAX) {
        task.retryCount++;
        task.status = "pending";
        this.emitStatus(task, "retry", undefined, `Retry ${task.retryCount}/${SEND_RETRY_MAX}`);
        await this.delay(SEND_RETRY_DELAY * task.retryCount);
      } else {
        this.queue.shift();
        task.status = "failed";
        task.error = result.error;
        this.emitStatus(task, "failed", undefined, result.error);
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

  private extractVerifiedChatId(queryResult: unknown, fallback: string): string {
    if (!queryResult) return fallback;
    if (typeof queryResult === "string") return queryResult;
    if (typeof queryResult === "boolean") return fallback;
    if (typeof queryResult === "object") {
      const record = queryResult as { wid?: string | { _serialized?: string } };
      const wid = record.wid;
      if (typeof wid === "string" && wid.includes("@")) return wid;
      if (wid && typeof wid === "object" && wid._serialized) return wid._serialized;
    }
    return fallback;
  }

  /**
   * Resuelve el JID verificado en servidores de WhatsApp (@c.us, @lid, etc.).
   * Los grupos (@g.us) omiten queryExists.
   */
  private async ensureContactLid(
    WPP: NonNullable<ReturnType<typeof getWPP>>,
    normalizedChatId: string
  ): Promise<{ success: boolean; error?: string; verifiedChatId?: string }> {
    if (normalizedChatId.endsWith("@g.us")) {
      return { success: true, verifiedChatId: normalizedChatId };
    }

    const queryExists = WPP.contact?.queryExists;
    if (typeof queryExists !== "function") {
      console.error("[MAPLE SENDER] WPP.contact.queryExists no disponible en esta versión de WA-JS");
      return {
        success: false,
        error: "Motor WPP desactualizado para queryExists",
      };
    }

    console.log(`[MAPLE SENDER] Resolviendo LID de usuario para: ${normalizedChatId}`);

    try {
      const result = await queryExists.call(WPP.contact, normalizedChatId);

      if (!result) {
        return {
          success: false,
          error: LID_RESOLVE_ERROR,
        };
      }

      const verifiedChatId = this.extractVerifiedChatId(result, normalizedChatId);
      console.log(
        `[MAPLE SENDER] LID resuelto con éxito. JID Verificado de WhatsApp: ${verifiedChatId}`
      );

      return { success: true, verifiedChatId };
    } catch (lidErr: unknown) {
      console.error("[MAPLE SENDER] Error consultando queryExists, aplicando fallback:", lidErr);
      return { success: true, verifiedChatId: normalizedChatId };
    }
  }

  private buildSendOptions(task: SendTask): Record<string, unknown> {
    const sendOptions: Record<string, unknown> = {
      createChat: true,
      ...(task.options || {}),
    };

    delete sendOptions.quotedMsg;
    delete sendOptions.quotedMsgId;

    if (
      task.quotedMsgId &&
      typeof task.quotedMsgId === "string" &&
      task.quotedMsgId.trim() !== ""
    ) {
      sendOptions.quotedMsg = task.quotedMsgId.trim();
    }

    return sendOptions;
  }

  private async executeTaskWithWpp(
    WPP: NonNullable<ReturnType<typeof getWPP>>,
    task: SendTask,
    controller: AbortController
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const normalizedChatId = this.normalizeChatId(task.chatId);
    const timeoutMs = task.media ? SEND_TIMEOUT_MEDIA : SEND_TIMEOUT;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const lidCheck = await this.ensureContactLid(WPP, normalizedChatId);
      if (!lidCheck.success) {
        return { success: false, error: lidCheck.error };
      }

      const targetChatId = lidCheck.verifiedChatId || normalizedChatId;
      const sendOptions = this.buildSendOptions(task);

      console.log(`[MAPLE SENDER] Iniciando transmisión hacia destinatario final: ${targetChatId}`);

      let result: any;

      if (task.media) {
        const fileType =
          (task.options?.mimeType as string) ||
          (task.options?.mimetype as string) ||
          "application/octet-stream";
        result = await WPP.chat.sendFileMessage(targetChatId, task.media, {
          type: fileType,
          caption: task.caption || task.text,
          ...sendOptions,
        });
      } else {
        result = await WPP.chat.sendTextMessage(targetChatId, task.text || "", sendOptions);
      }

      if (controller.signal.aborted) {
        throw new Error("SEND_ABORTED");
      }

      const messageId = result?.id?._serialized || result?.id || task.taskId;
      console.log(`[MAPLE SENDER] Mensaje transmitido con éxito. ID: ${messageId}`);
      return { success: true, messageId };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[MAPLE SENDER] Fallo absoluto en la transmisión del mensaje:", err);
      return { success: false, error: message || "SEND_ERROR" };
    } finally {
      clearTimeout(timeout);
      this.activeTasks.delete(task.taskId);
    }
  }

  private async executeTask(task: SendTask): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const WPP = getWPP();
    if (!WPP) {
      return { success: false, error: "WPP no disponible" };
    }

    const controller = new AbortController();
    this.activeTasks.set(task.taskId, controller);

    return this.executeTaskWithWpp(WPP, task, controller);
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
    task: SendTask,
    status: "sent" | "failed" | "retry",
    messageId?: string,
    error?: string
  ): void {
    postFromInjected("WA_EVENT", {
      event: status === "sent" ? "MESSAGE_SENT" : status === "failed" ? "MESSAGE_FAILED" : "MESSAGE_ACK",
      payload: {
        taskId: task.taskId,
        chatId: task.chatId,
        text: task.caption || task.text,
        fromMe: true,
        direction: "out",
        status,
        messageId,
        waMessageId: messageId,
        error,
        timestamp: Date.now(),
        // Incluir media en el payload para que el backend pueda actualizar el mensaje
        media: task.media ? {
          base64: task.media,
          mimetype: task.options?.mimetype,
          caption: task.caption,
        } : undefined,
      },
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
