import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const API_ID = parseInt(process.env.TELEGRAM_API_ID, 10);
const API_HASH = process.env.TELEGRAM_API_HASH;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

let savedSession = '';
if (fs.existsSync('.telegram_session.txt')) {
    savedSession = fs.readFileSync('.telegram_session.txt', 'utf-8').trim();
}

const client = new TelegramClient(new StringSession(savedSession), API_ID, API_HASH, {
    connectionRetries: 5
});

async function main() {
    await client.start({ botAuthToken: BOT_TOKEN });
    const channel = await client.getEntity(CHANNEL_ID);
    console.log("Connected to channel:", channel.title);

    // Fetch message 1669 (Naruto EP 16)
    const msgs = await client.getMessages(channel, { ids: [1669] });
    const msg = msgs[0];
    if (!msg) {
        console.log("Msg 1669 not found");
        process.exit(0);
    }

    console.log("ORIGINAL CAPTION:\n" + msg.message);

    // Clean caption: filter out any line with 'Source Provider' or 'DesiDubAnime' or 'AnimeTVPlus'
    const lines = msg.message.split('\n');
    const cleanedLines = lines.filter(l => !l.toLowerCase().includes('source provider') && !l.toLowerCase().includes('desidubanime') && !l.toLowerCase().includes('animetvplus'));
    const cleanedCaption = cleanedLines.join('\n');

    console.log("\nCLEANED CAPTION:\n" + cleanedCaption);

    if (cleanedCaption !== msg.message) {
        console.log("\nEditing message 1669...");
        await client.editMessage(channel, {
            message: msg.id,
            text: cleanedCaption
        });
        console.log("✅ Message 1669 successfully edited!");
    } else {
        console.log("No changes needed.");
    }

    process.exit(0);
}

main().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
