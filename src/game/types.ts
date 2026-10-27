export type Role = "wolf" | "villager" | "seer" | "witch" | "hunter";

export type Phase =
  | "lobby"
  | "night_wolves"
  | "night_seer"
  | "night_witch"
  | "hunter"
  | "day"
  | "vote"
  | "ended";

export interface Player {
  jid: string;
  name: string;
  number: number;
  role: Role | null;
  alive: boolean;
}

export interface GameState {
  groupJid: string;
  hostJid: string;
  phase: Phase;
  players: Player[];
  night: number;
  wolfVotes: Record<string, number>;
  saveUsed: boolean;
  poisonUsed: boolean;
  witchAction: "save" | "poison" | "skip" | null;
  poisonTarget: number | null;
  votes: Record<string, number | "abstain">;
  revote: boolean;
  deadline: number | null;
  winner: "wolves" | "village" | null;
  hunterFrom: "night" | "vote" | null;
  wolfTarget: number | null;
}

export interface Outbound {
  jid: string;
  text: string;
}

export type Target = number | "abstain" | { mention: string };

export type Command =
  | { type: "open" }
  | { type: "join" }
  | { type: "leave" }
  | { type: "start" }
  | { type: "status" }
  | { type: "rules" }
  | { type: "end_talk" }
  | { type: "end" }
  | { type: "skip" }
  | { type: "save" }
  | { type: "pass_shot" }
  | { type: "vote"; target: Target }
  | { type: "kill"; target: Target }
  | { type: "see"; target: Target }
  | { type: "poison"; target: Target }
  | { type: "shoot"; target: Target };

export interface MessageEvent {
  kind: "message";
  scope: "group" | "dm";
  groupJid?: string;
  actorJid: string;
  actorName: string;
  text: string;
  mentionedJids: string[];
  now: number;
}

export interface TickEvent {
  kind: "tick";
  now: number;
}

export interface ApplyResult {
  state: GameState | null;
  messages: Outbound[];
  changed: boolean;
}
