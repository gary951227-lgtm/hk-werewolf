import {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeWASocket,
} from "whatsapp-cloudflare-workers";
import pino from "pino";
import { useD1AuthState } from "./auth.ts";
import { inboundFromWa, type Inbound } from "./inbound.ts";

export type Send = (jid: string, text: string) => Promise<void>;

export interface SessionHooks {
  onMessage: (message: Inbound, send: Send) => Promise<void>;
  onIdle?: (send: Send) => Promise<void>;
}

export interface SessionResult {
  status: "open" | "qr" | "closed";
  qr?: string;
  error?: string;
}

const DEFAULT_VERSION: [number, number, number] = [2, 3000, 1027934701];

export async function withSession(
  db: D1Database,
  listenMs: number,
  hooks: SessionHooks,
): Promise<SessionResult> {
  const session = await openWhatsApp(db);
  try {
    await session.pump(listenMs, hooks);
    return session.result();
  } finally {
    await session.finish();
  }
}

export async function openWhatsApp(db: D1Database) {
  const { state, saveCreds } = await useD1AuthState(db);
  const logger = pino({ level: "silent" });
  let version = DEFAULT_VERSION;
  try {
    const latest = await fetchLatestBaileysVersion();
    if (Array.isArray(latest.version)) version = latest.version as [number, number, number];
  } catch {
    version = DEFAULT_VERSION;
  }

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    browser: Browsers.macOS("HK Werewolf"),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  });

  let qr: string | undefined;
  let opened = false;
  let failure: string | undefined;
  const queue: Inbound[] = [];

  sock.ev.on("creds.update", () => {
    void saveCreds();
  });
  sock.ev.on("connection.update", (update) => {
    if (update.qr) qr = update.qr;
    if (update.connection === "open") opened = true;
    if (update.connection) console.log("wa connection", update.connection);
    if (update.connection === "close") {
      const error = update.lastDisconnect?.error as { message?: string; output?: { statusCode?: number } } | undefined;
      const code = error?.output?.statusCode;
      failure = code === DisconnectReason.loggedOut
        ? "logged-out"
        : `close ${code ?? "?"} ${error?.message ?? ""}`.slice(0, 300);
      console.log("wa disconnect", failure);
    }
  });
  sock.ev.on("messages.upsert", (upsert) => {
    for (const message of upsert.messages) {
      const inbound = inboundFromWa(message);
      if (inbound) queue.push(inbound);
    }
  });

  const send: Send = async (jid, text) => {
    await sock.sendMessage(jid, { text });
  };

  return {
    qr: () => qr,
    async waitForQr(ms: number) {
      const started = Date.now();
      while (Date.now() - started < ms && !qr && !opened && !failure) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    },
    async pump(ms: number, hooks: SessionHooks) {
      const started = Date.now();
      try {
        while (Date.now() - started < ms) {
          const batch = queue.splice(0, queue.length);
          for (const message of batch) await hooks.onMessage(message, send);
          if (failure) break;
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
        if (opened && hooks.onIdle) await hooks.onIdle(send);
        const leftover = queue.splice(0, queue.length);
        for (const message of leftover) await hooks.onMessage(message, send);
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
    },
    result(): SessionResult {
      return { status: opened ? "open" : qr ? "qr" : "closed", qr, error: failure };
    },
    async finish() {
      try {
        sock.end(undefined);
      } catch {
        // The socket may already be closed.
      }
      await saveCreds();
      if (qr) await remember(db, "qr", qr);
      await remember(db, "status", opened ? "open" : qr ? "qr" : "closed");
      if (failure) await remember(db, "last_error", failure);
    },
  };
}

async function remember(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).bind(key, value).run();
}
