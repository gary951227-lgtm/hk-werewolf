import QRCode from "qrcode";
import { hasRegisteredSession } from "./wa/auth.ts";
import { openWhatsApp, withSession } from "./wa/session.ts";
import { forgetOldSeen, handleInbound, handleTick } from "./store.ts";

export interface Env {
  DB: D1Database;
  ADMIN_TOKEN: string;
}

const LISTEN_MS = 12_000;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok");
    if (!authorized(request, env, url)) return new Response("未授權", { status: 401 });

    if (url.pathname === "/link") {
      ctx.waitUntil(remember(env.DB, "last_request", new Date().toISOString()));
      return linkResponse(env, ctx);
    }

    if (url.pathname === "/poll") {
      ctx.waitUntil(remember(env.DB, "last_request", new Date().toISOString()));
      const result = await runCycle(env, { force: true, listenMs: LISTEN_MS });
      return Response.json(result);
    }

    return new Response(await adminHtml(env), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCycle(env, { force: false, listenMs: LISTEN_MS }));
  },
};

async function linkResponse(env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!(await acquire(env.DB))) {
    return new Response(await adminHtml(env), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  const session = await openWhatsApp(env.DB);
  await session.waitForQr(20_000);
  const html = await adminHtml(env, session.qr());
  ctx.waitUntil((async () => {
    try {
      await forgetOldSeen(env.DB, Date.now());
      await session.pump(40_000, {
        onMessage: (message, send) => handleInbound(env.DB, message, send, Date.now()),
        onIdle: (send) => handleTick(env.DB, send, Date.now()),
      });
      await remember(env.DB, "last_poll", new Date().toISOString());
    } finally {
      await session.finish();
      await release(env.DB);
    }
  })());
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

async function runCycle(env: Env, options: { force: boolean; listenMs: number }): Promise<{
  status: string;
  qr?: string;
  error?: string;
}> {
  if (!options.force && !(await hasRegisteredSession(env.DB))) {
    return { status: "need-link" };
  }
  if (!(await acquire(env.DB))) return { status: "busy" };
  try {
    const now = Date.now();
    await forgetOldSeen(env.DB, now);
    const result = await withSession(env.DB, options.listenMs, {
      onMessage: (message, send) => handleInbound(env.DB, message, send, Date.now()),
      onIdle: (send) => handleTick(env.DB, send, Date.now()),
    });
    await remember(env.DB, "last_poll", new Date().toISOString());
    return result;
  } finally {
    await release(env.DB);
  }
}

function authorized(request: Request, env: Env, url: URL): boolean {
  const header = request.headers.get("authorization");
  const bearer = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const token = url.searchParams.get("token") || request.headers.get("x-admin-token") || bearer;
  return Boolean(env.ADMIN_TOKEN) && token === env.ADMIN_TOKEN;
}

async function acquire(db: D1Database): Promise<boolean> {
  const row = await db.prepare("SELECT value FROM meta WHERE key = 'lock'").first<{ value: string }>();
  const now = Date.now();
  if (row && now - Number(row.value) < 90_000) return false;
  await remember(db, "lock", String(now));
  return true;
}

async function release(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM meta WHERE key = 'lock'").run();
}

async function remember(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).bind(key, value).run();
}

async function meta(db: D1Database, key: string): Promise<string> {
  const row = await db.prepare("SELECT value FROM meta WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? "";
}

async function adminHtml(env: Env, freshQr?: string): Promise<string> {
  const qr = freshQr || await meta(env.DB, "qr");
  const status = await meta(env.DB, "status");
  const lastPoll = await meta(env.DB, "last_poll");
  const lastError = await meta(env.DB, "last_error");
  const linked = status === "open" || await hasRegisteredSession(env.DB);
  const svg = !linked && qr ? await QRCode.toString(qr, { type: "svg", margin: 1, width: 280 }) : "";
  const tokenHint = "網址後面加 ?token=你的ADMIN_TOKEN";
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>狼人殺機械人</title>
  <style>
    body { font-family: -apple-system, "PingFang HK", sans-serif; margin: 2rem auto; max-width: 40rem; line-height: 1.5; }
    code { background: #f2f2f2; padding: 0 .3rem; }
  </style>
</head>
<body>
  <h1>香港廣東話狼人殺</h1>
  <p>${linked ? "WhatsApp 已連過線。每分鐘會短線上線聽訊息。" : "未連線。用有 token 嘅 /link 產生二維碼，然後用 WhatsApp「已連結的裝置」掃。"}</p>
  ${svg}
  <p>狀態：${status || "未知"}。上次輪詢：${lastPoll || "未有"}。</p>
  ${lastError ? `<p>上次錯誤：${escapeHtml(lastError)}</p>` : ""}
  <p>${tokenHint}。例如 <code>/link?token=...</code> 同 <code>/poll?token=...</code>。</p>
  <p>群組指令：開局、加入、退出、開始、狀態、規則、結束討論、投票 3、結束。夜晚行動要私訊機械人。</p>
  <p>免費 Workers 每次只有 10 毫秒 CPU。連線同解密可能超時，訊息會遲，或者要等下一次輪詢先收到。</p>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);
}
