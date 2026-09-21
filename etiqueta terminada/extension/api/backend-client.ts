// ============================================================
// MAPLE WA ENGINE — Backend Client
// Cliente HTTP para comunicación con el CRM Backend
// ============================================================

import { describeTransportError, interpretCommandsResponse } from "../shared/backend-response";
import { API_ENDPOINTS, HEADERS } from "../shared/contracts";
import type { BackendCommand, IngestPayload, SessionInfo } from "../shared/types";

interface BackendConfig {
  baseUrl: string;
  sessionToken: string;
}

class BackendClient {
  private config: BackendConfig | null = null;

  setConfig(config: BackendConfig) {
    this.config = config;
  }

  getConfig(): BackendConfig | null {
    return this.config;
  }

  private getHeaders(): Record<string, string> {
    return {
      [HEADERS.CONTENT_TYPE]: "application/json",
      ...(this.config?.sessionToken
        ? { [HEADERS.SESSION_TOKEN]: this.config.sessionToken }
        : {}),
    };
  }

  async getCommands(): Promise<BackendCommand[]> {
    if (!this.config) throw new Error("Backend no configurado");

    const url = `${this.config.baseUrl}${API_ENDPOINTS.GET_COMMANDS}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: this.getHeaders(),
      });
    } catch (err) {
      throw new Error(describeTransportError(url, err));
    }

    const body = await response.text();
    const parsed = interpretCommandsResponse({
      url,
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get("content-type"),
      body,
    });
    if (!parsed.ok) throw new Error(parsed.message);
    return parsed.commands as BackendCommand[];
  }

  async sendIngest(payload: IngestPayload): Promise<{ ok: boolean }> {
    if (!this.config) throw new Error("Backend no configurado");

    const response = await fetch(
      `${this.config.baseUrl}${API_ENDPOINTS.POST_INGEST}`,
      {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      throw new Error(`POST ingest failed: ${response.status}`);
    }

    return { ok: true };
  }

  async sendHeartbeat(session: SessionInfo): Promise<void> {
    if (!this.config) return;

    await fetch(`${this.config.baseUrl}/api/public/engine/heartbeat`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({
        sessionId: session.sessionId,
        browserId: session.browserId,
        deviceId: session.deviceId,
        timestamp: Date.now(),
      }),
    });
  }
}

export const backendClient = new BackendClient();
export type { BackendConfig };
