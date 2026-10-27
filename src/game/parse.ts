import type { Command, Target } from "./types.ts";

function normalize(text: string): string {
  return text
    .trim()
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, " ");
}

function targetFrom(raw: string | undefined, mentionedJids: string[]): Target | null {
  if (raw === "棄權") return "abstain";
  if (raw && /^\d+$/.test(raw)) return Number(raw);
  const mention = mentionedJids[0];
  if (mention) return { mention };
  return null;
}

export function parseCommand(text: string, mentionedJids: string[]): Command | null {
  const line = normalize(text);
  if (!line) return null;

  switch (line) {
    case "開局":
      return { type: "open" };
    case "加入":
      return { type: "join" };
    case "退出":
      return { type: "leave" };
    case "開始":
      return { type: "start" };
    case "狀態":
      return { type: "status" };
    case "規則":
      return { type: "rules" };
    case "結束討論":
      return { type: "end_talk" };
    case "結束":
      return { type: "end" };
    case "跳過":
      return { type: "skip" };
    case "救":
      return { type: "save" };
    case "唔開":
      return { type: "pass_shot" };
    default:
      break;
  }

  const matched = /^(投票|殺|查|毒|開槍)(?:\s*(\d+|棄權))?$/.exec(line);
  if (!matched) return null;
  const verb = matched[1]!;
  const target = targetFrom(matched[2], mentionedJids);
  if (!target) return null;
  if (verb !== "投票" && target === "abstain") return null;
  switch (verb) {
    case "投票":
      return { type: "vote", target };
    case "殺":
      return { type: "kill", target };
    case "查":
      return { type: "see", target };
    case "毒":
      return { type: "poison", target };
    case "開槍":
      return { type: "shoot", target };
    default:
      return null;
  }
}
