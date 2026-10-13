import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import path from 'path';

const apiId = 38731827;
const apiHash = "f52eaaae40fbc572fcf046c82f620054";
const botToken = "8902447483:AAH-zDT_BUwV3WmuW9dvkdAVKWlHP4fJowI";
const channelId = "-1004305106563";

const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 5,
});

async function run() {
    console.log("[*] Connecting client...");
    await client.start({ botAuthToken: botToken });
    console.log("[*] Resolving channel entity...");
    const entity = await client.getEntity(channelId);
    console.log(`[*] Target Channel: ${entity.title || entity.id}`);

    const filePath = path.resolve('sample_test.mp4');
    console.log(`[*] Uploading ${filePath} to channel...`);
    
    const sent = await client.sendFile(entity, {
        file: filePath,
        caption: "🎬 Test Video 720p - Telegram Streamer Proof of Concept",
        attributes: [
            // Marks it as video file
        ]
    });

    console.log("==================================================");
    console.log(`🎉 VIDEO UPLOADED SUCCESSFULLY!`);
    console.log(`   Message ID: ${sent.id}`);
    console.log(`   Direct Link: https://t.me/c/4305106563/${sent.id}`);
    console.log("==================================================");

    await client.disconnect();
}

run().catch(err => {
    console.error("❌ Upload error:", err);
    process.exit(1);
});
