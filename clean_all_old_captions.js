import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import dotenv from 'dotenv';
import fs from 'fs';
import { execSync } from 'child_process';

dotenv.config();

const API_ID = parseInt(process.env.TELEGRAM_API_ID, 10);
const API_HASH = process.env.TELEGRAM_API_HASH;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const DB_PATH = '/www/wwwroot/anilist_database/anilist.db';

let savedSession = '';
if (fs.existsSync('.telegram_session.txt')) {
    savedSession = fs.readFileSync('.telegram_session.txt', 'utf-8').trim();
}

const client = new TelegramClient(new StringSession(savedSession), API_ID, API_HASH, {
    connectionRetries: 10
});

function getAllUploadedMsgIds() {
    const raw = execSync(`sqlite3 ${DB_PATH} "SELECT telegram_message_id FROM telegram_hindi_episodes WHERE is_uploaded = 1 AND telegram_message_id > 0 ORDER BY telegram_message_id DESC;"`).toString();
    return raw.trim().split('\n').map(id => parseInt(id.trim(), 10)).filter(Boolean);
}

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function main() {
    console.log("🚀 Starting Bulk Caption Cleaner for all uploaded anime videos...");
    await client.start({ botAuthToken: BOT_TOKEN });
    const channel = await client.getEntity(CHANNEL_ID);
    console.log(`Connected to channel: "${channel.title}"`);

    const msgIds = await getAllUploadedMsgIds();
    console.log(`Found ${msgIds.length} uploaded message IDs to inspect.`);

    let cleanedCount = 0;
    let skippedCount = 0;
    let errorsCount = 0;

    // Process in batches of 50
    const batchSize = 50;
    for (let i = 0; i < msgIds.length; i += batchSize) {
        const batch = msgIds.slice(i, i + batchSize);
        try {
            const msgs = await client.getMessages(channel, { ids: batch });
            for (const msg of msgs) {
                if (!msg || !msg.message) {
                    skippedCount++;
                    continue;
                }

                const rawText = msg.message;
                const lower = rawText.toLowerCase();

                // Check if contains any provider / website reference
                if (lower.includes('source provider') || lower.includes('desidub') || lower.includes('animetvplus')) {
                    const lines = rawText.split('\n');
                    const filteredLines = lines.filter(line => {
                        const l = line.toLowerCase();
                        return !l.includes('source provider') && !l.includes('desidub') && !l.includes('animetvplus');
                    });
                    const newCaption = filteredLines.join('\n');

                    if (newCaption !== rawText) {
                        try {
                            await client.editMessage(channel, {
                                message: msg.id,
                                text: newCaption
                            });
                            cleanedCount++;
                            if (cleanedCount % 10 === 0) {
                                console.log(`[${i + 1}/${msgIds.length}] 🧼 Cleaned ${cleanedCount} messages so far... (Latest: Msg ${msg.id})`);
                            }
                            await sleep(400); // Safe delay
                        } catch (editErr) {
                            if (editErr.seconds) {
                                console.log(`⏳ FloodWait: sleeping ${editErr.seconds}s...`);
                                await sleep((editErr.seconds + 1) * 1000);
                                // retry once
                                await client.editMessage(channel, { message: msg.id, text: newCaption });
                                cleanedCount++;
                            } else {
                                errorsCount++;
                            }
                        }
                    } else {
                        skippedCount++;
                    }
                } else {
                    skippedCount++;
                }
            }
        } catch (batchErr) {
            console.error(`Batch error at index ${i}:`, batchErr.message);
            await sleep(2000);
        }
        await sleep(200);
    }

    console.log(`\n🎉 CAPTION CLEANING COMPLETE!`);
    console.log(`   🧼 Total Cleaned: ${cleanedCount}`);
    console.log(`   ⏭ Already Clean / Skipped: ${skippedCount}`);
    console.log(`   ⚠️ Errors: ${errorsCount}`);
    process.exit(0);
}

main().catch(err => {
    console.error("Fatal:", err);
    process.exit(1);
});
