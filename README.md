# Mod Command — Twitch Moderation Panel

Dark pro Twitch moderation admin panel for human moderators. Express + Vite/React + SQLite, with real Twitch OAuth and Helix moderation calls.

## What is included

- Live moderation queue powered by Twitch EventSub WebSocket (`channel.chat.message`)
- Suspicious-message detector (links, scam phrases, floods, all-caps, repeats) so the queue stays focused
- User detail drawer with quick actions
- Quick actions wired to Twitch Helix: timeout, ban, delete (delete works on live items)
- Moderator action log backed by SQLite, including live success/failure summaries
- Chat command management
- Twitch OAuth flow with server-side token exchange, validation, and refresh
- Broadcaster channel selection by login
- Express backend + Vite React frontend

## Architecture

- `server/twitch.ts` — OAuth code exchange, `/oauth2/validate`, refresh, Helix wrapper, user lookup. Tokens are stored in SQLite (`twitch_auth` table).
- `server/eventsub.ts` — EventSub WebSocket manager and live queue store. Connects to `wss://eventsub.wss.twitch.tv/ws`, handles `session_welcome`/`session_keepalive`/`session_reconnect`, subscribes to `channel.chat.message`, scores incoming messages, persists suspicious ones in `live_queue`.
- `server/routes.ts` — REST API: `/api/status`, `/api/twitch/*`, `/api/twitch/eventsub/*`, `/api/moderation/*`, `/api/commands`.
- `server/storage.ts` — Drizzle/better-sqlite3 storage for moderation events and chat commands.
- `client/src/App.tsx` — Single-page dashboard. "Twitch OAuth" tab handles authorization, channel, and live-queue start/stop. Queue tab labels each item Live or Demo and only enables delete for Live.

Tokens never leave the server. The browser only sees identity (id, login, display name) and high-level connection state.

## Twitch Developer Console setup

1. Create a Twitch application at https://dev.twitch.tv/console/apps. Pick "Confidential" as the client type.
2. Add the **OAuth Redirect URLs** that exactly match your deployment(s):
   - Local: `http://localhost:5000/api/twitch/callback`
   - Render production: `https://twitch-mod-commandv3.onrender.com/api/twitch/callback`
3. Note the Client ID. Generate a Client Secret. **Never commit the secret to GitHub.** If a secret has ever been pasted in chat, a screenshot, or an issue, rotate it immediately in the Twitch console.
4. Set environment variables (locally in `.env`, in production via Render → Environment):

   ```env
   TWITCH_CLIENT_ID=...
   TWITCH_CLIENT_SECRET=...
   TWITCH_REDIRECT_URI=https://twitch-mod-commandv3.onrender.com/api/twitch/callback
   ```

## Required Twitch OAuth scopes

- `moderator:manage:banned_users` — timeout and ban via `POST /helix/moderation/bans`.
- `moderator:manage:chat_messages` — delete chat messages via `DELETE /helix/moderation/chat`.
- `moderator:read:chatters`
- `user:read:chat` — **required for the EventSub `channel.chat.message` subscription**. If you authorized before this scope was added, click **Disconnect** then **Start Twitch OAuth** again to grant it. The Live queue card will tell you if the scope is missing.
- `channel:bot`, `user:bot`, `user:write:chat` — for future bot-style command responses.

The authorizing user must already be a moderator on the broadcaster channel they intend to moderate. Twitch enforces this at the API layer; the panel simply forwards the request.

## Live queue (EventSub WebSocket)

After OAuth + channel are configured, open the **Twitch OAuth** tab and click **Start live queue**. The server:

1. Connects to `wss://eventsub.wss.twitch.tv/ws` and waits for `session_welcome`.
2. Within the welcome's grace window, calls `POST /helix/eventsub/subscriptions` with:
   - `type: "channel.chat.message"`, `version: "1"`
   - `condition: { broadcaster_user_id, user_id }` (the authorized moderator)
   - `transport: { method: "websocket", session_id }`
3. Streams notifications. Each `channel.chat.message` event is risk-scored; only flagged messages are inserted into the SQLite-backed `live_queue` along with the real Twitch `message_id` so delete via Helix works without further state.
4. Handles `session_keepalive` and `session_reconnect` automatically. On any prolonged silence beyond the keepalive timeout, or any close, it reconnects with exponential backoff and re-subscribes.

Use **Stop** to end the WebSocket and stop ingesting. Live items already in the queue stay until acted on, deleted from the live queue on success, or cleared when the broadcaster channel changes / Twitch is disconnected.

> Render free-tier services may sleep when idle, which closes the WebSocket. After the service wakes, click Start again. For uninterrupted ingestion, use a paid Render plan or another always-on host.

## Limits and behavior

- **Timeout / ban**: fully working when authorized + a broadcaster is configured. The backend resolves `targetUser` (login) → `user_id` via `GET /helix/users?login=`, then calls `POST /helix/moderation/bans?broadcaster_id=...&moderator_id=...`. Timeouts pass `duration` (60 s or 600 s); ban omits it.
- **Delete message**: works for Live queue items (real `message_id` from EventSub). The frontend disables Delete on Demo items; the backend also rejects demo placeholder ids (`msg_*`) with a clear, non-destructive error.
- **Warn**: recorded in the local action log only.
- Tokens are validated against `/oauth2/validate` on `/api/twitch/status`, and refreshed automatically when expired (using the stored refresh_token).

## Local setup

```bash
npm install
cp .env.example .env
# fill in TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, TWITCH_REDIRECT_URI
npm run dev
```

Open http://localhost:5000 → "Twitch OAuth" tab → "Start Twitch OAuth" → after the redirect, the dashboard shows you connected. Enter your channel login to set the broadcaster, then use the queue.

## Render deployment flow

1. Create a Render Web Service from this repo. Build command `npm install && npm run build`. Start command `npm run start`.
2. In Render → Environment, set:
   - `TWITCH_CLIENT_ID`
   - `TWITCH_CLIENT_SECRET`
   - `TWITCH_REDIRECT_URI=https://twitch-mod-commandv3.onrender.com/api/twitch/callback`
3. In the Twitch Developer Console, ensure that exact `TWITCH_REDIRECT_URI` is in your app's OAuth Redirect URLs.
4. Deploy. Visit `https://twitch-mod-commandv3.onrender.com`, open the "Twitch OAuth" tab, click **Start Twitch OAuth**.
5. After authorizing, Twitch redirects to `/api/twitch/callback` with a `code`. The server exchanges it for an access + refresh token, stores them in SQLite, and shows a clean success page with a link back to the dashboard.
6. On the dashboard, set the broadcaster channel login (e.g. the channel you moderate). Once the readiness checklist is all green, the queue's quick actions hit Twitch for real.

> Render's free SQLite filesystem is ephemeral. After a container restart you may need to re-authorize. For persistent tokens, attach a Render Disk to the working directory or move `twitch_auth` to Postgres.

## Security

- The Twitch client secret and user access/refresh tokens are stored only on the server (SQLite `twitch_auth`). They are never sent to the browser.
- The frontend only learns: identity (id/login/display name), broadcaster id/login/display name, and boolean readiness.
- If you previously shared a Twitch client secret in chat, screenshots, or any public surface — **regenerate it now** in the Twitch Developer Console, update Render, and redeploy.
- Do not commit `data.db` or `.env`. Both are excluded from the source archive.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/status` | Combined dashboard status (counts + Twitch readiness) |
| GET | `/api/twitch/status` | Authoritative Twitch connection state, validates / refreshes |
| GET | `/api/twitch/oauth-url` | Returns the authorize URL (also embedded in `/api/status`) |
| GET | `/api/twitch/callback` | OAuth redirect target. Exchanges `code`, stores tokens, shows result page |
| POST | `/api/twitch/channel` | Body `{ channelLogin }`. Resolves and stores broadcaster id |
| POST | `/api/twitch/disconnect` | Clears stored tokens |
| GET | `/api/moderation/queue` | Demo queue |
| GET | `/api/moderation/events` | Action log |
| POST | `/api/moderation/action` | Apply timeout / ban / delete / warn (live when ready) |
| GET / POST | `/api/commands` | List / upsert chat commands |
| GET | `/api/twitch/eventsub/status` | EventSub connection / session / subscription / last-event status |
| POST | `/api/twitch/eventsub/start` | Open WebSocket and subscribe to `channel.chat.message` |
| POST | `/api/twitch/eventsub/stop` | Close WebSocket and stop ingestion |
