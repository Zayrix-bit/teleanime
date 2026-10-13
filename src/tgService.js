/**
 * TELEGRAM MTPROTO SERVICE LAYER (GRAMJS)
 * Connects directly to Telegram Data Centers using User API ID & Bot Token.
 * Provides high-speed video streaming, partial chunk retrieval, and uploading.
 */

import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const API_ID = parseInt(process.env.TELEGRAM_API_ID || '38731827', 10);
const API_HASH = process.env.TELEGRAM_API_HASH || 'f52eaaae40fbc572fcf046c82f620054';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8902447483:AAH-zDT_BUwV3WmuW9dvkdAVKWlHP4fJowI';
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || '-1004305106563';

// Session persistence to avoid re-authentication & DC migration delay
const SESSION_FILE = path.resolve('.telegram_session.txt');
let savedSession = '';
if (fs.existsSync(SESSION_FILE)) {
    try {
        savedSession = fs.readFileSync(SESSION_FILE, 'utf-8').trim();
    } catch {}
}

const stringSession = new StringSession(savedSession);
export const client = new TelegramClient(stringSession, API_ID, API_HASH, {
    connectionRetries: 10,
    autoReconnect: true
});

let channelEntity = null;
let isConnected = false;

// In-Memory Metadata Cache: Message ID -> { totalSize, mimeType, fileName, media }
const metaCache = new Map();

export async function initTelegramService() {
    if (isConnected) return;
    console.log('[*] Connecting to Telegram MTProto Data Centers...');
    await client.start({
        botAuthToken: BOT_TOKEN,
    });
    
    // Save session string for instant reconnections
    const sessionStr = client.session.save();
    try {
        fs.writeFileSync(SESSION_FILE, sessionStr);
    } catch {}

    const me = await client.getMe();
    console.log(`✅ Connected as Bot: @${me.username} (${me.id})`);

    // Resolve channel entity
    console.log(`[*] Resolving Storage Channel: ${CHANNEL_ID}...`);
    channelEntity = await client.getEntity(CHANNEL_ID);
    console.log(`✅ Storage Channel Resolved: "${channelEntity.title || channelEntity.id}"`);

    isConnected = true;
}

/**
 * Fetches and caches video metadata for a message.
 */
export async function getVideoMetadata(messageId) {
    if (metaCache.has(messageId)) {
        return metaCache.get(messageId);
    }

    if (!channelEntity) await initTelegramService();

    const messages = await client.getMessages(channelEntity, { ids: [messageId] });
    const msg = messages && messages[0];

    if (!msg || !msg.media || !msg.media.document) {
        return null;
    }

    const doc = msg.media.document;
    const totalSize = Number(doc.size);
    const mimeType = doc.mimeType || 'video/mp4';
    
    let fileName = `video_${messageId}.mp4`;
    if (doc.attributes) {
        for (const attr of doc.attributes) {
            if (attr.fileName) {
                fileName = attr.fileName;
                break;
            }
        }
    }

    const meta = {
        messageId,
        totalSize,
        mimeType,
        fileName,
        caption: msg.message || '',
        date: msg.date,
        media: msg.media
    };

    metaCache.set(messageId, meta);
    return meta;
}

/**
 * Downloads a specific byte chunk from a Telegram media document.
 */
export async function downloadMediaChunk(media, offset, limit) {
    const chunk = await client.downloadMedia(media, {
        offset: offset,
        limit: limit,
    });
    return chunk;
}

const DB_FILE = path.resolve('data/videos.json');

function loadVideosDb() {
    try {
        if (fs.existsSync(DB_FILE)) {
            return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
        }
    } catch {}
    return [];
}

function saveVideosDb(videos) {
    try {
        const dir = path.dirname(DB_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(DB_FILE, JSON.stringify(videos, null, 2));
    } catch (e) {
        console.error("DB Save error:", e);
    }
}

/**
 * Uploads a local file to the storage channel.
 */
export async function uploadVideoFile(filePath, caption = '', originalName = '') {
    if (!channelEntity) await initTelegramService();
    const cleanFileName = originalName || path.basename(filePath);

    const sent = await client.sendFile(channelEntity, {
        file: filePath,
        caption: caption || `🎬 ${cleanFileName}`,
        attributes: [
            new Api.DocumentAttributeFilename({
                fileName: cleanFileName
            }),
            new Api.DocumentAttributeVideo({
                duration: 0,
                w: 1920,
                h: 1080,
                supportsStreaming: true
            })
        ],
        forceDocument: false,
        supportsStreaming: true
    });

    const meta = await getVideoMetadata(sent.id);
    const db = loadVideosDb();
    const entry = {
        id: sent.id,
        fileName: cleanFileName,
        sizeBytes: meta?.totalSize || 0,
        sizeMB: meta ? (meta.totalSize / (1024 * 1024)).toFixed(2) : "0",
        mimeType: 'video/mp4',
        durationSec: 0,
        resolution: 'HD',
        caption: caption || '',
        date: new Date().toLocaleString()
    };
    db.unshift(entry);
    saveVideosDb(db);

    return sent.id;
}

/**
 * Lists stored video files from the database catalog.
 */
export async function listChannelVideos() {
    return loadVideosDb();
}

export function isTelegramReady() {
    return isConnected;
}
