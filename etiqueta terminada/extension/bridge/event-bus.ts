// ============================================================
// MAPLE WA ENGINE — Typed Event Bus
// ============================================================

import type { WAEventType, BridgeMessage } from "../shared/types";

type EventHandler<T = any> = (payload: T) => void | Promise<void>;

interface Listener<T = any> {
  event: WAEventType;
  handler: EventHandler<T>;
  once: boolean;
}

class EventBus {
  private listeners: Listener[] = [];
  private history: Map<WAEventType, any[]> = new Map();
  private maxHistory = 50;

  on<T = any>(event: WAEventType, handler: EventHandler<T>): () => void {
    const listener: Listener<T> = { event, handler, once: false };
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  once<T = any>(event: WAEventType, handler: EventHandler<T>): () => void {
    const listener: Listener<T> = { event, handler, once: true };
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  off<T = any>(event: WAEventType, handler: EventHandler<T>): void {
    this.listeners = this.listeners.filter(
      (l) => !(l.event === event && l.handler === handler)
    );
  }

  emit<T = any>(event: WAEventType, payload: T): void {
    // Guardar en historial
    if (!this.history.has(event)) {
      this.history.set(event, []);
    }
    const hist = this.history.get(event)!;
    hist.push(payload);
    if (hist.length > this.maxHistory) hist.shift();

    // Ejecutar listeners
    const toRemove: Listener[] = [];
    for (const listener of this.listeners) {
      if (listener.event === event) {
        try {
          listener.handler(payload);
        } catch (err) {
          console.error(`[EventBus] Error en handler de ${event}:`, err);
        }
        if (listener.once) {
          toRemove.push(listener);
        }
      }
    }
    this.listeners = this.listeners.filter((l) => !toRemove.includes(l));
  }

  getHistory<T = any>(event: WAEventType): T[] {
    return (this.history.get(event) || []) as T[];
  }

  clearHistory(event?: WAEventType): void {
    if (event) {
      this.history.delete(event);
    } else {
      this.history.clear();
    }
  }

  destroy(): void {
    this.listeners = [];
    this.history.clear();
  }
}

export const eventBus = new EventBus();
export type { EventBus, EventHandler };
