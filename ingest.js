/**
 * CLOUD ANIME INGESTION & CONVERSION ENGINE
 * Compatible with local execution & GitHub Actions Workflows
 * 
 * Pipeline:
 * 1. Resolves Anime Metadata (AniList & MAL ID, Title, Poster)
 * 2. Scrapes Master M3U8 Stream from MegaPlay
 * 3. High-Speed Parallel Chunk Download with Fake-PNG Unmasking (Slices 252 bytes)
 * 4. Fast FFmpeg Zero-Transcode Concat (-c copy) -> Single Clean MP4
 * 5. Direct Telegram MTProto Upload to teleBotAnime Storage Channel
 * 6. Records Mapping in anime_catalog.json & Calls VPS Webhook
 */

import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import dotenv from 'dotenv';
import { registerAnimeEpisode, findAnimeEpisode } from './src/catalogService.js';

dotenv.config();

const API_ID = parseInt(process.env.TELEGRAM_API_ID || '38731827', 10);
const API_HASH = process.env.TELEGRAM_API_HASH || 'f52eaaae40fbc572fcf046c82f620054';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8902447483:AAH-zDT_BUwV3WmuW9dvkdAVKWlHP4fJowI';
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || '-1004305106563';
const MEGAPLAY_API = process.env.MEGAPLAY_API || 'http://127.0.0.1:4004';
const VPS_CALLBACK_URL = process.env.VPS_CALLBACK_URL || '';

// Parse CLI flags: --id 21 --ep 1 --start-ep 1 --end-ep 25 --type ani --track sub
function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        id: 21,
        type: 'ani',
        ep: null,
        startEp: null,
        endEp: null,
        track: 'sub'
    };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--id' || args[i] === '-i') opts.id = parseInt(args[++i], 10);
        if (args[i] === '--type' || args[i] === '-t') opts.type = args[++i].toLowerCase();
        if (args[i] === '--ep' || args[i] === '-e') opts.ep = parseInt(args[++i], 10);
        if (args[i] === '--start-ep' || args[i] === '--start') opts.startEp = parseInt(args[++i], 10);
        if (args[i] === '--end-ep' || args[i] === '--end') opts.endEp = parseInt(args[++i], 10);
        if (args[i] === '--track') opts.track = args[++i].toLowerCase();
    }
    if (opts.ep !== null && opts.startEp === null) {
        opts.startEp = opts.ep;
        opts.endEp = opts.ep;
    }
    if (opts.startEp === null) opts.startEp = 1;
    if (opts.endEp === null) opts.endEp = opts.startEp;

    return opts;
}

// 1. Resolve AniList / MAL Metadata via AniList GraphQL
async function fetchAnimeMetadata(id, type = 'ani') {
    const query = type === 'mal' 
        ? `query ($id: Int) { Media (idMal: $id, type: ANIME) { id idMal title { english romaji } coverImage { large } episodes } }`
        : `query ($id: Int) { Media (id: $id, type: ANIME) { id idMal title { english romaji } coverImage { large } episodes } }`;
    
    try {
        const res = await fetch("https://graphql.anilist.co", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query, variables: { id: parseInt(id, 10) } })
        });
        const json = await res.json();
        const media = json?.data?.Media;
        if (media) {
            return {
                anilistId: media.id,
                malId: media.idMal,
                title: media.title?.english || media.title?.romaji || `Anime #${id}`,
                poster: media.coverImage?.large || '',
                totalEpisodes: media.episodes || 0
            };
        }
    } catch (err) {
        console.warn("[Meta Warning] AniList query failed, using fallback title:", err.message);
    }
    return {
        anilistId: type === 'ani' ? id : null,
        malId: type === 'mal' ? id : null,
        title: `Anime #${id}`,
        poster: '',
        totalEpisodes: 0
    };
}

// 2. Fetch Master M3U8 from MegaPlay with Subtitles
async function fetchMegaPlayM3u8(id, ep, track, type) {
    const apiUrl = `${MEGAPLAY_API}/api/stream?id=${id}&ep=${ep}&track=${track}&type=${type}`;
    console.log(`[*] Requesting stream from MegaPlay API: ${apiUrl}`);
    const res = await fetch(apiUrl);
    const data = await res.json();
    if (!data.success || !data.stream_url) {
        throw new Error(`MegaPlay stream resolution failed: ${data.error || 'No stream_url'}`);
    }
    return {
        streamUrl: data.stream_url,
        subtitles: data.subtitles || []
    };
}

// 3. Download & Unmask Chunks in Parallel + Subtitle Embedding
async function downloadAndConcatHls(masterUrl, outputDir, title, ep, subtitles = []) {
    console.log(`[*] Fetching Master M3U8: ${masterUrl}`);
    const masterRes = await fetch(masterUrl, {
        headers: { "Referer": "https://megaplay.buzz/", "Origin": "https://megaplay.buzz", "User-Agent": "Mozilla/5.0" }
    });
    const masterText = await masterRes.text();

    // Find highest quality variant (e.g. 1080p index-f1.m3u8)
    const variantLines = masterText.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    if (!variantLines.length) throw new Error("No media playlists found in master M3U8");
    
    const subPlaylistUrl = new URL(variantLines[0].trim(), masterUrl).toString();
    console.log(`[*] Fetching highest quality variant: ${subPlaylistUrl}`);

    const subRes = await fetch(subPlaylistUrl, {
        headers: { "Referer": "https://megaplay.buzz/", "Origin": "https://megaplay.buzz", "User-Agent": "Mozilla/5.0" }
    });
    const subText = await subRes.text();

    const segmentUrls = subText.split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'))
        .map(l => new URL(l, subPlaylistUrl).toString());

    console.log(`[*] Total Segments to Download: ${segmentUrls.length}`);

    const chunksDir = path.join(outputDir, 'chunks');
    if (!fs.existsSync(chunksDir)) fs.mkdirSync(chunksDir, { recursive: true });

    // Parallel Worker Pool (15 concurrent downloads)
    const CONCURRENCY = 15;
    const downloadedFiles = new Array(segmentUrls.length);
    let completed = 0;

    async function worker(index) {
        const segUrl = segmentUrls[index];
        const segPath = path.join(chunksDir, `chunk_${String(index).padStart(4, '0')}.ts`);
        const res = await fetch(segUrl, {
            headers: { "Referer": "https://megaplay.buzz/", "Origin": "https://megaplay.buzz", "User-Agent": "Mozilla/5.0" }
        });
        const arrayBuf = await res.arrayBuffer();
        let buf = Buffer.from(arrayBuf);

        // 🚀 UNMASK FAKE PNG BYTES (Slices 252 bytes if prepended with 0x89 0x50 0x4E 0x47)
        if (buf.length >= 253 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
            buf = buf.subarray(252);
        }

        fs.writeFileSync(segPath, buf);
        downloadedFiles[index] = segPath;
        completed++;
        if (completed % 25 === 0 || completed === segmentUrls.length) {
            process.stdout.write(`\r[*] Downloaded: ${completed}/${segmentUrls.length} chunks (${Math.round((completed/segmentUrls.length)*100)}%)`);
        }
    }

    const queue = segmentUrls.map((_, i) => i);
    const workers = Array(CONCURRENCY).fill(null).map(async () => {
        while (queue.length) {
            const idx = queue.shift();
            await worker(idx);
        }
    });
    await Promise.all(workers);
    console.log("\n✅ All segments downloaded & unmasked!");

    // Download Subtitle Track if available
    let vttPath = null;
    const subObj = subtitles.find(s => s.label?.toLowerCase().includes('eng')) || subtitles[0];
    if (subObj?.url) {
        try {
            console.log(`[*] Downloading subtitle track (${subObj.label || 'English'})...`);
            const subRes = await fetch(subObj.url, {
                headers: { "Referer": "https://megaplay.buzz/", "User-Agent": "Mozilla/5.0" }
            });
            if (subRes.ok) {
                const vttText = await subRes.text();
                if (vttText && vttText.includes('WEBVTT')) {
                    vttPath = path.join(outputDir, 'subtitles.vtt');
                    fs.writeFileSync(vttPath, vttText, 'utf-8');
                    console.log(`✅ Subtitles downloaded & verified (${(vttText.length / 1024).toFixed(1)} KB)`);
                }
            }
        } catch (subErr) {
            console.warn(`[Sub Warning] Failed to download subtitles:`, subErr.message);
        }
    }

    // Generate FFmpeg concat list
    const concatListPath = path.join(outputDir, 'concat_list.txt');
    const listContent = downloadedFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n');
    fs.writeFileSync(concatListPath, listContent);

    // Fast FFmpeg concat without re-encoding (-c copy) + Subtitle embedding
    const sanitizedTitle = title.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const finalMp4Path = path.join(outputDir, `${sanitizedTitle}_EP${ep}_1080p.mp4`);
    console.log(`[*] Merging into clean MP4 with FFmpeg: ${finalMp4Path}`);

    let cmd;
    if (vttPath) {
        console.log(`[*] Embedding soft subtitle track into MP4 container (-c:s mov_text)...`);
        cmd = `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -i "${vttPath}" -c:v copy -c:a copy -c:s mov_text -metadata:s:s:0 language=eng -movflags +faststart "${finalMp4Path}"`;
    } else {
        cmd = `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c copy -movflags +faststart "${finalMp4Path}"`;
    }
    execSync(cmd, { stdio: 'ignore' });

    console.log("✅ MP4 Merged with Subtitles Successfully!");
    return finalMp4Path;
}

// 4. Ingest Single Episode with retry and skip check
async function ingestSingleEpisode(meta, ep, track, type, client, channel) {
    console.log(`\n--------------------------------------------------`);
    console.log(`▶ PROCESSING: ${meta.title} - EPISODE ${ep} [${track.toUpperCase()}]`);
    console.log(`--------------------------------------------------`);

    // Check if already in catalog
    const existing = findAnimeEpisode({
        anilistId: meta.anilistId,
        malId: meta.malId,
        episode: ep,
        track
    });
    if (existing) {
        console.log(`⏩ [Skip] Episode ${ep} is already ingested! (Telegram Message #${existing.telegramMessageId})`);
        return existing;
    }

    const workDir = path.resolve(`temp_ingest_${ep}_${Date.now()}`);
    fs.mkdirSync(workDir, { recursive: true });

    try {
        // Step 1: Stream Resolution & Subtitle Metadata
        console.log(`[*] Resolving stream from MegaPlay for EP ${ep}...`);
        const { streamUrl, subtitles } = await fetchMegaPlayM3u8(meta.anilistId || meta.malId, ep, track, type);

        // Step 2: Download & Concat with Subtitles
        console.log(`[*] Downloading chunks & assembling clean MP4...`);
        const mp4Path = await downloadAndConcatHls(streamUrl, workDir, meta.title, ep, subtitles);
        const stats = fs.statSync(mp4Path);
        const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        console.log(`   Final File Size: ${sizeMB} MB`);

        // Step 3: Upload to Telegram with FloodWait Retry
        const cleanFileName = `${meta.title} - EP${ep}.mp4`;
        const caption = `🎬 ${meta.title} - Episode ${ep} [1080p ${track.toUpperCase()}]\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `📌 AniList ID: ${meta.anilistId} | MAL ID: ${meta.malId}\n` +
                        `📊 Resolution: 1080p Full HD\n` +
                        `💾 File Size: ${sizeMB} MB\n` +
                        `#${meta.title.replace(/[^a-zA-Z0-9]/g, '')} #Episode${ep}`;

        console.log(`[*] Sending video file to Telegram channel ${CHANNEL_ID}...`);
        let sent = null;
        let attempts = 0;
        while (!sent && attempts < 4) {
            attempts++;
            try {
                sent = await client.sendFile(channel, {
                    file: mp4Path,
                    caption,
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
            } catch (uErr) {
                if (uErr.errorMessage?.includes('FLOOD_WAIT') || uErr.seconds) {
                    const waitSec = uErr.seconds || 30;
                    console.warn(`⚠️ [FloodWait] Hit Telegram rate limit. Waiting ${waitSec + 2}s before retry...`);
                    await new Promise(r => setTimeout(r, (waitSec + 2) * 1000));
                } else {
                    throw uErr;
                }
            }
        }

        console.log(`🎉 UPLOAD SUCCESS! Telegram Message ID: #${sent.id}`);

        // Update local videos.json
        try {
            const vDbPath = path.resolve('data/videos.json');
            let vDb = [];
            if (fs.existsSync(vDbPath)) vDb = JSON.parse(fs.readFileSync(vDbPath, 'utf-8'));
            vDb.unshift({
                id: sent.id,
                fileName: cleanFileName,
                sizeBytes: stats.size,
                sizeMB,
                mimeType: 'video/mp4',
                durationSec: 0,
                resolution: '1080p Full HD',
                caption,
                date: new Date().toLocaleString()
            });
            fs.writeFileSync(vDbPath, JSON.stringify(vDb, null, 2));
        } catch {}

        // Save to catalog
        const record = registerAnimeEpisode({
            anilistId: meta.anilistId,
            malId: meta.malId,
            title: meta.title,
            episode: ep,
            track,
            telegramMessageId: sent.id,
            resolution: "1080p",
            sizeBytes: stats.size,
            poster: meta.poster,
            subtitles
        });

        // Webhook
        if (VPS_CALLBACK_URL) {
            try {
                await fetch(VPS_CALLBACK_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(record)
                });
            } catch {}
        }

        console.log(`✅ [Done] EP ${ep} mapped -> Msg #${sent.id}`);
        return record;

    } finally {
        try {
            fs.rmSync(workDir, { recursive: true, force: true });
        } catch {}
    }
}

// 5. Main Batch Orchestrator
async function run() {
    const { id, type, startEp, endEp, track } = parseArgs();
    console.log("==================================================");
    console.log(`🚀 STARTING BULK ANIME INGESTION PIPELINE`);
    console.log(`   Type: ${type.toUpperCase()} | ID: ${id}`);
    console.log(`   Episodes: ${startEp} to ${endEp} (Total: ${endEp - startEp + 1}) | Track: ${track}`);
    console.log("==================================================");

    // Fetch Anime Metadata Once
    console.log("[*] Resolving anime series metadata...");
    const meta = await fetchAnimeMetadata(id, type);
    console.log(`   Series: "${meta.title}" | AniList: ${meta.anilistId} | MAL: ${meta.malId} | Total EPs: ${meta.totalEpisodes}`);

    // Connect Telegram Client Once for all episodes
    console.log("[*] Initializing Telegram MTProto client...");
    const sessionString = fs.existsSync('.telegram_session.txt') 
        ? fs.readFileSync('.telegram_session.txt', 'utf-8').trim() 
        : '';
    const client = new TelegramClient(new StringSession(sessionString), API_ID, API_HASH, {
        connectionRetries: 5,
    });
    await client.start({ botAuthToken: BOT_TOKEN });
    const channel = await client.getEntity(CHANNEL_ID);
    console.log(`✅ Connected to Telegram storage channel: "${channel.title || channel.id}"`);

    let successCount = 0;
    let failCount = 0;

    try {
        for (let ep = startEp; ep <= endEp; ep++) {
            try {
                await ingestSingleEpisode(meta, ep, track, type, client, channel);
                successCount++;
                if (ep < endEp) {
                    console.log(`⏳ Waiting 3s before next episode...`);
                    await new Promise(r => setTimeout(r, 3000));
                }
            } catch (err) {
                console.error(`❌ Error ingesting Episode ${ep}:`, err.message);
                failCount++;
            }
        }
    } finally {
        await client.disconnect();
    }

    console.log("\n==================================================");
    console.log(`🏁 BULK INGESTION RUN FINISHED!`);
    console.log(`   Successful: ${successCount}`);
    console.log(`   Failed:     ${failCount}`);
    console.log(`   Range:      EP ${startEp} to ${endEp}`);
    console.log("==================================================");
}

run().catch(err => {
    console.error("\n❌ Fatal Ingestion Error:", err);
    process.exit(1);
});
