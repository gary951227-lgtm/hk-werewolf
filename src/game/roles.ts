import type { Player, Role } from "./types.ts";

export function roleCounts(n: number): Record<Role, number> {
  if (n < 6 || n > 12) {
    throw new Error(`需要 6 至 12 人，而家 ${n} 人`);
  }
  const wolves = n <= 8 ? 2 : n <= 11 ? 3 : 4;
  return {
    wolf: wolves,
    seer: 1,
    witch: 1,
    hunter: 1,
    villager: n - wolves - 3,
  };
}

export function assignRoles(n: number, rng: () => number): Role[] {
  const counts = roleCounts(n);
  const bag: Role[] = [];
  for (const role of ["wolf", "seer", "witch", "hunter", "villager"] as const) {
    for (let i = 0; i < counts[role]; i++) bag.push(role);
  }
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const swap = bag[i]!;
    bag[i] = bag[j]!;
    bag[j] = swap;
  }
  return bag;
}

export function majorityTarget(votes: number[]): { target: number | null; tie: boolean } {
  const counts = new Map<number, number>();
  for (const vote of votes) counts.set(vote, (counts.get(vote) ?? 0) + 1);
  let best = 0;
  let leaders: number[] = [];
  for (const [number, count] of counts) {
    if (count > best) {
      best = count;
      leaders = [number];
    } else if (count === best) {
      leaders.push(number);
    }
  }
  if (leaders.length !== 1) return { target: null, tie: leaders.length > 1 };
  return { target: leaders[0] ?? null, tie: false };
}

export function winnerOf(players: Player[]): "wolves" | "village" | null {
  const living = players.filter((player) => player.alive);
  const wolves = living.filter((player) => player.role === "wolf").length;
  const good = living.length - wolves;
  if (wolves === 0) return "village";
  if (wolves >= good) return "wolves";
  return null;
}
