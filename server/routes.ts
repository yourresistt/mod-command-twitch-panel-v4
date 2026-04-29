import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import { z } from "zod";
import { storage, sqliteDb } from "./storage";
import { commandUpdateSchema, moderationActionSchema } from "@shared/schema";
import { TWITCH_SCOPES, TwitchClient, TwitchTokenStore } from "./twitch";
import { EventSubManager, LiveQueueStore } from "./eventsub";

const tokenStore = new TwitchTokenStore(sqliteDb);
const twitch = new TwitchClient(tokenStore);
const liveQueue = new LiveQueueStore(sqliteDb);
const eventSub = new EventSubManager(twitch, tokenStore, liveQueue);

const demoMessages = [
  {
    id: "msg_901",
    user: "NightFox_77",
    risk: 92,
    level: "critical",
    message: "spam link removed by guard: buy followers now",
    reason: "Suspicious link + repeated phrase",
    seenBefore: "3 flags in this stream",
    accountAge: "18 days",
    badges: ["new chatter", "link risk"],
  },
  {
    id: "msg_902",
    user: "PixelRage",
    risk: 73,
    level: "high",
    message: "stop camping you absolute bot",
    reason: "Toxic language pattern",
    seenBefore: "1 timeout last week",
    accountAge: "2 years",
    badges: ["returning", "heated"],
  },
  {
    id: "msg_903",
    user: "clip_mage",
    risk: 41,
    level: "medium",
    message: "can I post a clip link? it is from this stream",
    reason: "Link request needs mod approval",
    seenBefore: "clean history",
    accountAge: "9 months",
    badges: ["subscriber", "link request"],
  },
  {
    id: "msg_904",
    user: "EchoGuest",
    risk: 64,
    level: "high",
    message: "same copy-paste message sent five times",
    reason: "Flooding",
    seenBefore: "2 deleted messages today",
    accountAge: "4 days",
    badges: ["new chatter", "flood"],
  },
];

const channelInputSchema = z.object({
  channelLogin: z.string().min(1).max(64),
});

function statusPayload() {
  const record = tokenStore.get();
  const connected = Boolean(record?.accessToken && record?.userId);
  const liveItems = liveQueue.list();
  const eventSubState = eventSub.getStatus();
  return {
    channel: record?.broadcasterLogin ?? "demo_channel",
    mode: connected ? (record?.broadcasterId ? "live" : "live-needs-channel") : "demo",
    connected,
    viewers: 847,
    chatters: 219,
    pending: liveItems.length + demoMessages.length,
    livePending: liveItems.length,
    actionsToday: 38,
    automod: "guarded",
    eventSub: eventSubState.status,
    hasTwitchCredentials: twitch.hasCredentials,
    oauthUrl: twitch.authorizeUrl(),
    requiredEnv: ["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET", "TWITCH_REDIRECT_URI"],
    redirectUri: twitch.redirectUri,
    scopes: TWITCH_SCOPES,
    moderator: record
      ? {
          id: record.userId,
          login: record.login,
          displayName: record.displayName,
          scopes: record.scopes ? record.scopes.split(" ") : [],
        }
      : null,
    broadcaster: record?.broadcasterId
      ? {
          id: record.broadcasterId,
          login: record.broadcasterLogin,
          displayName: record.broadcasterDisplayName,
        }
      : null,
    canModerate: connected && Boolean(record?.broadcasterId),
    note: connected
      ? record?.broadcasterId
        ? "Live mode active — Helix moderation calls are enabled."
        : "Authorized. Configure a broadcaster channel to enable Helix calls."
      : "Demo mode is active until Twitch OAuth credentials are added and the moderator authorizes.",
  };
}

function callbackHtml(opts: { title: string; body: string; ok: boolean }): string {
  const accent = opts.ok ? "#7c5cff" : "#ff5c7c";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${opts.title}</title>
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      :root { color-scheme: dark; }
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; background: #0b0b12; color: #e7e7f0; margin: 0; min-height: 100vh; display: grid; place-items: center; }
      main { max-width: 560px; padding: 40px; border: 1px solid #25253a; border-radius: 16px; background: linear-gradient(180deg, #14141f, #10101a); box-shadow: 0 30px 60px rgba(0,0,0,0.4); }
      h1 { margin: 0 0 12px; font-size: 22px; }
      p { color: #b6b6c8; line-height: 1.55; }
      a.btn { display: inline-flex; align-items: center; gap: 8px; margin-top: 18px; padding: 10px 16px; border-radius: 10px; background: ${accent}; color: #0b0b12; text-decoration: none; font-weight: 600; }
      .dot { width: 10px; height: 10px; border-radius: 50%; background: ${accent}; box-shadow: 0 0 12px ${accent}; display: inline-block; margin-right: 10px; }
    </style>
  </head>
  <body>
    <main>
      <h1><span class="dot"></span>${opts.title}</h1>
      <p>${opts.body}</p>
      <a class="btn" href="/?twitch=${opts.ok ? "connected" : "error"}">Back to dashboard</a>
    </main>
  </body>
</html>`;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  app.get("/api/status", async (_req, res) => {
    res.json(statusPayload());
  });

  app.get("/api/moderation/queue", async (_req, res) => {
    const live = liveQueue.list();
    const demo = demoMessages.map((m) => ({ ...m, source: "demo" as const, messageId: null }));
    res.json([...live, ...demo]);
  });

  app.get("/api/moderation/events", async (_req, res) => {
    res.json(await storage.listModerationEvents());
  });

  app.post("/api/moderation/action", async (req, res) => {
    const parsed = moderationActionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.flatten() });
    }

    const record = tokenStore.get();
    const liveReady = Boolean(record?.accessToken && record?.userId && record?.broadcasterId);
    const moderator = record?.displayName ?? record?.login ?? "ModLead";
    const action = parsed.data.action;
    const isDemoMessageId =
      typeof parsed.data.messageId === "string" && parsed.data.messageId.startsWith("msg_");

    let outcome: "live" | "demo" | "error" = liveReady ? "live" : "demo";
    let twitchSummary: string | null = null;
    let twitchError: string | null = null;
    let httpStatus = 200;

    if (liveReady) {
      try {
        if (action === "ban" || action === "timeout_60" || action === "timeout_600") {
          const target = await twitch.resolveUserByLogin(parsed.data.targetUser);
          if (!target) {
            outcome = "error";
            twitchError = `Could not resolve Twitch user "${parsed.data.targetUser}".`;
            httpStatus = 404;
          } else {
            const data: any = { user_id: target.id, reason: parsed.data.reason };
            if (action === "timeout_60") data.duration = 60;
            if (action === "timeout_600") data.duration = 600;
            const result = await twitch.helix("POST", "/moderation/bans", {
              query: {
                broadcaster_id: record!.broadcasterId!,
                moderator_id: record!.userId!,
              },
              body: { data },
            });
            if (result.ok) {
              twitchSummary = `${action} applied to ${target.login} (id ${target.id}).`;
            } else {
              outcome = "error";
              twitchError = `Helix /moderation/bans returned ${result.status}: ${result.raw}`;
              httpStatus = result.status >= 400 ? result.status : 502;
            }
          }
        } else if (action === "delete") {
          if (!parsed.data.messageId || isDemoMessageId) {
            outcome = "error";
            twitchError =
              "Delete needs a real Twitch chat message id from EventSub or IRC. The demo queue uses placeholder ids.";
            httpStatus = 409;
          } else {
            const result = await twitch.helix("DELETE", "/moderation/chat", {
              query: {
                broadcaster_id: record!.broadcasterId!,
                moderator_id: record!.userId!,
                message_id: parsed.data.messageId,
              },
            });
            if (result.ok) {
              twitchSummary = `Message ${parsed.data.messageId} deleted.`;
              liveQueue.remove(parsed.data.messageId);
            } else {
              outcome = "error";
              twitchError = `Helix /moderation/chat returned ${result.status}: ${result.raw}`;
              httpStatus = result.status >= 400 ? result.status : 502;
            }
          }
        } else if (action === "warn") {
          twitchSummary = "Warning recorded locally. Twitch warn endpoint is not used in this build.";
        }
      } catch (err) {
        outcome = "error";
        twitchError = errorMessage(err);
        httpStatus = 502;
      }
    }

    const created = await storage.createModerationEvent({
      targetUser: parsed.data.targetUser,
      action: parsed.data.action,
      reason:
        outcome === "error"
          ? `${parsed.data.reason} — ${twitchError ?? "live call failed"}`
          : parsed.data.reason,
      moderator,
      createdAt: new Date().toISOString(),
    });

    res.status(httpStatus).json({
      event: created,
      twitchMode: outcome,
      twitchSummary,
      twitchError,
      liveReady,
      ok: outcome !== "error",
    });
  });

  app.get("/api/commands", async (_req, res) => {
    res.json(await storage.listCommands());
  });

  app.post("/api/commands", async (req, res) => {
    const parsed = commandUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.flatten() });
    }

    const command = await storage.upsertCommand(parsed.data);
    res.json(command);
  });

  app.get("/api/twitch/oauth-url", async (_req, res) => {
    const oauthUrl = twitch.authorizeUrl();
    if (!oauthUrl) {
      return res.status(428).json({
        message: "TWITCH_CLIENT_ID is not configured yet.",
        requiredEnv: ["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET", "TWITCH_REDIRECT_URI"],
      });
    }
    res.json({ oauthUrl, scopes: TWITCH_SCOPES, redirectUri: twitch.redirectUri });
  });

  app.get("/api/twitch/status", async (_req, res) => {
    const record = tokenStore.get();
    if (!record) {
      return res.json({
        connected: false,
        hasCredentials: twitch.hasCredentials,
        oauthUrl: twitch.authorizeUrl(),
        redirectUri: twitch.redirectUri,
        scopes: TWITCH_SCOPES,
        moderator: null,
        broadcaster: null,
        canModerate: false,
        error: null,
      });
    }
    let identity = {
      id: record.userId,
      login: record.login,
      displayName: record.displayName,
      scopes: record.scopes ? record.scopes.split(" ") : [],
    };
    let error: string | null = null;
    try {
      const valid = await twitch.validate(record.accessToken);
      identity = {
        id: valid.user_id,
        login: valid.login,
        displayName: record.displayName ?? valid.login,
        scopes: valid.scopes,
      };
      tokenStore.setIdentity({
        userId: valid.user_id,
        login: valid.login,
        displayName: record.displayName ?? valid.login,
        scopes: valid.scopes,
      });
    } catch (err) {
      // try a refresh
      if (record.refreshToken) {
        try {
          const refreshed = await twitch.refresh(record.refreshToken);
          identity = {
            id: refreshed.userId,
            login: refreshed.login,
            displayName: refreshed.displayName,
            scopes: refreshed.scopes ? refreshed.scopes.split(" ") : [],
          };
        } catch (refreshErr) {
          error = `Token invalid and refresh failed: ${errorMessage(refreshErr)}`;
        }
      } else {
        error = `Token invalid: ${errorMessage(err)}`;
      }
    }

    const after = tokenStore.get();
    res.json({
      connected: Boolean(after?.accessToken && identity.id) && !error,
      hasCredentials: twitch.hasCredentials,
      oauthUrl: twitch.authorizeUrl(),
      redirectUri: twitch.redirectUri,
      scopes: TWITCH_SCOPES,
      moderator: identity,
      broadcaster: after?.broadcasterId
        ? {
            id: after.broadcasterId,
            login: after.broadcasterLogin,
            displayName: after.broadcasterDisplayName,
          }
        : null,
      canModerate: Boolean(after?.accessToken && identity.id && after?.broadcasterId) && !error,
      tokenUpdatedAt: after?.updatedAt ?? null,
      error,
    });
  });

  app.post("/api/twitch/disconnect", async (_req, res) => {
    eventSub.stop();
    liveQueue.clear();
    tokenStore.clear();
    res.json({ ok: true });
  });

  app.post("/api/twitch/channel", async (req, res) => {
    const parsed = channelInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.flatten() });
    }
    const record = tokenStore.get();
    if (!record) {
      return res.status(401).json({ message: "Twitch is not connected. Authorize first." });
    }
    try {
      const user = await twitch.resolveUserByLogin(parsed.data.channelLogin);
      if (!user) {
        return res.status(404).json({ message: `Channel "${parsed.data.channelLogin}" not found.` });
      }
      const previous = tokenStore.get();
      const updated = tokenStore.setBroadcaster({
        id: user.id,
        login: user.login,
        displayName: user.display_name,
      });
      // If broadcaster changed, stop any running EventSub and clear stale queue.
      if (previous?.broadcasterId && previous.broadcasterId !== user.id) {
        eventSub.stop();
        liveQueue.clear();
      }
      res.json({
        ok: true,
        broadcaster: {
          id: updated?.broadcasterId,
          login: updated?.broadcasterLogin,
          displayName: updated?.broadcasterDisplayName,
        },
      });
    } catch (err) {
      res.status(502).json({ message: errorMessage(err) });
    }
  });

  app.get("/api/twitch/callback", async (req: Request, res: Response) => {
    const error = typeof req.query.error === "string" ? req.query.error : null;
    const errorDescription =
      typeof req.query.error_description === "string"
        ? req.query.error_description
        : null;
    if (error) {
      return res
        .status(400)
        .send(
          callbackHtml({
            ok: false,
            title: "Twitch authorization was cancelled",
            body: `${error}${errorDescription ? `: ${errorDescription}` : ""}`,
          }),
        );
    }
    const code = typeof req.query.code === "string" ? req.query.code : null;
    if (!code) {
      return res.status(400).send(
        callbackHtml({
          ok: false,
          title: "Missing authorization code",
          body: "The Twitch redirect did not include a code parameter.",
        }),
      );
    }
    if (!twitch.hasCredentials) {
      return res.status(500).send(
        callbackHtml({
          ok: false,
          title: "Server credentials missing",
          body: "TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET must be set in the server environment.",
        }),
      );
    }
    try {
      const record = await twitch.exchangeCode(code);
      return res.send(
        callbackHtml({
          ok: true,
          title: "Twitch connected",
          body: `Authorized as ${record.login ?? "moderator"}. You can close this window or return to the dashboard.`,
        }),
      );
    } catch (err) {
      return res.status(500).send(
        callbackHtml({
          ok: false,
          title: "Token exchange failed",
          body: errorMessage(err),
        }),
      );
    }
  });

  app.get("/api/twitch/eventsub/status", async (_req, res) => {
    res.json(eventSub.getStatus());
  });

  app.post("/api/twitch/eventsub/start", async (_req, res) => {
    const result = await eventSub.start();
    if (!result.ok) {
      return res.status(result.status).json({ ok: false, message: result.message });
    }
    res.json({ ok: true, status: eventSub.getStatus() });
  });

  app.post("/api/twitch/eventsub/stop", async (_req, res) => {
    eventSub.stop();
    res.json({ ok: true, status: eventSub.getStatus() });
  });

  // Best-effort auto-start when token + broadcaster are already configured at boot.
  setTimeout(() => {
    const record = tokenStore.get();
    if (record?.userId && record?.broadcasterId) {
      eventSub.start().then((result) => {
        if (!result.ok) {
          console.warn(`[eventsub] auto-start skipped: ${result.message}`);
        }
      });
    }
  }, 500);

  return httpServer;
}
