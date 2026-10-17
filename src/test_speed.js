import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import fs from 'fs';
import dotenv from 'dotenv';
import { createSenderPool, fastUploadFile, closeSenderPool } from './fastUpload.js';

dotenv.config({ path: '/home/ubuntu/teleanime/.env' });

async function run() {
    const testFile = '/home/ubuntu/teleanime/temp_test_50mb.mp4';
    console.log('Generating 50MB test buffer on disk...');
    fs.writeFileSync(testFile, Buffer.alloc(50 * 1024 * 1024, 77));

    const sessionStr = fs.readFileSync('/home/ubuntu/teleanime/.telegram_session.txt', 'utf-8').trim();
    const client = new TelegramClient(new StringSession(sessionStr), parseInt(process.env.TELEGRAM_API_ID, 10), process.env.TELEGRAM_API_HASH, {
        connectionRetries: 5
    });

    console.log('Connecting Telegram client...');
    await client.connect();

    console.log('Creating 10 parallel MTProto TCP sockets...');
    const pool = await createSenderPool(client, 10);

    console.log('Starting Turbo Upload Test (50 MB)...');
    const t0 = Date.now();
    const inputFile = await fastUploadFile({
        client,
        senders: pool,
        filePath: testFile,
        concurrency: 12,
        onProgress: (frac, percent, uploadedMB, totalMB, speedMBs) => {
            console.log(`[Upload Progress] ${percent}% (${uploadedMB} MB / ${totalMB} MB) @ ${speedMBs} MB/s`);
        }
    });

    const totalSec = ((Date.now() - t0) / 1000).toFixed(2);
    const avgSpeed = (50 / totalSec).toFixed(2);
    console.log(`\n🎉 RESULT: 50MB uploaded in ${totalSec}s @ ${avgSpeed} MB/s! InputFile ID: ${inputFile.id}`);

    await closeSenderPool(pool);
    await client.disconnect();
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
}

run().catch(console.error);
