import {
  dawnText,
  dayText,
  hunterPrompt,
  label,
  revealText,
  roleDm,
  roster,
  rulesText,
  seerPrompt,
  seerResult,
  statusText,
  voteText,
  witchAttackLine,
  witchPrompt,
  wolfPrompt,
  wolfTally,
} from "../copy/cantonese.ts";
import { parseCommand } from "./parse.ts";
import { assignRoles, majorityTarget, winnerOf } from "./roles.ts";
import type {
  ApplyResult,
  Command,
  GameState,
  MessageEvent,
  Outbound,
  Player,
  Role,
  Target,
  TickEvent,
} from "./types.ts";

export const PHASE_MS = {
  wolves: 90_000,
  seer: 60_000,
  witch: 60_000,
  day: 180_000,
  vote: 90_000,
  hunter: 45_000,
} as const;

const NIGHT_COMMANDS = new Set(["kill", "see", "save", "poison", "skip", "shoot", "pass_shot"]);
const GROUP_COMMANDS = new Set(["open", "join", "leave", "start", "end_talk", "vote", "end"]);

export function apply(
  state: GameState | null,
  event: MessageEvent | TickEvent,
  rng: () => number = Math.random,
): ApplyResult {
  if (event.kind === "tick") {
    if (!state) return { state: null, messages: [], changed: false };
    return onTick(clone(state), event.now);
  }

  const command = parseCommand(event.text, event.mentionedJids);
  if (!command) return { state, messages: [], changed: false };
  if (command.type === "rules") {
    return { state, messages: [{ jid: replyTo(state, event), text: rulesText() }], changed: false };
  }
  if (!state || state.phase === "ended") {
    if (command.type === "open" && event.scope === "group") {
      return openTable(event);
    }
    if (command.type === "status") {
      return { state, messages: [{ jid: event.actorJid, text: "未有局。打「開局」先。" }], changed: false };
    }
    if (isKnown(command)) {
      return {
        state,
        messages: [{ jid: event.scope === "group" ? event.actorJid : event.actorJid, text: "未有局。喺群組打「開局」先。" }],
        changed: false,
      };
    }
    return { state, messages: [], changed: false };
  }

  const next = clone(state);
  touchName(next, event);
  const messages: Outbound[] = [];
  const scopeError = wrongScope(command, event);
  if (scopeError) {
    messages.push({ jid: event.actorJid, text: scopeError });
    return { state: next, messages, changed: nameChanged(state, next) };
  }

  if (command.type === "status") {
    messages.push({ jid: replyTo(next, event), text: renderStatus(next, event.now) });
    return { state: next, messages, changed: nameChanged(state, next) };
  }

  switch (next.phase) {
    case "lobby":
      onLobby(next, event, command, messages, rng);
      break;
    case "night_wolves":
      onWolves(next, event, command, messages);
      break;
    case "night_seer":
      onSeer(next, event, command, messages);
      break;
    case "night_witch":
      onWitch(next, event, command, messages);
      break;
    case "hunter":
      onHunter(next, event, command, messages);
      break;
    case "day":
      onDay(next, event, command, messages);
      break;
    case "vote":
      onVote(next, event, command, messages);
      break;
    default:
      break;
  }

  return { state: next, messages, changed: true };
}

export function catchUp(state: GameState, now: number): ApplyResult {
  let current = state;
  const messages: Outbound[] = [];
  let changed = false;
  for (let i = 0; i < 12; i++) {
    if (current.deadline == null || current.deadline > now || current.phase === "ended") break;
    const step = apply(current, { kind: "tick", now });
    messages.push(...step.messages);
    changed = changed || step.changed;
    if (!step.state || !step.changed) break;
    current = step.state;
  }
  return { state: current, messages, changed };
}

function onTick(state: GameState, now: number): ApplyResult {
  if (state.deadline == null || now < state.deadline || state.phase === "ended" || state.phase === "lobby") {
    return { state, messages: [], changed: false };
  }
  const messages: Outbound[] = [];
  switch (state.phase) {
    case "night_wolves":
      closeWolves(state, now, messages);
      break;
    case "night_seer":
      enterWitch(state, now, messages);
      break;
    case "night_witch":
      state.witchAction = "skip";
      resolveDawn(state, now, messages);
      break;
    case "hunter":
      passHunter(state, now, messages);
      break;
    case "day":
      enterVote(state, now, messages);
      break;
    case "vote":
      closeVote(state, now, messages);
      break;
    default:
      return { state, messages, changed: false };
  }
  return { state, messages, changed: true };
}

function openTable(event: MessageEvent): ApplyResult {
  const state: GameState = {
    groupJid: event.groupJid || "",
    hostJid: event.actorJid,
    phase: "lobby",
    players: [player(event.actorJid, event.actorName, 1)],
    night: 0,
    wolfVotes: {},
    saveUsed: false,
    poisonUsed: false,
    witchAction: null,
    poisonTarget: null,
    votes: {},
    revote: false,
    deadline: null,
    winner: null,
    hunterFrom: null,
    wolfTarget: null,
  };
  return {
    state,
    changed: true,
    messages: [{
      jid: state.groupJid,
      text: `開枱喇！${event.actorName || "主持人"} 已經加入。而家 1 人。其他人打「加入」。夠 6 人就由主持人打「開始」。`,
    }],
  };
}

function onLobby(
  state: GameState,
  event: MessageEvent,
  command: Command,
  messages: Outbound[],
  rng: () => number,
): void {
  if (command.type === "open") {
    messages.push({ jid: state.groupJid, text: "而家有局開緊。想玩就打「加入」。" });
    return;
  }
  if (command.type === "join") {
    if (state.players.some((item) => item.jid === event.actorJid)) {
      messages.push({ jid: state.groupJid, text: "你已經喺度。" });
      return;
    }
    if (state.players.length >= 12) {
      messages.push({ jid: state.groupJid, text: "滿晒，最多 12 人。" });
      return;
    }
    state.players.push(player(event.actorJid, event.actorName, state.players.length + 1));
    messages.push({
      jid: state.groupJid,
      text: `${event.actorName || "有人"} 加入咗。而家 ${state.players.length} 人。`,
    });
    return;
  }
  if (command.type === "leave") {
    const staying = state.players.filter((item) => item.jid !== event.actorJid);
    if (staying.length === state.players.length) {
      messages.push({ jid: state.groupJid, text: "你唔喺呢局。" });
      return;
    }
    renumber(staying);
    state.players = staying;
    if (state.players.length === 0) {
      messages.push({ jid: state.groupJid, text: "冇人，局散咗。" });
      state.phase = "ended";
      return;
    }
    if (!state.players.some((item) => item.jid === state.hostJid)) {
      state.hostJid = state.players[0]!.jid;
    }
    messages.push({ jid: state.groupJid, text: `${event.actorName || "有人"} 走咗。而家 ${state.players.length} 人。` });
    return;
  }
  if (command.type === "start") {
    if (event.actorJid !== state.hostJid) {
      messages.push({ jid: state.groupJid, text: "得主持人先可以開始。" });
      return;
    }
    if (state.players.length < 6) {
      messages.push({ jid: state.groupJid, text: `未夠人。而家 ${state.players.length} 人，最少 6 個。` });
      return;
    }
    const roles = assignRoles(state.players.length, rng);
    state.players.forEach((item, index) => {
      item.role = roles[index] ?? "villager";
    });
    for (const item of state.players) {
      const teammates = state.players
        .filter((other) => other.role === "wolf" && other.jid !== item.jid)
        .map((other) => label(other))
        .join("、") || "冇";
      messages.push({ jid: item.jid, text: roleDm(item.role ?? "villager", teammates) });
    }
    messages.push({ jid: state.groupJid, text: "身份私訊咗你哋。天黑請閉眼。" });
    enterNight(state, event.now, messages, false);
    return;
  }
  if (command.type === "end") {
    cancel(state, event, messages);
    return;
  }
  messages.push({ jid: state.groupJid, text: "而家等緊人。可以打「加入」或者「開始」。" });
}

function onWolves(state: GameState, event: MessageEvent, command: Command, messages: Outbound[]): void {
  if (command.type === "end") return cancel(state, event, messages);
  if (command.type !== "kill") {
    messages.push({ jid: event.actorJid, text: "而家係狼人時間。狼人私訊打「殺 3」。" });
    return;
  }
  const wolf = livingRole(state, "wolf").find((item) => item.jid === event.actorJid);
  if (!wolf) {
    messages.push({ jid: event.actorJid, text: "你而家唔使做嘢。" });
    return;
  }
  const target = resolveTarget(state, command.target, false);
  if (!target || !target.alive) {
    messages.push({ jid: event.actorJid, text: "呢個號碼唔得。揀一個在生嘅號碼。" });
    return;
  }
  if (target.role === "wolf") {
    messages.push({ jid: event.actorJid, text: "唔可以殺自己人。" });
    return;
  }
  state.wolfVotes[wolf.jid] = target.number;
  const wolves = livingRole(state, "wolf");
  const lines = wolves
    .filter((item) => state.wolfVotes[item.jid] != null)
    .map((item) => `${label(item)} 投 ${state.wolfVotes[item.jid]} 號`);
  const waiting = wolves.filter((item) => state.wolfVotes[item.jid] == null).map((item) => label(item));
  for (const item of wolves) {
    messages.push({ jid: item.jid, text: wolfTally(lines, waiting) });
  }
  if (waiting.length === 0) closeWolves(state, event.now, messages);
}

function onSeer(state: GameState, event: MessageEvent, command: Command, messages: Outbound[]): void {
  if (command.type === "end") return cancel(state, event, messages);
  const seer = livingRole(state, "seer")[0];
  if (command.type !== "see" || !seer || event.actorJid !== seer.jid) {
    messages.push({ jid: event.actorJid, text: "而家等預言家。預言家私訊打「查 3」。" });
    return;
  }
  const target = resolveTarget(state, command.target, true);
  if (!target) {
    messages.push({ jid: seer.jid, text: "呢個號碼唔得。" });
    return;
  }
  const kind = target.role === "wolf" ? "狼人" : "好人";
  messages.push({ jid: seer.jid, text: seerResult(label(target), kind) });
  enterWitch(state, event.now, messages);
}

function onWitch(state: GameState, event: MessageEvent, command: Command, messages: Outbound[]): void {
  if (command.type === "end") return cancel(state, event, messages);
  const witch = livingRole(state, "witch")[0];
  if (!witch || event.actorJid !== witch.jid) {
    messages.push({ jid: event.actorJid, text: "而家等女巫。" });
    return;
  }
  if (command.type === "save") {
    if (state.saveUsed) {
      messages.push({ jid: witch.jid, text: "解藥用咗。" });
      return;
    }
    if (state.wolfTarget == null) {
      messages.push({ jid: witch.jid, text: "今晚冇人中招，唔使救。" });
      return;
    }
    state.saveUsed = true;
    state.witchAction = "save";
    messages.push({ jid: witch.jid, text: "你用咗解藥。" });
    resolveDawn(state, event.now, messages);
    return;
  }
  if (command.type === "poison") {
    if (state.poisonUsed) {
      messages.push({ jid: witch.jid, text: "毒藥用咗。" });
      return;
    }
    const target = resolveTarget(state, command.target, false);
    if (!target || !target.alive) {
      messages.push({ jid: witch.jid, text: "呢個號碼唔得。" });
      return;
    }
    if (target.jid === witch.jid) {
      messages.push({ jid: witch.jid, text: "唔好毒自己。" });
      return;
    }
    state.poisonUsed = true;
    state.witchAction = "poison";
    state.poisonTarget = target.number;
    messages.push({ jid: witch.jid, text: `你毒咗 ${label(target)}。` });
    resolveDawn(state, event.now, messages);
    return;
  }
  if (command.type === "skip") {
    state.witchAction = "skip";
    messages.push({ jid: witch.jid, text: "你今晚唔用藥。" });
    resolveDawn(state, event.now, messages);
    return;
  }
  messages.push({ jid: witch.jid, text: "打「救」、「毒 3」或者「跳過」。" });
}

function onHunter(state: GameState, event: MessageEvent, command: Command, messages: Outbound[]): void {
  if (command.type === "end") return cancel(state, event, messages);
  const hunter = state.players.find((item) => item.role === "hunter");
  if (!hunter || event.actorJid !== hunter.jid) {
    messages.push({ jid: event.actorJid, text: "而家等獵人。" });
    return;
  }
  if (command.type === "pass_shot") {
    messages.push({ jid: state.groupJid, text: "獵人唔開槍。" });
    passHunter(state, event.now, messages);
    return;
  }
  if (command.type !== "shoot") {
    messages.push({ jid: hunter.jid, text: hunterPrompt() });
    return;
  }
  const target = resolveTarget(state, command.target, false);
  if (!target || !target.alive || target.jid === hunter.jid) {
    messages.push({ jid: hunter.jid, text: "揀一個在生嘅人，唔可以射自己。" });
    return;
  }
  target.alive = false;
  messages.push({ jid: state.groupJid, text: `獵人開咗槍，${label(target)} 出局。` });
  afterHunter(state, event.now, messages);
}

function onDay(state: GameState, event: MessageEvent, command: Command, messages: Outbound[]): void {
  if (command.type === "end") return cancel(state, event, messages);
  if (command.type !== "end_talk") {
    messages.push({ jid: state.groupJid, text: "討論緊。主持人可以打「結束討論」。" });
    return;
  }
  if (event.actorJid !== state.hostJid) {
    messages.push({ jid: state.groupJid, text: "得主持人先可以結束討論。" });
    return;
  }
  enterVote(state, event.now, messages);
}

function onVote(state: GameState, event: MessageEvent, command: Command, messages: Outbound[]): void {
  if (command.type === "end") return cancel(state, event, messages);
  if (command.type !== "vote") {
    messages.push({ jid: state.groupJid, text: "而家投票。打「投票 3」或者「投票 棄權」。" });
    return;
  }
  const voter = state.players.find((item) => item.jid === event.actorJid && item.alive);
  if (!voter) {
    messages.push({ jid: state.groupJid, text: "出局咗就投唔到票。" });
    return;
  }
  if (command.target === "abstain") {
    state.votes[voter.jid] = "abstain";
  } else {
    const target = resolveTarget(state, command.target, false);
    if (!target || !target.alive) {
      messages.push({ jid: state.groupJid, text: "呢個號碼唔得。" });
      return;
    }
    state.votes[voter.jid] = target.number;
  }
  messages.push({ jid: state.groupJid, text: `${label(voter)} 投咗票。` });
  const living = state.players.filter((item) => item.alive);
  if (living.every((item) => state.votes[item.jid] != null)) closeVote(state, event.now, messages);
}

function closeWolves(state: GameState, now: number, messages: Outbound[]): void {
  const values: number[] = [];
  for (const wolf of livingRole(state, "wolf")) {
    const vote = state.wolfVotes[wolf.jid];
    if (vote == null) continue;
    const target = byNumber(state, vote);
    if (!target?.alive || target.role === "wolf") continue;
    values.push(vote);
  }
  state.wolfTarget = majorityTarget(values).target;
  enterSeer(state, now, messages);
}

function enterSeer(state: GameState, now: number, messages: Outbound[]): void {
  const seer = livingRole(state, "seer")[0];
  if (!seer) {
    enterWitch(state, now, messages);
    return;
  }
  state.phase = "night_seer";
  state.deadline = now + PHASE_MS.seer;
  messages.push({ jid: seer.jid, text: seerPrompt() });
}

function enterWitch(state: GameState, now: number, messages: Outbound[]): void {
  const witch = livingRole(state, "witch")[0];
  if (!witch || (state.saveUsed && state.poisonUsed)) {
    state.witchAction = state.witchAction ?? "skip";
    resolveDawn(state, now, messages);
    return;
  }
  state.phase = "night_witch";
  state.deadline = now + PHASE_MS.witch;
  const target = state.wolfTarget == null ? null : byNumber(state, state.wolfTarget);
  messages.push({
    jid: witch.jid,
    text: witchPrompt(witchAttackLine(target ? label(target) : null), !state.saveUsed, !state.poisonUsed),
  });
}

function resolveDawn(state: GameState, now: number, messages: Outbound[]): void {
  const deaths: Player[] = [];
  const saved = state.witchAction === "save";
  if (state.wolfTarget != null && !saved) {
    const target = byNumber(state, state.wolfTarget);
    if (target?.alive) deaths.push(target);
  }
  let poisoned: Player | undefined;
  if (state.witchAction === "poison" && state.poisonTarget != null) {
    poisoned = byNumber(state, state.poisonTarget);
    if (poisoned?.alive && !deaths.some((item) => item.jid === poisoned!.jid)) deaths.push(poisoned);
  }
  let hunterShot = false;
  for (const dead of deaths) {
    dead.alive = false;
    const poisonedThis = poisoned?.jid === dead.jid && state.witchAction === "poison";
    if (dead.role === "hunter" && !poisonedThis) hunterShot = true;
  }
  messages.push({
    jid: state.groupJid,
    text: dawnText(deaths.map((dead) => label(dead))),
  });
  if (hunterShot) {
    state.hunterFrom = "night";
    enterHunter(state, now, messages);
    return;
  }
  finishOr(state, "day", now, messages);
}

function enterHunter(state: GameState, now: number, messages: Outbound[]): void {
  const hunter = state.players.find((item) => item.role === "hunter");
  state.phase = "hunter";
  state.deadline = now + PHASE_MS.hunter;
  messages.push({ jid: state.groupJid, text: "獵人可以開槍。" });
  if (hunter) messages.push({ jid: hunter.jid, text: hunterPrompt() });
}

function passHunter(state: GameState, now: number, messages: Outbound[]): void {
  afterHunter(state, now, messages);
}

function afterHunter(state: GameState, now: number, messages: Outbound[]): void {
  const next = state.hunterFrom === "vote" ? "night" : "day";
  finishOr(state, next, now, messages);
}

function enterDay(state: GameState, now: number, messages: Outbound[]): void {
  state.phase = "day";
  state.votes = {};
  state.revote = false;
  state.deadline = now + PHASE_MS.day;
  messages.push({
    jid: state.groupJid,
    text: dayText(roster(state.players, true)),
  });
}

function enterVote(state: GameState, now: number, messages: Outbound[]): void {
  state.phase = "vote";
  state.votes = {};
  state.deadline = now + PHASE_MS.vote;
  messages.push({ jid: state.groupJid, text: voteText(roster(state.players, true)) });
}

function closeVote(state: GameState, now: number, messages: Outbound[]): void {
  const values: number[] = [];
  for (const voter of state.players.filter((item) => item.alive)) {
    const vote = state.votes[voter.jid];
    if (typeof vote !== "number") continue;
    const target = byNumber(state, vote);
    if (target?.alive) values.push(vote);
  }
  const result = majorityTarget(values);
  if (result.target == null) {
    if (result.tie && !state.revote) {
      state.revote = true;
      state.votes = {};
      state.deadline = now + PHASE_MS.vote;
      messages.push({ jid: state.groupJid, text: "打和，再投一次。打「投票 3」。" });
      return;
    }
    messages.push({ jid: state.groupJid, text: "平安日，冇人出局。" });
    enterNight(state, now, messages, true);
    return;
  }
  const target = byNumber(state, result.target);
  if (!target) {
    enterNight(state, now, messages, true);
    return;
  }
  target.alive = false;
  messages.push({ jid: state.groupJid, text: `${label(target)} 出局。` });
  if (target.role === "hunter") {
    state.hunterFrom = "vote";
    enterHunter(state, now, messages);
    return;
  }
  finishOr(state, "night", now, messages);
}

function enterNight(state: GameState, now: number, messages: Outbound[], announce: boolean): void {
  state.night += 1;
  state.phase = "night_wolves";
  state.wolfVotes = {};
  state.witchAction = null;
  state.poisonTarget = null;
  state.votes = {};
  state.revote = false;
  state.wolfTarget = null;
  state.hunterFrom = null;
  state.deadline = now + PHASE_MS.wolves;
  if (announce) messages.push({ jid: state.groupJid, text: `第 ${state.night} 晚。天黑請閉眼。` });
  const wolves = livingRole(state, "wolf");
  const teammates = (wolf: Player) =>
    wolves.filter((item) => item.jid !== wolf.jid).map((item) => label(item)).join("、") || "冇";
  for (const wolf of wolves) {
    messages.push({ jid: wolf.jid, text: wolfPrompt(teammates(wolf)) });
  }
}

function finishOr(state: GameState, next: "day" | "night", now: number, messages: Outbound[]): void {
  const winner = winnerOf(state.players);
  if (winner) {
    state.phase = "ended";
    state.winner = winner;
    state.deadline = null;
    messages.push({ jid: state.groupJid, text: revealText(winner, state.players) });
    return;
  }
  if (next === "day") enterDay(state, now, messages);
  else enterNight(state, now, messages, true);
}

function cancel(state: GameState, event: MessageEvent, messages: Outbound[]): void {
  if (event.actorJid !== state.hostJid) {
    messages.push({ jid: replyTo(state, event), text: "得主持人先可以結束。" });
    return;
  }
  state.phase = "ended";
  state.deadline = null;
  state.winner = null;
  messages.push({ jid: state.groupJid, text: "主持人取消咗呢局，身份唔公開。" });
}

function resolveTarget(state: GameState, target: Target, allowDead: boolean): Player | undefined {
  if (target === "abstain") return undefined;
  if (typeof target === "number") {
    const found = byNumber(state, target);
    if (!found || (!allowDead && !found.alive)) return undefined;
    return found;
  }
  return state.players.find((item) => item.jid === target.mention && (allowDead || item.alive));
}

function livingRole(state: GameState, role: Role): Player[] {
  return state.players.filter((item) => item.alive && item.role === role);
}

function byNumber(state: GameState, number: number): Player | undefined {
  return state.players.find((item) => item.number === number);
}

function player(jid: string, name: string, number: number): Player {
  return { jid, name: name || `${number} 號`, number, role: null, alive: true };
}

function renumber(players: Player[]): void {
  players.forEach((item, index) => {
    item.number = index + 1;
  });
}

function renderStatus(state: GameState, now: number): string {
  const seconds = state.deadline == null ? null : Math.max(0, Math.ceil((state.deadline - now) / 1000));
  return statusText(state.phase, seconds, state.players);
}

function replyTo(state: GameState | null, event: MessageEvent): string {
  if (event.scope === "group") return state?.groupJid || event.groupJid || event.actorJid;
  return event.actorJid;
}

function touchName(state: GameState, event: MessageEvent): void {
  const found = state.players.find((item) => item.jid === event.actorJid);
  if (found && event.actorName) found.name = event.actorName;
}

function nameChanged(before: GameState, after: GameState): boolean {
  return JSON.stringify(before.players.map((item) => item.name)) !== JSON.stringify(after.players.map((item) => item.name));
}

function wrongScope(command: Command, event: MessageEvent): string | null {
  if (NIGHT_COMMANDS.has(command.type) && event.scope !== "dm") {
    return "夜晚行動要私訊我，唔好喺群組講。";
  }
  if (GROUP_COMMANDS.has(command.type) && event.scope !== "group") {
    return "呢句要喺群組打。";
  }
  return null;
}

function isKnown(command: Command): boolean {
  return command.type !== "rules";
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function blankGame(partial: Partial<GameState> & Pick<GameState, "groupJid" | "hostJid" | "players">): GameState {
  return {
    phase: "lobby",
    night: 0,
    wolfVotes: {},
    saveUsed: false,
    poisonUsed: false,
    witchAction: null,
    poisonTarget: null,
    votes: {},
    revote: false,
    deadline: null,
    winner: null,
    hunterFrom: null,
    wolfTarget: null,
    ...partial,
  };
}
