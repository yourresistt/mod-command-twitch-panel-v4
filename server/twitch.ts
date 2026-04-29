import Database from "better-sqlite3";

const ID_BASE = "https://id.twitch.tv";
const HELIX_BASE = "https://api.twitch.tv/helix";

export const TWITCH_SCOPES = [
  "moderator:manage:banned_users",
  "moderator:manage:chat_messages",
  "moderator:read:chatters",
  "channel:bot",
  "user:bot",
  "user:read:chat",
  "user:write:chat",
];

export type TwitchTokenRecord = {
  id: number;
  accessToken: string;
  refreshToken: string | null;
  scopes: string;
  userId: string | null;
  login: string | null;
  displayName: string | null;
  expiresAt: number | null;
  broadcasterId: string | null;
  broadcasterLogin: string | null;
  broadcasterDisplayName: string | null;
  updatedAt: string;
};

type Row = {
  id: number;
  access_token: string;
  refresh_token: string | null;
  scopes: string;
  user_id: string | null;
  login: string | null;
  display_name: string | null;
  expires_at: number | null;
  broadcaster_id: string | null;
  broadcaster_login: string | null;
  broadcaster_display_name: string | null;
  updated_at: string;
};

function toRecord(row: Row): TwitchTokenRecord {
  return {
    id: row.id,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    scopes: row.scopes,
    userId: row.user_id,
    login: row.login,
    displayName: row.display_name,
    expiresAt: row.expires_at,
    broadcasterId: row.broadcaster_id,
    broadcasterLogin: row.broadcaster_login,
    broadcasterDisplayName: row.broadcaster_display_name,
    updatedAt: row.updated_at,
  };
}

export class TwitchTokenStore {
  constructor(private readonly sqlite: Database.Database) {
    sqlite
      .prepare(
        `CREATE TABLE IF NOT EXISTS twitch_auth (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          access_token TEXT NOT NULL,
          refresh_token TEXT,
          scopes TEXT NOT NULL DEFAULT '',
          user_id TEXT,
          login TEXT,
          display_name TEXT,
          expires_at INTEGER,
          broadcaster_id TEXT,
          broadcaster_login TEXT,
          broadcaster_display_name TEXT,
          updated_at TEXT NOT NULL
        )`,
      )
      .run();
  }

  get(): TwitchTokenRecord | null {
    const row = this.sqlite
      .prepare("SELECT * FROM twitch_auth WHERE id = 1")
      .get() as Row | undefined;
    return row ? toRecord(row) : null;
  }

  save(input: {
    accessToken: string;
    refreshToken: string | null;
    scopes: string[];
    userId?: string | null;
    login?: string | null;
    displayName?: string | null;
    expiresAt: number | null;
  }): TwitchTokenRecord {
    const existing = this.get();
    const now = new Date().toISOString();
    const broadcasterId = existing?.broadcasterId ?? null;
    const broadcasterLogin = existing?.broadcasterLogin ?? null;
    const broadcasterDisplayName = existing?.broadcasterDisplayName ?? null;
    this.sqlite
      .prepare(
        `INSERT INTO twitch_auth (
          id, access_token, refresh_token, scopes, user_id, login, display_name,
          expires_at, broadcaster_id, broadcaster_login, broadcaster_display_name, updated_at
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          access_token = excluded.access_token,
          refresh_token = excluded.refresh_token,
          scopes = excluded.scopes,
          user_id = excluded.user_id,
          login = excluded.login,
          display_name = excluded.display_name,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at`,
      )
      .run(
        input.accessToken,
        input.refreshToken,
        input.scopes.join(" "),
        input.userId ?? null,
        input.login ?? null,
        input.displayName ?? null,
        input.expiresAt,
        broadcasterId,
        broadcasterLogin,
        broadcasterDisplayName,
        now,
      );
    return this.get()!;
  }

  setIdentity(input: { userId: string; login: string; displayName: string; scopes?: string[] }): TwitchTokenRecord | null {
    const existing = this.get();
    if (!existing) return null;
    this.sqlite
      .prepare(
        `UPDATE twitch_auth SET user_id = ?, login = ?, display_name = ?, scopes = COALESCE(?, scopes), updated_at = ? WHERE id = 1`,
      )
      .run(
        input.userId,
        input.login,
        input.displayName,
        input.scopes ? input.scopes.join(" ") : null,
        new Date().toISOString(),
      );
    return this.get();
  }

  setBroadcaster(input: { id: string; login: string; displayName: string }): TwitchTokenRecord | null {
    const existing = this.get();
    if (!existing) return null;
    this.sqlite
      .prepare(
        `UPDATE twitch_auth SET broadcaster_id = ?, broadcaster_login = ?, broadcaster_display_name = ?, updated_at = ? WHERE id = 1`,
      )
      .run(input.id, input.login, input.displayName, new Date().toISOString());
    return this.get();
  }

  clear(): void {
    this.sqlite.prepare("DELETE FROM twitch_auth WHERE id = 1").run();
  }
}

export class TwitchClient {
  constructor(private readonly tokens: TwitchTokenStore) {}

  get clientId(): string | undefined {
    return process.env.TWITCH_CLIENT_ID;
  }

  get clientSecret(): string | undefined {
    return process.env.TWITCH_CLIENT_SECRET;
  }

  get redirectUri(): string {
    return (
      process.env.TWITCH_REDIRECT_URI ||
      "http://localhost:5000/api/twitch/callback"
    );
  }

  get hasCredentials(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  authorizeUrl(state?: string): string | null {
    if (!this.clientId) return null;
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: TWITCH_SCOPES.join(" "),
      force_verify: "true",
    });
    if (state) params.set("state", state);
    return `${ID_BASE}/oauth2/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<TwitchTokenRecord> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error("Twitch client credentials are not configured.");
    }
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: this.redirectUri,
    });
    const response = await fetch(`${ID_BASE}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        `Twitch token exchange failed (${response.status}): ${
          (json as any)?.message || JSON.stringify(json)
        }`,
      );
    }
    const data = json as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string[];
    };
    const expiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : null;
    const saved = this.tokens.save({
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      scopes: data.scope ?? TWITCH_SCOPES,
      expiresAt,
    });
    // Best effort enrich with identity from /oauth2/validate
    try {
      const info = await this.validate(saved.accessToken);
      this.tokens.setIdentity({
        userId: info.user_id,
        login: info.login,
        displayName: info.login,
        scopes: info.scopes,
      });
    } catch {
      /* non-fatal */
    }
    return this.tokens.get()!;
  }

  async validate(token: string): Promise<{
    client_id: string;
    login: string;
    user_id: string;
    scopes: string[];
    expires_in: number;
  }> {
    const response = await fetch(`${ID_BASE}/oauth2/validate`, {
      headers: { Authorization: `OAuth ${token}` },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`validate failed (${response.status}): ${text}`);
    }
    return (await response.json()) as any;
  }

  async refresh(refreshToken: string): Promise<TwitchTokenRecord> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error("Twitch client credentials are not configured.");
    }
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    const response = await fetch(`${ID_BASE}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        `Twitch refresh failed (${response.status}): ${
          (json as any)?.message || JSON.stringify(json)
        }`,
      );
    }
    const data = json as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string[];
    };
    const expiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : null;
    const existing = this.tokens.get();
    return this.tokens.save({
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      scopes: data.scope ?? (existing?.scopes ? existing.scopes.split(" ") : TWITCH_SCOPES),
      userId: existing?.userId ?? undefined,
      login: existing?.login ?? undefined,
      displayName: existing?.displayName ?? undefined,
      expiresAt,
    });
  }

  /**
   * Returns the current token, refreshing if expired or close to expiry.
   * Throws if no token is stored.
   */
  async getValidToken(): Promise<TwitchTokenRecord> {
    const record = this.tokens.get();
    if (!record) throw new Error("No Twitch token stored.");
    const skew = 60_000; // refresh if expiring in <= 60s
    const expiringSoon =
      record.expiresAt !== null && record.expiresAt - Date.now() <= skew;
    if (!expiringSoon) {
      // Validate to be safe — invalidates if token was revoked.
      try {
        const info = await this.validate(record.accessToken);
        // Refresh expiresAt approximation if missing
        if (record.expiresAt === null) {
          this.tokens.save({
            accessToken: record.accessToken,
            refreshToken: record.refreshToken,
            scopes: info.scopes,
            userId: info.user_id,
            login: info.login,
            displayName: record.displayName ?? info.login,
            expiresAt: Date.now() + info.expires_in * 1000,
          });
        }
        return this.tokens.get()!;
      } catch {
        // fall through to refresh attempt
      }
    }
    if (!record.refreshToken) {
      throw new Error("Token expired and no refresh token available.");
    }
    return this.refresh(record.refreshToken);
  }

  async helix<T = any>(
    method: string,
    path: string,
    options: { query?: Record<string, string | undefined>; body?: any } = {},
  ): Promise<{ status: number; ok: boolean; data: T | null; raw: string }> {
    if (!this.clientId) throw new Error("TWITCH_CLIENT_ID is not configured.");
    const token = await this.getValidToken();
    const params = new URLSearchParams();
    if (options.query) {
      for (const [k, v] of Object.entries(options.query)) {
        if (v !== undefined && v !== null && v !== "") params.append(k, v);
      }
    }
    const qs = params.toString();
    const url = `${HELIX_BASE}${path}${qs ? `?${qs}` : ""}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token.accessToken}`,
      "Client-Id": this.clientId,
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";

    const response = await fetch(url, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const raw = await response.text();
    let data: any = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = null;
      }
    }
    return { status: response.status, ok: response.ok, data, raw };
  }

  async resolveUserByLogin(login: string): Promise<{
    id: string;
    login: string;
    display_name: string;
  } | null> {
    const result = await this.helix<{ data: Array<{ id: string; login: string; display_name: string }> }>(
      "GET",
      "/users",
      { query: { login: login.toLowerCase() } },
    );
    if (!result.ok || !result.data?.data?.length) return null;
    return result.data.data[0];
  }
}
