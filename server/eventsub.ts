import WebSocket from "ws";
import type Database from "better-sqlite3";
import type { TwitchClient, TwitchTokenStore } from "./twitch";

const EVENTSUB_WS_URL = "wss://eventsub.wss.twitch.tv/ws";

export type LiveQueueItem = {
  id: string;
  user: string;
  userId: string;
  risk: number;
  level: "critical" | "high" | "medium";
  message: string;
  reason: string;
  seenBefore: string;
  accountAge: string;
  badges: string[];
  source: "live" | "demo";
  messageId: string;
  receivedAt: number;
};

type Row = {
  message_id: string;
  user_login: string;
  user_id: string;
  display_name: string | null;
  text: string;
  risk: number;
  level: string;
  reason: string;
  badges: string;
  received_at: number;
};

const SUSPICIOUS_KEYWORDS = [
  "free followers",
  "buy followers",
  "best viewers",
  "cheap viewers",
  "promote your stream",
  "free vbucks",
  "free nitro",
  "click my profile",
  "check bio",
  "onlyfans",
  "earn money",
  "make money fast",
  "crypto giveaway",
  "double your",
  "airdrop",
  "investment opportunity",
];

const LINK_REGEX = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|gg|tv|xyz|cc|me|to|live|store|shop|biz|info|link|click)\b/i;
const REPEATED_CHAR_REGEX = /(.)\1{6,}/i;
const REPEATED_WORD_REGEX = /\b(\w{2,})\b(?:\W+\1\b){2,}/i;

export type RiskAssessment = {
  risk: number;
  level: LiveQueueItem["level"];
  reason: string;
  badges: string[];
  flagged: boolean;
};

export function assessMessage(text: string): RiskAssessment {
  let risk = 0;
  const reasons: string[] = [];
  const badges: string[] = [];

  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (LINK_REGEX.test(trimmed)) {
    risk += 45;
    reasons.push("link in message");
    badges.push("link");
  }

  for (const keyword of SUSPICIOUS_KEYWORDS) {
    if (lower.includes(keyword)) {
      risk += 50;
      reasons.push(`suspicious phrase "${keyword}"`);
      badges.push("scam phrase");
      break;
    }
  }

  if (REPEATED_CHAR_REGEX.test(trimmed)) {
    risk += 25;
    reasons.push("character flood");
    badges.push("flood");
  }

  if (REPEATED_WORD_REGEX.test(lower)) {
    risk += 25;
    reasons.push("repeated word");
    badges.push("repeat");
  }

  const letters = trimmed.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 12) {
    const upper = letters.replace(/[^A-Z]/g, "").length;
    if (upper / letters.length >= 0.7) {
      risk += 20;
      reasons.push("all caps");
      badges.push("caps");
    }
  }

  if (trimmed.length > 240) {
    risk += 10;
    reasons.push("long message");
  }

  // Conservative slur placeholder — operators can extend in code.
  // Keeping the list empty by default to avoid encoding any specific terms here.
  // const SLURS: string[] = [];
  // SLURS.forEach((slur) => { if (lower.includes(slur)) { risk += 80; reasons.push("flagged term"); badges.push("hate"); } });

  risk = Math.min(risk, 100);
  const flagged = risk >= 40;
  const level: LiveQueueItem["level"] = risk >= 75 ? "critical" : risk >= 55 ? "high" : "medium";
  return {
    risk,
    level,
    reason: reasons.length ? reasons.join(" + ") : "auto-flagged",
    badges,
    flagged,
  };
}

export class LiveQueueStore {
  private static readonly MAX_ITEMS = 50;

  constructor(private readonly sqlite: Database.Database) {
    sqlite
      .prepare(
        `CREATE TABLE IF NOT EXISTS live_queue (
          message_id TEXT PRIMARY KEY,
          user_login TEXT NOT NULL,
          user_id TEXT NOT NULL,
          display_name TEXT,
          text TEXT NOT NULL,
          risk INTEGER NOT NULL,
          level TEXT NOT NULL,
          reason TEXT NOT NULL,
          badges TEXT NOT NULL DEFAULT '',
          received_at INTEGER NOT NULL
        )`,
      )
      .run();
    sqlite
      .prepare(`CREATE INDEX IF NOT EXISTS live_queue_received_at ON live_queue (received_at DESC)`)
      .run();
  }

  insert(input: {
    messageId: string;
    userLogin: string;
    userId: string;
    displayName: string | null;
    text: string;
    risk: number;
    level: string;
    reason: string;
    badges: string[];
  }): void {
    this.sqlite
      .prepare(
        `INSERT OR IGNORE INTO live_queue (message_id, user_login, user_id, display_name, text, risk, level, reason, badges, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.messageId,
        input.userLogin,
        input.userId,
        input.displayName,
        input.text,
        input.risk,
        input.level,
        input.reason,
        input.badges.join(","),
        Date.now(),
      );
    // Trim to MAX_ITEMS, keeping newest.
    this.sqlite
      .prepare(
        `DELETE FROM live_queue WHERE message_id NOT IN (
           SELECT message_id FROM live_queue ORDER BY received_at DESC LIMIT ?
         )`,
      )
      .run(LiveQueueStore.MAX_ITEMS);
  }

  list(): LiveQueueItem[] {
    const rows = this.sqlite
      .prepare(`SELECT * FROM live_queue ORDER BY received_at DESC`)
      .all() as Row[];
    return rows.map((row) => ({
      id: row.message_id,
      user: row.display_name || row.user_login,
      userId: row.user_id,
      risk: row.risk,
      level: (row.level as LiveQueueItem["level"]) ?? "medium",
      message: row.text,
      reason: row.reason,
      seenBefore: "",
      accountAge: "",
      badges: row.badges ? row.badges.split(",").filter(Boolean) : [],
      source: "live",
      messageId: row.message_id,
      receivedAt: row.received_at,
    }));
  }

  remove(messageId: string): void {
    this.sqlite.prepare(`DELETE FROM live_queue WHERE message_id = ?`).run(messageId);
  }

  clear(): void {
    this.sqlite.prepare(`DELETE FROM live_queue`).run();
  }
}

type EventSubState = {
  running: boolean;
  status:
    | "idle"
    | "connecting"
    | "connected"
    | "subscribed"
    | "reconnecting"
    | "stopped"
    | "error";
  sessionId: string | null;
  subscriptionId: string | null;
  lastEventAt: number | null;
  lastKeepaliveAt: number | null;
  lastError: string | null;
  startedAt: number | null;
  reconnectAttempts: number;
  keepaliveTimeoutSeconds: number | null;
};

export class EventSubManager {
  private ws: WebSocket | null = null;
  private state: EventSubState = {
    running: false,
    status: "idle",
    sessionId: null,
    subscriptionId: null,
    lastEventAt: null,
    lastKeepaliveAt: null,
    lastError: null,
    startedAt: null,
    reconnectAttempts: 0,
    keepaliveTimeoutSeconds: null,
  };
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private welcomeTimer: NodeJS.Timeout | null = null;
  private reconnectingFromUrl: string | null = null;

  constructor(
    private readonly twitch: TwitchClient,
    private readonly tokens: TwitchTokenStore,
    private readonly liveQueue: LiveQueueStore,
  ) {}

  getStatus() {
    const record = this.tokens.get();
    return {
      ...this.state,
      hasCredentials: this.twitch.hasCredentials,
      moderator: record?.userId
        ? { id: record.userId, login: record.login, displayName: record.displayName }
        : null,
      broadcaster: record?.broadcasterId
        ? {
            id: record.broadcasterId,
            login: record.broadcasterLogin,
            displayName: record.broadcasterDisplayName,
          }
        : null,
      readyToStart: Boolean(record?.userId && record?.broadcasterId),
    };
  }

  async start(): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
    const record = this.tokens.get();
    if (!record?.accessToken || !record.userId) {
      return { ok: false, status: 401, message: "Twitch is not connected. Authorize first." };
    }
    if (!record.broadcasterId) {
      return {
        ok: false,
        status: 412,
        message: "Set the broadcaster channel before starting EventSub.",
      };
    }
    const scopes = (record.scopes || "").split(" ");
    if (!scopes.includes("user:read:chat")) {
      return {
        ok: false,
        status: 412,
        message:
          'Missing scope "user:read:chat". Re-authorize Twitch (Disconnect, then Start Twitch OAuth) to grant the new scope.',
      };
    }
    if (this.state.running) {
      return { ok: true };
    }
    this.state.running = true;
    this.state.lastError = null;
    this.state.reconnectAttempts = 0;
    this.state.startedAt = Date.now();
    this.openSocket(EVENTSUB_WS_URL);
    return { ok: true };
  }

  stop(): void {
    this.state.running = false;
    this.cleanupTimers();
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.state.status = "stopped";
    this.state.sessionId = null;
    this.state.subscriptionId = null;
  }

  private cleanupTimers() {
    if (this.keepaliveTimer) {
      clearTimeout(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    if (this.welcomeTimer) {
      clearTimeout(this.welcomeTimer);
      this.welcomeTimer = null;
    }
  }

  private openSocket(url: string) {
    this.cleanupTimers();
    this.state.status = this.reconnectingFromUrl ? "reconnecting" : "connecting";
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (err) {
      this.recordError(`WebSocket open failed: ${err instanceof Error ? err.message : String(err)}`);
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;

    // If the welcome message does not arrive within 15s, recycle.
    this.welcomeTimer = setTimeout(() => {
      this.recordError("Did not receive session_welcome within 15s.");
      this.recycle();
    }, 15_000);

    socket.on("open", () => {
      // wait for welcome
    });

    socket.on("message", (data) => {
      let text: string;
      try {
        text = typeof data === "string" ? data : data.toString();
      } catch {
        return;
      }
      let msg: any;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      this.handleMessage(msg).catch((err) => {
        this.recordError(`Handler error: ${err instanceof Error ? err.message : String(err)}`);
      });
    });

    socket.on("error", (err) => {
      this.recordError(`WebSocket error: ${err.message}`);
    });

    socket.on("close", (code, reason) => {
      // If we triggered a reconnect via session_reconnect, the new socket is already up.
      if (!this.state.running) return;
      // If we are intentionally recycling or reconnect_url was used, the new socket replaces this one.
      if (this.ws !== socket) return;
      this.recordError(`WebSocket closed (${code}) ${reason?.toString() ?? ""}`.trim());
      this.scheduleReconnect();
    });
  }

  private async handleMessage(msg: any) {
    const type = msg?.metadata?.message_type;
    switch (type) {
      case "session_welcome":
        await this.onWelcome(msg);
        break;
      case "session_keepalive":
        this.state.lastKeepaliveAt = Date.now();
        this.armKeepaliveTimer();
        break;
      case "session_reconnect":
        await this.onReconnect(msg);
        break;
      case "notification":
        await this.onNotification(msg);
        break;
      case "revocation":
        this.recordError(
          `Subscription revoked: ${msg?.payload?.subscription?.status ?? "unknown"}`,
        );
        this.state.subscriptionId = null;
        break;
      default:
        // unknown — ignore
        break;
    }
  }

  private async onWelcome(msg: any) {
    if (this.welcomeTimer) {
      clearTimeout(this.welcomeTimer);
      this.welcomeTimer = null;
    }
    const session = msg?.payload?.session;
    if (!session?.id) {
      this.recordError("session_welcome missing session.id");
      return this.recycle();
    }
    this.state.sessionId = session.id;
    this.state.keepaliveTimeoutSeconds = session.keepalive_timeout_seconds ?? 10;
    this.state.status = "connected";
    this.state.reconnectAttempts = 0;
    this.armKeepaliveTimer();

    // If this welcome resulted from a session_reconnect, subscriptions carry over.
    if (this.reconnectingFromUrl) {
      this.reconnectingFromUrl = null;
      this.state.status = "subscribed";
      return;
    }

    // Subscribe to channel.chat.message within the 10s grace window.
    const record = this.tokens.get();
    if (!record?.broadcasterId || !record.userId) {
      this.recordError("Lost moderator/broadcaster identity before subscribing.");
      this.stop();
      return;
    }
    try {
      const result = await this.twitch.helix<{ data: Array<{ id: string }> }>(
        "POST",
        "/eventsub/subscriptions",
        {
          body: {
            type: "channel.chat.message",
            version: "1",
            condition: {
              broadcaster_user_id: record.broadcasterId,
              user_id: record.userId,
            },
            transport: {
              method: "websocket",
              session_id: session.id,
            },
          },
        },
      );
      if (!result.ok) {
        this.recordError(
          `EventSub subscribe failed (${result.status}): ${result.raw.slice(0, 300)}`,
        );
        return;
      }
      const subId = result.data?.data?.[0]?.id ?? null;
      this.state.subscriptionId = subId;
      this.state.status = "subscribed";
    } catch (err) {
      this.recordError(
        `EventSub subscribe threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async onReconnect(msg: any) {
    const url = msg?.payload?.session?.reconnect_url;
    if (!url) {
      this.recordError("session_reconnect missing reconnect_url");
      return this.recycle();
    }
    this.reconnectingFromUrl = url;
    // Open new socket; old one will close shortly.
    const oldWs = this.ws;
    this.ws = null;
    this.openSocket(url);
    setTimeout(() => {
      try {
        oldWs?.removeAllListeners();
        oldWs?.close();
      } catch {
        /* ignore */
      }
    }, 1_000);
  }

  private async onNotification(msg: any) {
    const subType = msg?.metadata?.subscription_type;
    if (subType !== "channel.chat.message") return;
    const event = msg?.payload?.event;
    if (!event?.message_id || !event?.message?.text) return;
    this.state.lastEventAt = Date.now();
    this.armKeepaliveTimer();

    const text: string = event.message.text;
    const assessment = assessMessage(text);
    if (!assessment.flagged) return;

    this.liveQueue.insert({
      messageId: event.message_id,
      userLogin: event.chatter_user_login,
      userId: event.chatter_user_id,
      displayName: event.chatter_user_name ?? null,
      text,
      risk: assessment.risk,
      level: assessment.level,
      reason: assessment.reason,
      badges: assessment.badges,
    });
  }

  private armKeepaliveTimer() {
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer);
    const seconds = this.state.keepaliveTimeoutSeconds ?? 10;
    // Twitch suggests reconnecting if no message for keepalive_timeout. Add buffer.
    const timeoutMs = (seconds + 5) * 1000;
    this.keepaliveTimer = setTimeout(() => {
      this.recordError(`No keepalive within ${seconds + 5}s; recycling connection.`);
      this.recycle();
    }, timeoutMs);
  }

  private recordError(message: string) {
    this.state.lastError = message;
    if (this.state.status !== "stopped") this.state.status = "error";
  }

  private recycle() {
    if (!this.state.running) return;
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.state.sessionId = null;
    this.state.subscriptionId = null;
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (!this.state.running) return;
    this.cleanupTimers();
    this.state.reconnectAttempts += 1;
    const attempt = this.state.reconnectAttempts;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));
    this.state.status = "reconnecting";
    setTimeout(() => {
      if (!this.state.running) return;
      this.openSocket(EVENTSUB_WS_URL);
    }, delay);
  }
}
