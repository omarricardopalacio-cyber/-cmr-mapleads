import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PilotDatabase } from "./database.js";
import { DEFAULT_PORT, startPilotServer } from "./server.js";

const baseDirectory =
  process.env.MAPLE_LOCAL_DATA_DIR ||
  join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Maple Local Pilot");
mkdirSync(baseDirectory, { recursive: true });

const database = new PilotDatabase(join(baseDirectory, "maple-local-pilot.sqlite"));
const server = await startPilotServer(database, join(baseDirectory, "media"), DEFAULT_PORT);

console.log(`Maple Local Pilot listening on http://127.0.0.1:${DEFAULT_PORT}`);
console.log(`Session token: ${database.getOrCreateToken()}`);

const shutdown = () => {
  server.close(() => {
    database.close();
    process.exit(0);
  });
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
