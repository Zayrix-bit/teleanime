import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const apiId = 38731827;
const apiHash = "f52eaaae40fbc572fcf046c82f620054";
const botToken = "8902447483:AAH-zDT_BUwV3WmuW9dvkdAVKWlHP4fJowI";

const stringSession = new StringSession("");
const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
});

async function run() {
    console.log("[*] Connecting to Telegram MTProto with Bot Token...");
    await client.start({
        botAuthToken: botToken,
    });
    const me = await client.getMe();
    console.log(`✅ Logged in as Bot: @${me.username} (ID: ${me.id})`);

    // Check dialogs / chats to find the channel
    console.log("[*] Fetching dialogs to locate channel...");
    const dialogs = await client.getDialogs({ limit: 10 });
    console.log(`Found ${dialogs.length} dialogs:`);
    for (const d of dialogs) {
        console.log(`  - Title: "${d.title || d.name}" | ID: ${d.id} | Entity Type: ${d.entity?.className}`);
    }

    await client.disconnect();
    console.log("[*] Done!");
}

run().catch(err => {
    console.error("❌ Connection failed:", err);
    process.exit(1);
});
