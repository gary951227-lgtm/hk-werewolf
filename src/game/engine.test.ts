import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCommand } from "./parse.ts";
import { majorityTarget, roleCounts, winnerOf } from "./roles.ts";
import { apply, blankGame, catchUp, PHASE_MS } from "./engine.ts";
import type { GameState, MessageEvent, Player, Role } from "./types.ts";

const GROUP = "120363000@g.us";
const NOW = 1_700_000_000_000;

function person(number: number, role: Role, alive = true): Player {
  return {
    jid: `8529000000${number}@s.whatsapp.net`,
    name: `${number}號`,
    number,
    role,
    alive,
  };
}

function message(partial: Partial<MessageEvent> & Pick<MessageEvent, "actorJid" | "text">): MessageEvent {
  return {
    kind: "message",
    scope: "group",
    groupJid: GROUP,
    actorName: "玩家",
    mentionedJids: [],
    now: NOW,
    ...partial,
  };
}

function six(): GameState {
  return blankGame({
    groupJid: GROUP,
    hostJid: person(1, "wolf").jid,
    phase: "night_wolves",
    night: 1,
    deadline: NOW + PHASE_MS.wolves,
    players: [
      person(1, "wolf"),
      person(2, "wolf"),
      person(3, "seer"),
      person(4, "witch"),
      person(5, "hunter"),
      person(6, "villager"),
    ],
  });
}

describe("roles", () => {
  it("deals the standard counts", () => {
    assert.deepEqual(roleCounts(6), { wolf: 2, seer: 1, witch: 1, hunter: 1, villager: 1 });
    assert.equal(roleCounts(8).villager, 3);
    assert.equal(roleCounts(9).wolf, 3);
    assert.equal(roleCounts(12).wolf, 4);
    assert.equal(roleCounts(12).villager, 5);
  });

  it("picks a strict majority and spots a tie", () => {
    assert.deepEqual(majorityTarget([3, 3, 5]), { target: 3, tie: false });
    assert.deepEqual(majorityTarget([3, 5]), { target: null, tie: true });
    assert.deepEqual(majorityTarget([]), { target: null, tie: false });
  });

  it("gives the win to wolves at half the table", () => {
    const players = [person(1, "wolf"), person(2, "villager"), person(3, "seer", false)];
    assert.equal(winnerOf(players), "wolves");
    players[0]!.alive = false;
    assert.equal(winnerOf(players), "village");
  });
});

describe("parse", () => {
  it("reads cantonese commands and mentions", () => {
    assert.equal(parseCommand("結束討論", [])?.type, "end_talk");
    assert.deepEqual(parseCommand("投票 棄權", []), { type: "vote", target: "abstain" });
    assert.deepEqual(parseCommand("殺３", []), { type: "kill", target: 3 });
    assert.deepEqual(parseCommand("投票", ["852@s.whatsapp.net"]), {
      type: "vote",
      target: { mention: "852@s.whatsapp.net" },
    });
    assert.equal(parseCommand("今晚食飯", []), null);
    assert.equal(parseCommand("殺 棄權", []), null);
  });
});

describe("game", () => {
  it("opens a table and starts at six players", () => {
    let state = apply(null, message({ actorJid: person(1, "wolf").jid, actorName: "主持", text: "開局" })).state;
    assert.equal(state?.players.length, 1);
    for (let n = 2; n <= 6; n++) {
      state = apply(state, message({
        actorJid: person(n, "villager").jid,
        actorName: `${n}號`,
        text: "加入",
      })).state;
    }
    const started = apply(state, message({ actorJid: person(1, "wolf").jid, text: "開始" }));
    assert.equal(started.state?.phase, "night_wolves");
    assert.equal(started.state?.players.length, 6);
    assert.equal(started.messages.filter((item) => item.text.includes("你係")).length, 6);
    const counts = { wolf: 0, seer: 0, witch: 0, hunter: 0, villager: 0 };
    for (const player of started.state!.players) counts[player.role!] += 1;
    assert.deepEqual(counts, roleCounts(6));
  });

  it("kills on a wolf majority and lets a poisoned hunter stay quiet", () => {
    let state = six();
    state = apply(state, message({
      scope: "dm",
      actorJid: person(1, "wolf").jid,
      text: "殺 5",
    })).state!;
    const closed = apply(state, message({
      scope: "dm",
      actorJid: person(2, "wolf").jid,
      text: "殺 5",
    }));
    assert.equal(closed.state?.phase, "night_seer");
    const seen = apply(closed.state, message({
      scope: "dm",
      actorJid: person(3, "seer").jid,
      text: "查 1",
    }));
    assert.ok(seen.messages.some((item) => item.text.includes("狼人")));
    const poisoned = apply(seen.state, message({
      scope: "dm",
      actorJid: person(4, "witch").jid,
      text: "毒 5",
    }));
    assert.equal(poisoned.state?.players.find((item) => item.number === 5)?.alive, false);
    assert.equal(poisoned.state?.phase, "day");
    assert.equal(poisoned.state?.poisonUsed, true);
  });

  it("lets the witch save the wolf target", () => {
    let state = six();
    state.wolfVotes[person(1, "wolf").jid] = 6;
    state.wolfVotes[person(2, "wolf").jid] = 6;
    state = catchUp(state, NOW + PHASE_MS.wolves).state!;
    state = catchUp(state, state.deadline!).state!;
    const saved = apply(state, message({
      scope: "dm",
      actorJid: person(4, "witch").jid,
      text: "救",
      now: state.deadline! - 1000,
    }));
    assert.equal(saved.state?.players.find((item) => item.number === 6)?.alive, true);
    assert.ok(saved.messages.some((item) => item.text.includes("平安夜")));
  });

  it("asks the hunter to shoot after a wolf kill", () => {
    const state = six();
    state.players[2]!.alive = false;
    state.players[3]!.alive = false;
    state.wolfVotes[person(1, "wolf").jid] = 5;
    state.wolfVotes[person(2, "wolf").jid] = 5;
    const dawn = catchUp(state, NOW + PHASE_MS.wolves);
    assert.equal(dawn.state?.phase, "hunter");
    const shot = apply(dawn.state, message({
      scope: "dm",
      actorJid: person(5, "hunter").jid,
      text: "開槍 6",
      now: NOW + PHASE_MS.wolves,
    }));
    assert.equal(shot.state?.phase, "ended");
    assert.equal(shot.state?.winner, "wolves");
  });

  it("revotes a tie and then calls a peaceful day", () => {
    const state = six();
    state.phase = "vote";
    state.deadline = NOW + PHASE_MS.vote;
    const voters = [
      [1, 3],
      [2, 6],
      [3, 3],
      [4, 6],
      [5, "棄權"],
      [6, "棄權"],
    ] as const;
    let current = state;
    let last = apply(current, message({ actorJid: person(1, "wolf").jid, text: "投票 3" }));
    for (const [number, choice] of voters.slice(1)) {
      current = last.state!;
      last = apply(current, message({
        actorJid: person(number, "villager").jid,
        text: `投票 ${choice}`,
      }));
    }
    assert.equal(last.state?.revote, true);
    assert.match(last.messages.at(-1)!.text, /打和/);
    const again = [3, 6, 3, 6, 3, 6];
    for (let index = 0; index < again.length; index++) {
      current = last.state!;
      last = apply(current, message({
        actorJid: person(index + 1, "villager").jid,
        text: `投票 ${again[index]}`,
      }));
    }
    assert.match(last.messages.map((item) => item.text).join("\n"), /平安日/);
    assert.equal(last.state?.phase, "night_wolves");
    assert.equal(last.state?.night, 2);
  });

  it("refuses night actions in the group", () => {
    const result = apply(six(), message({ actorJid: person(1, "wolf").jid, text: "殺 6" }));
    assert.match(result.messages[0]!.text, /私訊/);
    assert.equal(result.state?.wolfVotes[person(1, "wolf").jid], undefined);
  });
});
