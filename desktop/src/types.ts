export type JsonRecord = Record<string, unknown>;

export interface EngineCommand {
  id: string;
  type: string;
  payload: JsonRecord;
  attempts: number;
  createdAt: string;
}

export interface IngestResult {
  inserted: number;
  duplicates: number;
  acknowledgedCommands: number;
}

export interface RecentMessage {
  id: string;
  waMessageId: string | null;
  direction: "in" | "out";
  text: string;
  sentAt: string;
  contactName: string;
  chatId: string;
}
