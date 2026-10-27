export interface Inbound {
  id: string;
  scope: "group" | "dm";
  groupJid?: string;
  actorJid: string;
  actorName: string;
  text: string;
  mentionedJids: string[];
}

interface WaKey {
  remoteJid?: string | null;
  fromMe?: boolean | null;
  id?: string | null;
  participant?: string | null;
}

interface WaMessage {
  key?: WaKey | null;
  pushName?: string | null;
  message?: unknown;
}

function unwrap(message: unknown): Record<string, unknown> | null {
  let node = message && typeof message === "object" ? message as Record<string, unknown> : null;
  for (let i = 0; i < 3 && node; i++) {
    const nested = node.ephemeralMessage
      ?? node.viewOnceMessage
      ?? node.viewOnceMessageV2
      ?? node.documentWithCaptionMessage;
    const inner = nested && typeof nested === "object"
      ? (nested as { message?: Record<string, unknown> }).message
      : undefined;
    if (!inner) break;
    node = inner;
  }
  return node;
}

function readText(node: Record<string, unknown> | null): { text: string; mentionedJids: string[] } {
  if (!node) return { text: "", mentionedJids: [] };
  const extended = node.extendedTextMessage as { text?: string; contextInfo?: { mentionedJid?: string[] } } | undefined;
  const image = node.imageMessage as { caption?: string; contextInfo?: { mentionedJid?: string[] } } | undefined;
  const video = node.videoMessage as { caption?: string; contextInfo?: { mentionedJid?: string[] } } | undefined;
  const text = (typeof node.conversation === "string" && node.conversation)
    || extended?.text
    || image?.caption
    || video?.caption
    || "";
  const mentionedJids = extended?.contextInfo?.mentionedJid
    || image?.contextInfo?.mentionedJid
    || video?.contextInfo?.mentionedJid
    || [];
  return { text, mentionedJids };
}

export function inboundFromWa(message: WaMessage): Inbound | null {
  const remoteJid = message.key?.remoteJid || "";
  if (!remoteJid || remoteJid === "status@broadcast" || message.key?.fromMe) return null;
  const { text, mentionedJids } = readText(unwrap(message.message));
  if (!text.trim()) return null;
  const group = remoteJid.endsWith("@g.us");
  const actorJid = group ? (message.key?.participant || "") : remoteJid;
  if (!actorJid) return null;
  return {
    id: message.key?.id || `${remoteJid}:${actorJid}:${text}`,
    scope: group ? "group" : "dm",
    groupJid: group ? remoteJid : undefined,
    actorJid,
    actorName: message.pushName || "",
    text,
    mentionedJids,
  };
}
