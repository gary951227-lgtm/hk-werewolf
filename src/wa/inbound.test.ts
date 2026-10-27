import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inboundFromWa } from "./inbound.ts";

describe("inbound", () => {
  it("reads a group command and ignores the bot itself", () => {
    const inbound = inboundFromWa({
      key: { remoteJid: "120363@g.us", participant: "85290000001@s.whatsapp.net", id: "abc", fromMe: false },
      pushName: "阿明",
      message: { conversation: "加入" },
    });
    assert.equal(inbound?.scope, "group");
    assert.equal(inbound?.text, "加入");
    assert.equal(inbound?.actorName, "阿明");
    assert.equal(inboundFromWa({
      key: { remoteJid: "85290000001@s.whatsapp.net", id: "me", fromMe: true },
      message: { conversation: "加入" },
    }), null);
  });

  it("reads a private night action and mentions", () => {
    const inbound = inboundFromWa({
      key: { remoteJid: "85290000002@s.whatsapp.net", id: "dm", fromMe: false },
      pushName: "女巫",
      message: {
        extendedTextMessage: {
          text: "殺 3",
          contextInfo: { mentionedJid: ["85290000003@s.whatsapp.net"] },
        },
      },
    });
    assert.equal(inbound?.scope, "dm");
    assert.deepEqual(inbound?.mentionedJids, ["85290000003@s.whatsapp.net"]);
  });
});
