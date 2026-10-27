import { readFileSync, writeFileSync } from "node:fs";

const path = "node_modules/whatsapp-cloudflare-workers/lib/Socket/Client/websocket.js";
const source = readFileSync(path, "utf8");
const broken = `        if (this.socket.readyState === WebSocket.OPEN) {
            this.socket.accept();
            this.emit('open');
        }
        else {
            this.emit('error', new Error('WebSocket connection failed'));
        }`;
const fixed = `        try {
            this.socket.accept();
        }
        catch (_b) { }
        if (this.socket.readyState === WebSocket.OPEN) {
            this.emit('open');
        }`;
if (source.includes(broken)) {
  writeFileSync(path, source.replace(broken, fixed));
}
