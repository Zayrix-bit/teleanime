/**
 * CRUNCHYROLL & LOCAL HINDI DUB ANIME INGESTION ENGINE
 * 
 * Features:
 * 1. Automatically parses anime name & episode number from downloaded filenames.
 * 2. Auto-resolves AniList ID, MAL ID & HD Poster via AniList GraphQL.
 * 3. Lossless FFmpeg remuxing (.mkv -> .mp4) in < 2 seconds without re-encoding.
 * 4. High-Speed MTProto Telegram Upload with 1080p streaming player attributes.
 * 5. Registers to Anime Catalog under track: 'hindi'.
 * 6. Live folder watcher mode for continuous automated ingestion.
 * 
 * Usage:
 *   node ingest_hindi.js --file "path/to/video.mp4"
 *   node ingest_hindi.js --folder "C:/Users/.../hindi_anime"
 *   node ingest_hindi.js --watch "hindi_queue"
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import dotenv from 'dotenv';
import { Api } from 'telegram';
import { initTelegramService, client } from './src/tgService.js';
import { registerAnimeEpisode, findAnimeEpisode } from './src/catalogService.js';

dotenv.config();

const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || '-1004305106563';

// 1. Search AniList GraphQL API for ID, MAL ID, English Title & Poster
async function resolveAnimeMeta(rawTitle) {
    const cleanSearch = rawTitle
        .replace(/\[[^\]]*\]/g, '')     // remove [Tags]
        .replace(/\([^\)]*\)/g, '')     // remove (Tags)
        .replace(/S\d+E\d+/i, '')       // remove S01E01
        .replace(/Season\s*\d+/i, '')
        .replace(/Episode\s*\d+/i, '')
        .replace(/EP\s*\d+/i, '')
        .replace(/1080p|720p|480p|x264|x265|hevc|web-dl|bluray/gi, '')
        .replace(/[-_.]/g, ' ')
        .trim();

    console.log(`[*] Querying AniList GraphQL for: "${cleanSearch}"...`);
    const query = `
        query ($search: String) {
            Media(search: $search, type: ANIME) {
                id
                idMal
                title {
                    english
                    romaji
                }
                coverImage {
                    large
                }
                episodes
            }
        }
    `;

    try {
        const res = await fetch('https://graphql.anilist.co', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, variables: { search: cleanSearch } })
        });
        const data = await res.json();
        const media = data.data?.Media;

        if (media) {
            const title = media.title.english || media.title.romaji || cleanSearch;
            return {
                anilistId: media.id,
                malId: media.idMal,
                title,
                poster: media.coverImage?.large || '',
                totalEpisodes: media.episodes || 0
            };
        }
    } catch (err) {
        console.warn(`[AniList Warning] ${err.message}`);
    }

    return {
        anilistId: null,
        malId: null,
        title: cleanSearch,
        poster: '',
        totalEpisodes: 0
    };
}

// 2. Parse Filename into Title and Episode number
function parseFileDetails(filePath) {
    const baseName = path.basename(filePath, path.extname(filePath));

    // Try finding Episode pattern (S01E05, E05, EP05, Episode 5, - 05)
    let ep = 1;
    const sEpMatch = baseName.match(/S\d+E(\d+)/i);
    const epMatch = baseName.match(/(?:EP|Episode)[\s._-]*(\d+)/i);
    const dashMatch = baseName.match(/[-_]\s*(\d{1,3})(?:\s*\[|\s*\(|\s*\.|$)/);
    const standaloneMatch = baseName.match(/\b(\d{1,3})\b/);

    if (sEpMatch) {
        ep = parseInt(sEpMatch[1], 10);
    } else if (epMatch) {
        ep = parseInt(epMatch[1], 10);
    } else if (dashMatch) {
        ep = parseInt(dashMatch[1], 10);
    } else if (standaloneMatch) {
        ep = parseInt(standaloneMatch[1], 10);
    }

    // Clean Title extraction
    let title = baseName
        .replace(/\[[^\]]*\]/g, '')
        .replace(/\([^\)]*\)/g, '')
        .replace(/S\d+E\d+/i, '')
        .replace(/(?:EP|Episode)[\s._-]*\d+/i, '')
        .replace(/\b(1080p|720p|480p|x264|x265|hevc|web-dl|bluray|esub|hindi|dub|multi|audio|dual)\b/gi, '')
        .replace(/[-_.]/g, ' ')
        .replace(/\b\d{1,3}\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim();

    return { title, episode: ep };
}

// 3. Process & Upload Single Hindi Dub Video File
export async function processHindiVideoFile(filePath, channel) {
    console.log(`\n==================================================`);
    console.log(`🇮🇳 PROCESSING HINDI DUB FILE: ${path.basename(filePath)}`);
    console.log(`==================================================`);

    if (!fs.existsSync(filePath)) {
        throw new Error(`File does not exist: ${filePath}`);
    }

    const { title: guessedTitle, episode } = parseFileDetails(filePath);
    const meta = await resolveAnimeMeta(guessedTitle);

    console.log(`   Anime:   "${meta.title}"`);
    console.log(`   Episode: ${episode} [HINDI DUB]`);
    console.log(`   AniList: #${meta.anilistId || 'N/A'} | MAL: #${meta.malId || 'N/A'}`);

    // Check if already in catalog
    const existing = findAnimeEpisode({
        anilistId: meta.anilistId,
        malId: meta.malId,
        episode,
        track: 'hindi'
    });
    if (existing) {
        console.log(`⏩ [Skip] ${meta.title} EP ${episode} (Hindi Dub) is already in catalog! (Msg #${existing.telegramMessageId})`);
        return existing;
    }

    // Remux to fast-start MP4 if needed (.mkv, .ts, etc.)
    let uploadPath = filePath;
    let tempRemux = null;
    const ext = path.extname(filePath).toLowerCase();

    if (ext !== '.mp4') {
        tempRemux = path.resolve(`temp_remux_${Date.now()}.mp4`);
        console.log(`[*] Fast remuxing ${ext} -> .mp4 container (-c copy)...`);
        execSync(`ffmpeg -y -i "${filePath}" -c copy -movflags +faststart "${tempRemux}"`, { stdio: 'ignore' });
        uploadPath = tempRemux;
    }

    try {
        const stats = fs.statSync(uploadPath);
        const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        const cleanFileName = `${meta.title} - EP${episode} [HINDI DUB].mp4`;

        const caption = `🎬 ${meta.title} - Episode ${episode} [1080p HINDI DUB 🇮🇳]\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `📌 AniList ID: ${meta.anilistId || 'N/A'} | MAL ID: ${meta.malId || 'N/A'}\n` +
                        `🎙️ Audio: Official Hindi Dub (Crunchyroll)\n` +
                        `📊 Resolution: 1080p Full HD\n` +
                        `💾 File Size: ${sizeMB} MB\n` +
                        `#${meta.title.replace(/[^a-zA-Z0-9]/g, '')} #HindiDub #Episode${episode}`;

        console.log(`[*] Uploading ${sizeMB} MB to Telegram Storage Channel...`);

        let sent = null;
        let attempts = 0;
        while (!sent && attempts < 4) {
            attempts++;
            try {
                sent = await client.sendFile(channel, {
                    file: uploadPath,
                    caption,
                    attributes: [
                        new Api.DocumentAttributeFilename({ fileName: cleanFileName }),
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
                    console.warn(`⚠️ [FloodWait] Waiting ${waitSec + 2}s...`);
                    await new Promise(r => setTimeout(r, (waitSec + 2) * 1000));
                } else {
                    throw uErr;
                }
            }
        }

        console.log(`🎉 UPLOAD SUCCESS! Telegram Message ID: #${sent.id}`);

        // Register into catalog with track: 'hindi'
        const record = registerAnimeEpisode({
            anilistId: meta.anilistId,
            malId: meta.malId,
            title: meta.title,
            episode,
            track: 'hindi',
            telegramMessageId: sent.id,
            resolution: "1080p",
            sizeBytes: stats.size,
            poster: meta.poster,
            subtitles: []
        });

        console.log(`✅ [Catalog] Registered ${meta.title} EP ${episode} [HINDI] -> Msg #${sent.id}`);
        console.log(`   🔗 Embed:  /embed/ani/${meta.anilistId}/${episode}/hindi`);
        console.log(`   🔗 Stream: /stream/ani/${meta.anilistId}/${episode}/hindi`);
        return record;

    } finally {
        if (tempRemux && fs.existsSync(tempRemux)) {
            try { fs.unlinkSync(tempRemux); } catch {}
        }
    }
}

// 4. Batch Folder Ingest
async function ingestFolder(folderPath, channel) {
    console.log(`[*] Scanning folder: ${folderPath}`);
    const files = fs.readdirSync(folderPath)
        .filter(f => /\.(mp4|mkv|ts|mov)$/i.test(f))
        .map(f => path.join(folderPath, f));

    console.log(`[*] Found ${files.length} video files to ingest.`);
    for (const f of files) {
        try {
            await processHindiVideoFile(f, channel);
            await new Promise(r => setTimeout(r, 3000));
        } catch (err) {
            console.error(`❌ Failed to ingest ${f}:`, err.message);
        }
    }
}

// 5. Watcher Mode (Monitors queue folder in realtime)
async function startWatcher(queueDir, channel) {
    if (!fs.existsSync(queueDir)) fs.mkdirSync(queueDir, { recursive: true });
    const completedDir = path.join(queueDir, 'completed');
    if (!fs.existsSync(completedDir)) fs.mkdirSync(completedDir, { recursive: true });

    console.log(`==========================================================`);
    console.log(`👀 LIVE HINDI DUB QUEUE WATCHER ACTIVE: ${queueDir}`);
    console.log(`Drop any downloaded Crunchyroll Hindi .mp4/.mkv file here.`);
    console.log(`==========================================================`);

    const processed = new Set();

    setInterval(async () => {
        try {
            const files = fs.readdirSync(queueDir)
                .filter(f => /\.(mp4|mkv|ts)$/i.test(f))
                .filter(f => !f.endsWith('.crdownload') && !f.endsWith('.part'))
                .map(f => path.join(queueDir, f));

            for (const f of files) {
                if (processed.has(f)) continue;
                processed.add(f);

                // Wait 2 seconds to make sure file write finished
                await new Promise(r => setTimeout(r, 2000));

                try {
                    await processHindiVideoFile(f, channel);
                    // Move to completed
                    const dest = path.join(completedDir, path.basename(f));
                    fs.renameSync(f, dest);
                    console.log(`📦 Moved to completed: ${dest}`);
                } catch (e) {
                    console.error(`Error processing ${f}:`, e.message);
                    processed.delete(f);
                }
            }
        } catch {}
    }, 5000);
}

// CLI Execution
async function main() {
    const args = process.argv.slice(2);
    const getArg = (flag) => {
        const idx = args.indexOf(flag);
        return idx !== -1 ? args[idx + 1] : null;
    };

    await initTelegramService();
    const channel = await client.getEntity(CHANNEL_ID);

    const singleFile = getArg('--file');
    const folder = getArg('--folder');
    const watchDir = getArg('--watch');

    if (singleFile) {
        await processHindiVideoFile(path.resolve(singleFile), channel);
        process.exit(0);
    } else if (folder) {
        await ingestFolder(path.resolve(folder), channel);
        process.exit(0);
    } else if (watchDir) {
        await startWatcher(path.resolve(watchDir), channel);
    } else {
        // Default to watching 'hindi_queue'
        const defaultQueue = path.resolve('hindi_queue');
        await startWatcher(defaultQueue, channel);
    }
}

if (process.argv[1]?.endsWith('ingest_hindi.js')) {
    main().catch(err => {
        console.error("Fatal error:", err);
        process.exit(1);
    });
}
