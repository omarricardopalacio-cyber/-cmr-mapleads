# Maple local desktop pilot

This is a reversible Windows-only proof that the existing Chrome WhatsApp extension can use a local API and local SQLite. It does not contact Supabase, Netlify, or the production CRM. WhatsApp remains open in normal Chrome.

## Run

From the repository root, install the newly declared dependencies once:

```powershell
npm install
```

Start the local desktop app:

```powershell
npm run desktop:dev
```

The app starts its Node HTTP server on `http://127.0.0.1:4317` only. Copy the token displayed in its status window.

Build the separate Chrome extension bundle:

```powershell
npm run desktop:extension:build
```

In Chrome, load unpacked `etiqueta terminada/extension/dist-desktop`. This explicit build alone defaults its configuration UI to `http://127.0.0.1:4317`; the normal `npm run build` keeps the existing cloud default and writes to `dist`.

Paste the desktop token in the extension popup, save, then reload the existing `web.whatsapp.com` tab. The pilot can ingest inbound text, display it in the desktop window, and queue one `SEND_MESSAGE` command. The extension polls, sends through the already-open Chrome WhatsApp session, then reports `MESSAGE_SENT`/`MESSAGE_ACK` to settle the command.

## Local data

Electron stores data under:

```text
%APPDATA%\Maple Local Pilot\
```

The database is `maple-local-pilot.sqlite`; media uploads are stored in its `media\` subdirectory. Do not share the database because it contains the local extension session token.

## Tests

```powershell
npm run desktop:test
```

The tests run with Electron's Node runtime and use temporary SQLite files. They cover duplicate ingest, atomic command claim/ACK behavior, API health, and authentication on local data and ingest routes.

## Rollback

Close the desktop app, disable/remove the unpacked `dist-desktop` extension, and re-enable/use the existing cloud extension bundle. No production service, environment file, Netlify configuration, or Supabase data is changed by this pilot. Delete `%APPDATA%\Maple Local Pilot\` only if you intentionally want to remove its local pilot data.

## Explicit limitations

- This is not a CRM migration, multi-user service, or installer.
- Only text message ingest is implemented; history import is intentionally minimal.
- Media is stored locally but is not attached to message records or rendered.
- The local token is per desktop database; there is no account login, token rotation UI, encryption-at-rest, retries, or command lease recovery.
- Electron Builder packaging is deliberately not configured in this reversible spike.
