import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const apiId = 38731827;
const apiHash = "f52eaaae40fbc572fcf046c82f620054";
const botToken = "8902447483:AAH-zDT_BUwV3WmuW9dvkdAVKWlHP4fJowI";
const channelId = "-1004305106563";

const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 5,
});

async function run() {
    await client.start({ botAuthToken: botToken });
    const entity = await client.getEntity(channelId);
    console.log("[*] Fetching message 3...");
    const msgs = await client.getMessages(entity, { ids: [3] });
    const msg = msgs[0];
    if (!msg || !msg.media || !msg.media.document) {
        throw new Error("No media in message 3");
    }
    const doc = msg.media.document;
    console.log(`Document ID: ${doc.id}, Size: ${doc.size} bytes, Mime: ${doc.mimeType}`);

    console.log("[*] Testing chunk download (first 1024 bytes)...");
    const chunk = await client.downloadMedia(msg.media, {
        offset: 0,
        limit: 1024,
    });
    console.log(`✅ Downloaded Chunk! Length: ${chunk.length} bytes`);
    console.log(`First 16 bytes hex: ${chunk.subarray(0, 16).toString('hex')}`);

    await client.disconnect();
}

run().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
