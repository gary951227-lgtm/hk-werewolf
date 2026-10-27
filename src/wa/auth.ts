import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataSet,
  type SignalDataTypeMap,
} from "whatsapp-cloudflare-workers";

async function readKey(db: D1Database, key: string): Promise<unknown | null> {
  const row = await db.prepare("SELECT value FROM auth WHERE key = ?").bind(key).first<{ value: string }>();
  if (!row) return null;
  return JSON.parse(row.value, BufferJSON.reviver);
}

async function writeKey(db: D1Database, key: string, data: unknown): Promise<void> {
  await db.prepare(
    "INSERT INTO auth (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).bind(key, JSON.stringify(data, BufferJSON.replacer)).run();
}

export async function hasRegisteredSession(db: D1Database): Promise<boolean> {
  const raw = await readKey(db, "creds");
  return Boolean(raw && typeof raw === "object" && "registered" in raw && (raw as { registered?: boolean }).registered);
}

export async function useD1AuthState(db: D1Database): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  const creds = ((await readKey(db, "creds")) as AuthenticationCreds | null) || initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const data = {} as { [id: string]: SignalDataTypeMap[T] };
          await Promise.all(ids.map(async (id) => {
            let value = await readKey(db, `${type}-${id}`);
            if (type === "app-state-sync-key" && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            if (value) data[id] = value as SignalDataTypeMap[T];
          }));
          return data;
        },
        set: async (data: SignalDataSet) => {
          const statements: D1PreparedStatement[] = [];
          for (const category of Object.keys(data) as (keyof SignalDataSet)[]) {
            const bucket = data[category];
            if (!bucket) continue;
            for (const id of Object.keys(bucket)) {
              const value = bucket[id];
              const key = `${category}-${id}`;
              if (value) {
                statements.push(db.prepare(
                  "INSERT INTO auth (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                ).bind(key, JSON.stringify(value, BufferJSON.replacer)));
              } else {
                statements.push(db.prepare("DELETE FROM auth WHERE key = ?").bind(key));
              }
            }
          }
          for (let i = 0; i < statements.length; i += 40) {
            await db.batch(statements.slice(i, i + 40));
          }
        },
      },
    },
    saveCreds: () => writeKey(db, "creds", creds),
  };
}
