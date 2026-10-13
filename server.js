/**
 * TELEGRAM HIGH-SPEED VIDEO STORAGE & STREAMING SERVER
 * Features:
 * 1. HTTP 206 Partial Content (RFC 7233) Range Request Streaming
 * 2. In-Memory LRU RAM Chunk Caching (<1ms seek latency)
 * 3. Native Telegram MTProto Layer 198 Client (GramJS)
 * 4. Zero 20MB file limit (supports up to 2GB/4GB per video)
 * 5. Cinema Web Player & Drag-and-Drop Video Uploader Dashboard
 */

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

import { 
    initTelegramService, 
    getVideoMetadata, 
    downloadMediaChunk, 
    uploadVideoFile, 
    listChannelVideos, 
    isTelegramReady 
} from './src/tgService.js';
import { getCachedChunk, setCachedChunk, getCacheStats } from './src/cache.js';
import { renderPlayerHtml, renderDashboardHtml } from './src/views.js';
import { findAnimeEpisode, loadCatalog, registerAnimeEpisode } from './src/catalogService.js';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '4015', 10);
const HOST = process.env.HOST || '0.0.0.0';

// Upload directory setup
const UPLOAD_DIR = path.resolve('temp_uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.mp4';
        const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_\-\[\]]/g, '_');
        cb(null, `${base}_${Date.now()}${ext}`);
    }
});
const upload = multer({ storage });

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────────────────────
// 1. DASHBOARD & UI ROUTES
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// 1. DASHBOARD & UI ROUTES
// ─────────────────────────────────────────────────────────────

app.get('/', async (req, res) => {
    try {
        const videos = await listChannelVideos(30);
        const animeCatalog = loadCatalog();
        const stats = getCacheStats();
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(renderDashboardHtml({ videos, animeCatalog, cacheStats: stats }));
    } catch (err) {
        console.error("Dashboard error:", err.message);
        res.status(500).send(`Error loading dashboard: ${err.message}`);
    }
});

app.get('/player/:messageId', async (req, res) => {
    try {
        const messageId = parseInt(req.params.messageId, 10);
        const meta = await getVideoMetadata(messageId);
        if (!meta) {
            return res.status(404).send("Video not found in storage channel");
        }

        const sizeMB = (meta.totalSize / (1024 * 1024)).toFixed(2);
        const streamUrl = `/stream/${messageId}`;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(renderPlayerHtml({
            messageId,
            fileName: meta.fileName,
            sizeMB,
            streamUrl
        }));
    } catch (err) {
        console.error("Player render error:", err.message);
        res.status(500).send(`Error loading player: ${err.message}`);
    }
});

app.get('/player/ani/:id/:ep/:track?', async (req, res) => {
    const item = findAnimeEpisode({
        anilistId: req.params.id,
        episode: req.params.ep,
        track: req.params.track || 'sub'
    });
    if (!item) {
        return res.status(404).send(`Anime episode not found (AniList: #${req.params.id}, EP: ${req.params.ep})`);
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderPlayerHtml({
        messageId: item.telegramMessageId,
        fileName: `${item.title} EP${item.episode}.mp4`,
        sizeMB: item.sizeMB,
        streamUrl: item.streamUrl || `/stream/${item.telegramMessageId}`,
        title: item.title,
        episode: item.episode,
        track: item.track,
        poster: item.poster,
        anilistId: item.anilistId,
        malId: item.malId
    }));
});

app.get('/player/mal/:id/:ep/:track?', async (req, res) => {
    const item = findAnimeEpisode({
        malId: req.params.id,
        episode: req.params.ep,
        track: req.params.track || 'sub'
    });
    if (!item) {
        return res.status(404).send(`Anime episode not found (MAL: #${req.params.id}, EP: ${req.params.ep})`);
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderPlayerHtml({
        messageId: item.telegramMessageId,
        fileName: `${item.title} EP${item.episode}.mp4`,
        sizeMB: item.sizeMB,
        streamUrl: item.streamUrl || `/stream/${item.telegramMessageId}`,
        title: item.title,
        episode: item.episode,
        track: item.track,
        poster: item.poster,
        anilistId: item.anilistId,
        malId: item.malId
    }));
});

// ─────────────────────────────────────────────────────────────
// 2. VIDEO STREAMING ENGINE (HTTP 206 PARTIAL CONTENT)
// ─────────────────────────────────────────────────────────────

async function handleTelegramStream(req, res, messageId) {
    try {
        const meta = await getVideoMetadata(messageId);

        if (!meta) {
            return res.status(404).send("Video not found");
        }

        const totalSize = meta.totalSize;
        const mimeType = meta.mimeType || 'video/mp4';
        const range = req.headers.range;

        // Instant response for HEAD probe or browsers requesting full size headers
        if (req.method === 'HEAD' || !range) {
            res.writeHead(200, {
                'Content-Length': totalSize,
                'Content-Type': mimeType,
                'Accept-Ranges': 'bytes',
                'Access-Control-Allow-Origin': '*',
                'Content-Disposition': `inline; filename="${meta.fileName}"`,
                'Cache-Control': 'public, max-age=86400'
            });
            return res.end();
        }

        // Parse Range: bytes=start-end
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        
        // Target 2 MB streaming chunks for maximum responsiveness and seeking
        const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB
        const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + CHUNK_SIZE - 1, totalSize - 1);
        const chunkLength = end - start + 1;

        // Fast In-Memory Cache Check
        const cacheKey = `${messageId}:${start}:${end}`;
        const cached = getCachedChunk(cacheKey);

        if (cached) {
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${totalSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': cached.length,
                'Content-Type': mimeType,
                'Access-Control-Allow-Origin': '*',
                'X-Cache': 'HIT',
                'Cache-Control': 'public, max-age=86400'
            });
            return res.end(cached);
        }

        // Fetch chunk via Telegram MTProto
        const chunk = await downloadMediaChunk(meta.media, start, chunkLength);
        const finalBuffer = chunk.length > chunkLength ? chunk.subarray(0, chunkLength) : chunk;

        // Store in LRU RAM cache
        setCachedChunk(cacheKey, finalBuffer);

        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${totalSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': finalBuffer.length,
            'Content-Type': mimeType,
            'Access-Control-Allow-Origin': '*',
            'X-Cache': 'MISS',
            'Cache-Control': 'public, max-age=86400'
        });

        res.end(finalBuffer);

    } catch (err) {
        console.error(`[Stream Error msg:${messageId}]:`, err.message);
        if (!res.headersSent) {
            res.status(500).send(`Streaming Error: ${err.message}`);
        }
    }
}

app.get('/stream/:messageId', async (req, res) => {
    const messageId = parseInt(req.params.messageId, 10);
    return handleTelegramStream(req, res, messageId);
});

app.get('/stream/ani/:id/:ep/:track?', async (req, res) => {
    const item = findAnimeEpisode({
        anilistId: req.params.id,
        episode: req.params.ep,
        track: req.params.track || 'sub'
    });
    if (!item) {
        return res.status(404).json({ error: "Anime episode not found in catalog", anilistId: req.params.id, episode: req.params.ep });
    }
    return handleTelegramStream(req, res, item.telegramMessageId);
});

app.get('/stream/mal/:id/:ep/:track?', async (req, res) => {
    const item = findAnimeEpisode({
        malId: req.params.id,
        episode: req.params.ep,
        track: req.params.track || 'sub'
    });
    if (!item) {
        return res.status(404).json({ error: "Anime episode not found in catalog", malId: req.params.id, episode: req.params.ep });
    }
    return handleTelegramStream(req, res, item.telegramMessageId);
});

// ─────────────────────────────────────────────────────────────
// 3. APIS: UPLOAD & FILE LISTING
// ─────────────────────────────────────────────────────────────

app.post('/api/upload', upload.single('video'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No video file provided" });
    }

    const tempPath = req.file.path;
    const originalName = req.file.originalname;

    try {
        console.log(`[*] Received upload: ${originalName} (${(req.file.size / (1024*1024)).toFixed(2)} MB)`);
        
        // Push to Telegram Storage Channel
        const messageId = await uploadVideoFile(tempPath, `🎬 ${originalName}`, originalName);
        
        // Cleanup local temp file
        try { fs.unlinkSync(tempPath); } catch {}

        res.json({
            success: true,
            messageId,
            fileName: originalName,
            streamUrl: `/stream/${messageId}`,
            playerUrl: `/player/${messageId}`
        });
    } catch (err) {
        try { fs.unlinkSync(tempPath); } catch {}
        console.error("Upload error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/files', async (req, res) => {
    try {
        const videos = await listChannelVideos(50);
        res.json(videos);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────
// 4. ANIME CATALOG MAPPING APIS
// ─────────────────────────────────────────────────────────────

app.get('/api/catalog', (req, res) => {
    res.json(loadCatalog());
});

app.get('/api/catalog/find', (req, res) => {
    const { ani, mal, ep, track } = req.query;
    const item = findAnimeEpisode({
        anilistId: ani,
        malId: mal,
        episode: ep,
        track: track || 'sub'
    });
    if (!item) return res.status(404).json({ found: false });
    res.json({ found: true, episode: item });
});

app.post('/api/catalog/register', (req, res) => {
    try {
        const record = registerAnimeEpisode(req.body);
        res.json({ success: true, record });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/health', (req, res) => {
    res.json({
        status: "online",
        telegramConnected: isTelegramReady(),
        cache: getCacheStats()
    });
});

// ─────────────────────────────────────────────────────────────
// SERVER INITIALIZATION
// ─────────────────────────────────────────────────────────────

async function startServer() {
    await initTelegramService();
    app.listen(PORT, HOST, () => {
        console.log(`================================================================`);
        console.log(`🚀 TELEGRAM VIDEO STREAM GATEWAY ONLINE`);
        console.log(`================================================================`);
        console.log(`  ⚡ Dashboard:      http://127.0.0.1:${PORT}/`);
        console.log(`  🎬 Sample Player:  http://127.0.0.1:${PORT}/player/3`);
        console.log(`  🔗 Stream URL:     http://127.0.0.1:${PORT}/stream/3`);
        console.log(`  📡 Channel:        teleBotAnime (${process.env.TELEGRAM_CHANNEL_ID})`);
        console.log(`================================================================`);
    });
}

startServer().catch(err => {
    console.error("Fatal startup error:", err);
    process.exit(1);
});

export default app;
