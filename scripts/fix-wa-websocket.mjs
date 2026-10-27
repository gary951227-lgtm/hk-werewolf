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
let next = source;
if (next.includes(broken)) next = next.replace(broken, fixed);
const blobBroken = `        this.socket.addEventListener('message', (event) => {
            if (__1.logForDevelopment.show)
                console.log('');
            if (__1.logForDevelopment.show)
                console.log('WARNING [RECEIVING]: ', '[event.data]', event.data);
            if (__1.logForDevelopment.show)
                console.log('');
            let eventData = event.data;
            if (eventData instanceof ArrayBuffer) {
                eventData = Buffer.from(eventData);
            }
            this.emit('message', eventData);
        });`;
const blobFixed = `        this.socket.addEventListener('message', (event) => {
            const deliver = (eventData) => {
                if (eventData instanceof ArrayBuffer)
                    eventData = Buffer.from(eventData);
                this.emit('message', eventData);
            };
            const data = event.data;
            if (data && typeof data.arrayBuffer === 'function' && !(data instanceof ArrayBuffer)) {
                data.arrayBuffer().then(deliver).catch((error) => this.emit('error', error));
                return;
            }
            deliver(data);
        });`;
if (next.includes(blobBroken)) next = next.replace(blobBroken, blobFixed);
if (next !== source) writeFileSync(path, next);

const validatePath = "node_modules/whatsapp-cloudflare-workers/lib/Utils/validate-connection.js";
const validate = readFileSync(validatePath, "utf8");
const webPlatform = "platform: WAProto_1.proto.ClientPayload.UserAgent.Platform.WEB,";
const macPlatform = "platform: WAProto_1.proto.ClientPayload.UserAgent.Platform.MACOS,";
if (validate.includes(webPlatform)) {
  writeFileSync(validatePath, validate.replace(webPlatform, macPlatform));
}
