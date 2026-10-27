import type { Phase, Player, Role } from "../game/types.ts";

export function roleName(role: Role | null): string {
  switch (role) {
    case "wolf":
      return "狼人";
    case "villager":
      return "平民";
    case "seer":
      return "預言家";
    case "witch":
      return "女巫";
    case "hunter":
      return "獵人";
    default:
      return "未知";
  }
}

export function phaseName(phase: Phase): string {
  switch (phase) {
    case "lobby":
      return "等緊人";
    case "night_wolves":
      return "夜晚，狼人行動";
    case "night_seer":
      return "夜晚，預言家行動";
    case "night_witch":
      return "夜晚，女巫行動";
    case "hunter":
      return "獵人開槍";
    case "day":
      return "日間討論";
    case "vote":
      return "投票";
    case "ended":
      return "完咗";
  }
}

export function rulesText(): string {
  return [
    "狼人殺，6 至 12 人。",
    "群組打：開局、加入、退出、開始、狀態、規則、結束討論、投票 3、結束。",
    "夜晚私訊我：狼人打「殺 3」，預言家打「查 3」，女巫打「救」、「毒 3」或者「跳過」，獵人打「開槍 3」或者「唔開」。",
    "女巫有解藥同毒藥各一枝，同一晚只可以用一枝，救得自己。",
    "獵人中毒就開唔到槍。身份完局先公開。",
    "我每隔一陣先睇到新訊息，你打完稍等下。",
  ].join("\n");
}

export function label(player: Player): string {
  const name = player.name.trim() || `${player.number} 號`;
  return `${player.number} ${name}`;
}

export function roster(players: Player[], livingOnly: boolean): string {
  const list = players.filter((player) => !livingOnly || player.alive);
  if (list.length === 0) return "（冇人）";
  return list.map((player) => label(player)).join("、");
}

export function roleDm(role: Role, teammates: string): string {
  switch (role) {
    case "wolf":
      return `你係狼人。隊友：${teammates}。私訊打「殺 3」揀一個好人。`;
    case "villager":
      return "你係平民。夜晚冇嘢做，聽朝喺群組投票。";
    case "seer":
      return "你係預言家。輪到你，私訊打「查 3」，我會話你知佢係狼人定好人。";
    case "witch":
      return "你係女巫。你有解藥同毒藥各一枝，同一晚只可以用一枝。";
    case "hunter":
      return "你係獵人。如果你死咗又唔係中毒，可以私訊「開槍 3」或者「唔開」。";
  }
}

export function wolfPrompt(teammates: string): string {
  return `夜晚喇。隊友：${teammates}。打「殺 3」投票，多數通過。打和就今晚唔殺人。`;
}

export function wolfTally(lines: string[], waiting: string[]): string {
  const voted = lines.length ? lines.join("、") : "未有人投";
  const wait = waiting.length ? `仲等：${waiting.join("、")}。` : "人人都投咗。";
  return `狼人而家：${voted}。${wait}`;
}

export function seerPrompt(): string {
  return "輪到你查人。打「查 3」。";
}

export function seerResult(target: string, kind: "狼人" | "好人"): string {
  return `${target} 係${kind}。`;
}

export function witchPrompt(attack: string, saveLeft: boolean, poisonLeft: boolean): string {
  const potions = [
    saveLeft ? "解藥仲有" : "解藥用咗",
    poisonLeft ? "毒藥仲有" : "毒藥用咗",
  ].join("，");
  return `${attack}${potions}。打「救」、「毒 3」或者「跳過」。同一晚只可以揀一樣。`;
}

export function witchAttackLine(target: string | null): string {
  if (!target) return "今晚狼人未有共識，冇人中招。";
  return `今晚狼人想殺 ${target}。`;
}

export function dawnText(deaths: string[]): string {
  if (deaths.length === 0) return "天光喇。今晚平安夜，冇人死。";
  return `天光喇。今晚死咗：${deaths.join("、")}。`;
}

export function dayText(list: string): string {
  return `而家討論，三分鐘。主持人可以打「結束討論」。在生：${list}。`;
}

export function voteText(list: string): string {
  return `投票時間。打「投票 3」或者「投票 棄權」。在生：${list}。`;
}

export function hunterPrompt(): string {
  return "你死咗，可以開槍。打「開槍 3」或者「唔開」。";
}

export function revealText(side: "wolves" | "village", players: Player[]): string {
  const headline = side === "wolves" ? "狼人贏咗。" : "好人贏咗。";
  const lines = players.map((player) => `${label(player)}：${roleName(player.role)}`);
  return `${headline}\n${lines.join("\n")}`;
}

export function statusText(phase: Phase, seconds: number | null, players: Player[]): string {
  const time = seconds == null ? "" : `仲有 ${seconds} 秒。`;
  const list = players
    .map((player) => `${label(player)}${player.alive ? "" : "（出局）"}`)
    .join("、");
  return `而家係${phaseName(phase)}。${time}玩家：${list}`;
}
