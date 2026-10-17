/**
 * TELEGRAM MTPROTO TURBO UPLOAD ENGINE (GramJS + Multi-Socket Pool)
 * - Multi-Socket MTProto architecture (8-10 parallel TCP connections to DC)
 * - 512 KB chunk size for maximum TCP throughput over high-latency links
 * - Fast chunked upload supporting files up to 2GB / 4GB
 * - Enables 'supportsStreaming' flag for instant Telegram in-app streaming
 * - Real-time terminal/CI progress reporting
 */

import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { createSenderPool, fastUploadFile, closeSenderPool } from './fastUpload.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../.env');

// Force-load root .env regardless of working directory
if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
}
dotenv.config();

const SESSION_FILE = path.resolve(__dirname, '../.telegram_session.txt');

let client = null;
let channelEntity = null;
let senderPool = null;

function getCredentials() {
    return {
        API_ID: parseInt(process.env.TELEGRAM_API_ID || '', 10),
        API_HASH: process.env.TELEGRAM_API_HASH || '',
        BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
        DEFAULT_CHANNEL_ID: process.env.TELEGRAM_CHANNEL_ID || ''
    };
}

/**
 * Initializes and connects the Telegram MTProto client and multi-socket pool.
 */
export async function initTelegram(channelIdOverride = null) {
    const { API_ID, API_HASH, BOT_TOKEN, DEFAULT_CHANNEL_ID } = getCredentials();

    if (!API_ID || !API_HASH || !BOT_TOKEN) {
        throw new Error("Missing TELEGRAM_API_ID, TELEGRAM_API_HASH, or TELEGRAM_BOT_TOKEN in environment.");
    }

    let savedSession = '';
    if (fs.existsSync(SESSION_FILE)) {
        try {
            savedSession = fs.readFileSync(SESSION_FILE, 'utf-8').trim();
        } catch {}
    }

    client = new TelegramClient(new StringSession(savedSession), API_ID, API_HASH, {
        connectionRetries: 10,
        autoReconnect: true
    });

    console.log('[*] Connecting to Telegram MTProto Data Centers...');
    await client.start({
        botAuthToken: BOT_TOKEN,
    });

    // Save session string for instant subsequent connections
    try {
        const sessionStr = client.session.save();
        fs.writeFileSync(SESSION_FILE, sessionStr);
    } catch {}

    const me = await client.getMe();
    console.log(`✅ Telegram Connected: @${me.username} (ID: ${me.id})`);

    const targetChannel = channelIdOverride || DEFAULT_CHANNEL_ID;
    if (!targetChannel) {
        throw new Error("No TELEGRAM_CHANNEL_ID specified.");
    }

    console.log(`[*] Resolving Storage Channel: ${targetChannel}...`);
    channelEntity = await client.getEntity(targetChannel);
    console.log(`✅ Target Channel Ready: "${channelEntity.title || channelEntity.id}"`);

    // Initialize 8-socket Turbo MTProto Pool
    try {
        senderPool = await createSenderPool(client, 8);
    } catch (poolErr) {
        console.warn(`[!] Turbo pool setup notice: ${poolErr.message}`);
    }

    return client;
}

/**
 * Uploads a local MP4 file to the Telegram channel at turbo speed.
 * 
 * @param {Object} options
 * @param {string} options.filePath - Path to local .mp4 video file
 * @param {string} options.fileName - Display filename
 * @param {string} [options.caption] - Message caption
 * @param {number} [options.duration] - Video duration in seconds
 * @param {number} [options.width] - Video width in pixels
 * @param {number} [options.height] - Video height in pixels
 * @param {string} [options.channelId] - Optional channel ID override
 */
export async function uploadVideo({
    filePath,
    fileName,
    caption = '',
    duration = 0,
    width = 1920,
    height = 1080,
    channelId = null
}) {
    if (!client || !channelEntity) {
        await initTelegram(channelId);
    }

    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }

    const stats = fs.statSync(filePath);
    const totalSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    const cleanFileName = fileName || path.basename(filePath);

    console.log(`\n==================================================`);
    console.log(`🚀 STARTING TELEGRAM TURBO UPLOAD (Multi-Socket MTProto)`);
    console.log(`   File: ${cleanFileName}`);
    console.log(`   Size: ${totalSizeMB} MB`);
    console.log(`   Resolution: ${width}x${height} | Duration: ${Math.round(duration)}s`);
    console.log(`==================================================`);

    const startTime = Date.now();
    let inputFile = null;

    // Make sure Turbo Sender Pool is ready
    if (!senderPool || senderPool.length === 0) {
        try {
            senderPool = await createSenderPool(client, 8);
        } catch (e) {
            console.warn(`[!] Sender pool refresh note: ${e.message}`);
        }
    }

    try {
        // Parallel MTProto chunk upload over 8 sockets with 512KB chunks
        inputFile = await fastUploadFile({
            client,
            senders: senderPool,
            filePath,
            fileName: cleanFileName,
            concurrency: 10,
            onProgress: (frac, percent, uploadedMB, totalMB, speedMBs) => {
                console.log(`[Upload Progress] ${percent}% (${uploadedMB} MB / ${totalMB} MB) @ ${speedMBs} MB/s`);
            }
        });
    } catch (uploadErr) {
        console.warn(`[!] Turbo parallel upload hit error: ${uploadErr.message}. Falling back to standard upload...`);
        inputFile = filePath;
    }

    console.log(`[*] Chunks uploaded. Finalizing Telegram media message...`);

    const sent = await client.sendFile(channelEntity, {
        file: inputFile,
        workers: 8,
        caption: caption || `🎬 **${cleanFileName}**\n💾 Size: ${totalSizeMB} MB`,
        attributes: [
            new Api.DocumentAttributeFilename({
                fileName: cleanFileName
            }),
            new Api.DocumentAttributeVideo({
                duration: Math.round(duration) || 0,
                w: width || 1920,
                h: height || 1080,
                supportsStreaming: true
            })
        ],
        forceDocument: false,
        supportsStreaming: true
    });

    const elapsedTotal = ((Date.now() - startTime) / 1000).toFixed(1);
    const overallSpeed = (stats.size / (1024 * 1024) / (elapsedTotal || 1)).toFixed(2);
    console.log(`\n🎉 TURBO UPLOAD COMPLETE in ${elapsedTotal}s @ ${overallSpeed} MB/s!`);
    console.log(`   Message ID: ${sent.id}`);

    // Clean channel identifier for direct links
    const rawChan = String(channelEntity.id || '').replace(/^-100/, '');
    const directLink = `https://t.me/c/${rawChan}/${sent.id}`;
    console.log(`   Direct Link: ${directLink}`);
    console.log(`==================================================\n`);

    return {
        messageId: sent.id,
        channelId: channelEntity.id,
        directLink,
        sizeBytes: stats.size,
        fileName: cleanFileName
    };
}

/**
 * Disconnects the client and sender pool cleanly.
 */
export async function closeTelegram() {
    if (senderPool) {
        try {
            await closeSenderPool(senderPool);
        } catch {}
        senderPool = null;
    }
    if (client) {
        try {
            await client.disconnect();
            console.log('[*] Telegram Client disconnected cleanly.');
        } catch {}
        client = null;
        channelEntity = null;
    }
}
