import { routeMessage, routeTick } from "./game/route.ts";
import type { GameState, MessageEvent } from "./game/types.ts";
import type { Inbound } from "./wa/inbound.ts";
import type { Send } from "./wa/session.ts";

export async function loadGames(db: D1Database): Promise<GameState[]> {
  const rows = await db.prepare("SELECT data FROM games").all<{ data: string }>();
  return (rows.results ?? []).map((row) => JSON.parse(row.data) as GameState);
}

export async function saveGames(db: D1Database, games: GameState[]): Promise<void> {
  if (games.length === 0) return;
  const statements = games.map((game) => db.prepare(
    "INSERT INTO games (group_jid, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(group_jid) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
  ).bind(game.groupJid, JSON.stringify(game), Date.now()));
  for (let i = 0; i < statements.length; i += 40) {
    await db.batch(statements.slice(i, i + 40));
  }
}

export async function rememberSeen(db: D1Database, id: string, now: number): Promise<boolean> {
  const existing = await db.prepare("SELECT id FROM seen WHERE id = ?").bind(id).first();
  if (existing) return false;
  await db.prepare("INSERT INTO seen (id, created_at) VALUES (?, ?)").bind(id, now).run();
  return true;
}

export async function forgetOldSeen(db: D1Database, now: number): Promise<void> {
  await db.prepare("DELETE FROM seen WHERE created_at < ?").bind(now - 2 * 24 * 60 * 60 * 1000).run();
}

export async function handleInbound(db: D1Database, inbound: Inbound, send: Send, now: number): Promise<void> {
  if (!(await rememberSeen(db, inbound.id, now))) return;
  const games = await loadGames(db);
  const event: MessageEvent = {
    kind: "message",
    scope: inbound.scope,
    groupJid: inbound.groupJid,
    actorJid: inbound.actorJid,
    actorName: inbound.actorName,
    text: inbound.text,
    mentionedJids: inbound.mentionedJids,
    now,
  };
  const result = routeMessage(games, event);
  if (result.changed) await saveGames(db, result.games);
  for (const message of result.messages) {
    await send(message.jid, message.text);
  }
}

export async function handleTick(db: D1Database, send: Send, now: number): Promise<void> {
  const games = await loadGames(db);
  const result = routeTick(games, now);
  if (result.changed) await saveGames(db, result.games);
  for (const message of result.messages) {
    await send(message.jid, message.text);
  }
}
