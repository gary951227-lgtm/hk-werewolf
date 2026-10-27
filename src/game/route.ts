import { rulesText } from "../copy/cantonese.ts";
import { apply, catchUp } from "./engine.ts";
import { parseCommand } from "./parse.ts";
import type { GameState, MessageEvent, Outbound } from "./types.ts";

export interface RouteResult {
  games: GameState[];
  messages: Outbound[];
  changed: boolean;
}

export function routeMessage(games: GameState[], event: MessageEvent): RouteResult {
  if (event.scope === "group") return routeGroup(games, event);
  return routeDm(games, event);
}

export function routeTick(games: GameState[], now: number): RouteResult {
  const messages: Outbound[] = [];
  let changed = false;
  const next = games.map((game) => {
    const result = catchUp(game, now);
    if (!result.changed || !result.state) return game;
    changed = true;
    messages.push(...result.messages);
    return result.state;
  });
  return { games: changed ? next : games, messages, changed };
}

function routeGroup(games: GameState[], event: MessageEvent): RouteResult {
  const groupJid = event.groupJid || "";
  const index = games.findIndex((game) => game.groupJid === groupJid);
  const command = parseCommand(event.text, event.mentionedJids);
  if (command?.type === "join") {
    const busy = games.find((game) =>
      game.groupJid !== groupJid
      && game.phase !== "ended"
      && game.players.some((player) => player.jid === event.actorJid),
    );
    if (busy) {
      return {
        games,
        changed: false,
        messages: [{ jid: groupJid, text: "你而家喺另一局，未完唔好加入。" }],
      };
    }
  }
  const result = apply(index >= 0 ? games[index]! : null, event);
  return replace(games, index, result.state, result.messages, result.changed, groupJid);
}

function routeDm(games: GameState[], event: MessageEvent): RouteResult {
  const index = games.findIndex((game) =>
    game.phase !== "ended"
    && game.phase !== "lobby"
    && game.players.some((player) => player.jid === event.actorJid),
  );
  if (index < 0) {
    if (parseCommand(event.text, event.mentionedJids)?.type === "rules") {
      return { games, messages: [{ jid: event.actorJid, text: rulesText() }], changed: false };
    }
    return { games, messages: [], changed: false };
  }
  const result = apply(games[index]!, event);
  return replace(games, index, result.state, result.messages, result.changed, games[index]!.groupJid);
}

function replace(
  games: GameState[],
  index: number,
  state: GameState | null,
  messages: Outbound[],
  changed: boolean,
  groupJid: string,
): RouteResult {
  if (!changed) return { games, messages, changed: false };
  const next = games.slice();
  if (!state) {
    if (index >= 0) next.splice(index, 1);
    return { games: next, messages, changed: true };
  }
  const stored = { ...state, groupJid: state.groupJid || groupJid };
  if (index >= 0) next[index] = stored;
  else next.push(stored);
  return { games: next, messages, changed: true };
}
