# hk-werewolf

香港廣東話 WhatsApp 狼人殺機械人。夜晚私訊行動，日間喺群組討論同投票。

Hong Kong Cantonese Werewolf bot for a normal WhatsApp group.

## 連線方式

用 [`whatsapp-cloudflare-workers`](https://github.com/rafaelsg-01/whatsapp-cloudflare-workers)。呢個係改過嘅 Baileys：每次喺 Worker 入面打開 WhatsApp 十幾秒，睇新訊息、覆完，就收線。Cron 每分鐘做一次。登入資料同對局放喺 D1。原版例子唔會保存 Signal key，呢個 bot 會寫入 D1，群組訊息先解到密。

免費 Workers 每次只有 **10 毫秒 CPU**。WhatsApp 握手通常重過呢個限制，輪詢可能失敗，訊息會遲到下一次先收到。Workers Paid 先有足夠 CPU。

請用一個備用電話號碼。呢個係非官方 WhatsApp Web 協定，號碼有機會被登出。

## 指令

群組：`開局` `加入` `退出` `開始` `狀態` `規則` `結束討論` `投票 3` `投票 棄權` `結束`

私訊：狼人 `殺 3`，預言家 `查 3`，女巫 `救` / `毒 3` / `跳過`，獵人 `開槍 3` / `唔開`

6–8 人兩隻狼，9–11 人三隻狼，12 人四隻狼。另外各一：預言家、女巫、獵人，其餘平民。女巫解藥同毒藥各一枝，同一晚只可以用一枝。獵人中毒就開唔到槍。狼人數目大於或等於好人就狼人贏。

## Deploy

```sh
npm install
npx wrangler login
npx wrangler d1 create hk-werewolf
```

Put the printed `database_id` into `wrangler.toml`, then:

```sh
npx wrangler d1 execute hk-werewolf --remote --file=migrations/0001_init.sql
npx wrangler secret put ADMIN_TOKEN
npx wrangler deploy
```

Open `https://hk-werewolf.<account>.workers.dev/link?token=...`. In WhatsApp choose **已連結的裝置** and scan the QR code. Add that number to a group and send `開局`.

`/poll?token=...` runs one listen cycle immediately. `/health` does not need the token.

## Tests

```sh
npm test
```
