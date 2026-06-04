// ============================================================
// MAPLE WA ENGINE — Ingest Service
// Acumula eventos y los envía en batch al backend
// ============================================================

import { backendClient } from "./backend-client";
import {
  enqueueEvent,
  getUnsyncedEvents,
  markEventsSynced,
  removeSyncedEvents,
} from "../storage/db";
import { CONSTANTS } from "../shared/contracts";
import type { WAEvent, IngestPayload, SessionInfo } from "../shared/types";

class IngestService {
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private active = false;

  start(session: SessionInfo): void {
    if (this.active) return;
    this.active = true;

    this.flushTimer = setInterval(() => {
      this.flush(session);
    }, CONSTANTS.BATCH_FLUSH_INTERVAL_MS);
  }

  stop(): void {
    this.active = false;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  async pushEvent(event: WAEvent): Promise<void> {
    await enqueueEvent(event);
  }

  async flush(session: SessionInfo): Promise<void> {
    if (!this.active) return;

    try {
      const events = await getUnsyncedEvents(CONSTANTS.BATCH_MAX_SIZE);
      if (events.length === 0) return;

      const payload: IngestPayload = {
        sessionId: session.sessionId,
        browserId: session.browserId,
        deviceId: session.deviceId,
        events: events.map((e) => ({
          id: String(e.id),
          type: e.eventType as any,
          payload: e.payload,
          timestamp: e.timestamp,
        })),
      };

      await backendClient.sendIngest(payload);

      const ids = events.map((e) => e.id!).filter((id): id is number => id !== undefined);
      await markEventsSynced(ids);
      await removeSyncedEvents();
    } catch (err) {
      console.warn("[IngestService] Flush falló:", err);
    }
  }

  isActive(): boolean {
    return this.active;
  }
}

export const ingestService = new IngestService();
