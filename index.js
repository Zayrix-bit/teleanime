/**
 * CLOUD STREAM SCRAPER & TELEGRAM UPLOADER PIPELINE
 * 
 * Pipeline Execution:
 * 1. Scrapes target website / resolves master m3u8 or ts stream URL (DesiDubAnime & Universal)
 * 2. Downloads and remuxes stream chunks into a clean MP4 using FFmpeg (-c copy)
 * 3. Probes video dimensions and duration with ffprobe
 * 4. Uploads to private/public Telegram Channel with native streaming attributes enabled
 * 5. Cleans up temporary files
 * 
 * Usage:
 *   node index.js --completed [--year 2022]              List completed Hindi dub anime
 *   node index.js --search "slime"                      Search anime catalog
 *   node index.js --episodes "solo-leveling-season-1"   List all episodes
 *   node index.js --anime "solo leveling" --start-ep 1 --end-ep 12   Batch ingest full season!
 *   node index.js --anime "dress up darling" --ep 1     Single episode ingest
 */

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { scrapeStream } from './src/scraper.js';
import { convertStreamToMp4, probeVideo } from './src/converter.js';
import { uploadVideo, closeTelegram } from './src/telegram.js';
import { searchAnime, getAnimeEpisodes, getCatalog, getCompletedHindiList } from './src/desidubScraper.js';

dotenv.config();

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        url: '',
        title: '',
        site: '',
        ep: '',
        startEp: null,
        endEp: null,
        anime: '',
        search: '',
        episodes: '',
        catalog: false,
        completed: false,
        year: null,
        page: 1,
        server: 'vidmoly',
        caption: '',
        channel: '',
        keepLocal: false
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--url' || arg === '-u') opts.url = args[++i];
        else if (arg === '--title' || arg === '-t') opts.title = args[++i];
        else if (arg === '--site' || arg === '-s') opts.site = args[++i];
        else if (arg === '--anime' || arg === '-a') opts.anime = args[++i];
        else if (arg === '--ep' || arg === '-e') opts.ep = args[++i];
        else if (arg === '--start-ep' || arg === '--start') opts.startEp = parseInt(args[++i], 10);
        else if (arg === '--end-ep' || arg === '--end') opts.endEp = parseInt(args[++i], 10);
        else if (arg === '--server') opts.server = args[++i];
        else if (arg === '--search') opts.search = args[++i];
        else if (arg === '--episodes') opts.episodes = args[++i];
        else if (arg === '--catalog') opts.catalog = true;
        else if (arg === '--completed') opts.completed = true;
        else if (arg === '--year' || arg === '-y') opts.year = parseInt(args[++i], 10);
        else if (arg === '--page' || arg === '-p') opts.page = parseInt(args[++i], 10);
        else if (arg === '--caption' || arg === '-c') opts.caption = args[++i];
        else if (arg === '--channel') opts.channel = args[++i];
        else if (arg === '--keep-local') opts.keepLocal = true;
    }

    return opts;
}

async function main() {
    const opts = parseArgs();

    // 1. UTILITY: COMPLETED HINDI ANIME LIST
    if (opts.completed) {
        console.log(`\n🎯 COMPLETED HINDI DUBBED ANIME LIST (${opts.year || 'ALL YEARS'}):`);
        const list = getCompletedHindiList({ year: opts.year });
        console.log(`Found ${list.length} fully completed anime seasons/shows:\n`);
        list.forEach((item, idx) => {
            console.log(` [${String(idx + 1).padStart(2, '0')}] ${item.title} (${item.season}) [${item.year}]`);
            console.log(`      EPs: ${item.episodes} | Romaji: "${item.romaji}"`);
        });
        console.log(`\n💡 To upload full season: node index.js --anime "${list[0]?.title}" --start-ep 1 --end-ep ${list[0]?.episodes}`);
        return;
    }

    // 2. UTILITY: SEARCH ANIME
    if (opts.search) {
        console.log(`\n🔍 Searching DesiDubAnime for: "${opts.search}"...`);
        const results = await searchAnime(opts.search);
        console.log(`Found ${results.length} results:`);
        results.forEach((a, i) => {
            console.log(` [${i + 1}] ${a.title}\n     Slug: ${a.slug}\n     Link: ${a.link}`);
        });
        return;
    }

    // 3. UTILITY: LIST EPISODES
    if (opts.episodes) {
        console.log(`\n📋 Fetching episodes for: "${opts.episodes}"...`);
        const eps = await getAnimeEpisodes(opts.episodes);
        console.log(`Found ${eps.length} episode(s):`);
        eps.forEach(e => {
            console.log(`  - EP ${e.episodeNumber}: ${e.url}`);
        });
        return;
    }

    // 4. UTILITY: BROWSE CATALOG
    if (opts.catalog) {
        console.log(`\n📚 Fetching DesiDubAnime Catalog (Page ${opts.page})...`);
        const cat = await getCatalog({ page: opts.page, perPage: 20 });
        console.log(`Total Anime: ${cat.totalAnime} across ${cat.totalPages} pages.`);
        cat.animeList.forEach((a, i) => {
            console.log(` [${i + 1}] ${a.title} (Slug: ${a.slug})`);
        });
        return;
    }

    // 5. MAIN INGESTION PIPELINE (SINGLE & BATCH EPISODES)
    if (!opts.url && !opts.anime && !opts.site) {
        console.log(`
🚀 Cloud Stream Scraper & Telegram Ingestion Pipeline

Commands:
  node index.js --completed [--year 2022]              View completed Hindi dubbed catalog
  node index.js --search "<keyword>"                    Search anime catalog
  node index.js --episodes "<slug_or_url>"              List all episodes
  node index.js --catalog [--page <number>]             Browse catalog
  node index.js --anime "<name>" --start-ep 1 --end-ep 12   Batch ingest full season!
  node index.js --anime "<name>" --ep <number>          Single episode ingest
  node index.js --url "<desidub_watch_url>"             Scrape & upload from watch URL

Options:
  --server        vidmoly (default), mirror, abyss, p2p
  --caption, -c   Custom caption for Telegram
  --channel       Override TELEGRAM_CHANNEL_ID
  --keep-local    Do not delete temporary MP4 after upload
        `);
        return;
    }

    const tempDir = path.resolve('temp_uploads');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const startEp = opts.startEp || (opts.ep ? parseInt(opts.ep, 10) : 1);
    const endEp = opts.endEp || startEp;
    const totalBatch = endEp - startEp + 1;

    console.log(`\n==================================================`);
    console.log(`🚀 STARTING INGESTION BATCH`);
    console.log(`   Target: ${opts.anime || opts.url}`);
    console.log(`   Episode Range: EP ${startEp} to EP ${endEp} (${totalBatch} total)`);
    console.log(`   Preferred Server: ${opts.server}`);
    console.log(`==================================================`);

    try {
        for (let currentEp = startEp; currentEp <= endEp; currentEp++) {
            let outputPath = '';
            console.log(`\n──────────────────────────────────────────────────`);
            console.log(`▶ [Episode ${currentEp}/${endEp}] Resolving stream...`);
            console.log(`──────────────────────────────────────────────────`);

            try {
                // STEP 1: RESOLVE STREAM URL
                const resolved = await scrapeStream({
                    url: opts.url,
                    site: opts.site || (opts.anime ? 'desidub' : ''),
                    query: opts.anime,
                    title: opts.title,
                    episode: currentEp,
                    server: opts.server
                });

                const videoTitle = opts.title || resolved.title || `Anime_EP_${currentEp}_${Date.now()}`;
                const sanitizedTitle = videoTitle.replace(/[^a-zA-Z0-9_\-\.\s]/g, '').trim();
                outputPath = path.join(tempDir, `${sanitizedTitle || 'stream_video'}_${Date.now()}.mp4`);

                // STEP 2: CONVERT / REMUX STREAM CHUNKS TO MP4
                console.log(`▶ [Episode ${currentEp}/${endEp}] Remuxing stream to MP4...`);
                await convertStreamToMp4({
                    streamUrl: resolved.streamUrl,
                    outputPath,
                    headers: resolved.headers
                });

                // STEP 3: PROBE VIDEO METADATA
                console.log(`▶ [Episode ${currentEp}/${endEp}] Probing video metadata...`);
                const meta = await probeVideo(outputPath);
                console.log(`ℹ️ Resolution: ${meta.width}x${meta.height} | Duration: ${meta.duration.toFixed(1)}s | Size: ${meta.sizeMB} MB`);

                // STEP 4: UPLOAD TO TELEGRAM VIA MTPROTO
                console.log(`▶ [Episode ${currentEp}/${endEp}] Uploading to Telegram channel...`);
                const defaultCaption = opts.caption || [
                    `🎬 **${videoTitle}**`,
                    resolved.episode ? `📌 Episode: ${resolved.episode}` : `📌 Episode: ${currentEp}`,
                    `🔊 Audio: Hindi Dub (Multi-Audio)`,
                    `📐 Resolution: ${meta.width}x${meta.height}`,
                    `⏱ Duration: ${Math.floor(meta.duration / 60)}m ${Math.floor(meta.duration % 60)}s`,
                    `💾 Size: ${meta.sizeMB} MB`
                ].filter(Boolean).join('\n');

                const uploadResult = await uploadVideo({
                    filePath: outputPath,
                    fileName: `${sanitizedTitle}.mp4`,
                    caption: defaultCaption,
                    duration: meta.duration,
                    width: meta.width,
                    height: meta.height,
                    channelId: opts.channel || null
                });

                console.log(`✅ [Episode ${currentEp}/${endEp}] Uploaded successfully! Msg ID: ${uploadResult.messageId}`);
                console.log(`   Link: ${uploadResult.directLink}`);

            } catch (epErr) {
                console.error(`❌ [Episode ${currentEp}/${endEp}] Error:`, epErr.message);
            } finally {
                // CLEANUP LOCAL TEMPORARY FILE
                if (outputPath && fs.existsSync(outputPath) && !opts.keepLocal) {
                    try {
                        fs.unlinkSync(outputPath);
                        console.log(`🧹 Cleaned up temporary local file: ${outputPath}`);
                    } catch {}
                }
            }
        }

        console.log(`\n==================================================`);
        console.log(`🎉 BATCH INGESTION RUN FINISHED! (Episodes ${startEp}-${endEp})`);
        console.log(`==================================================`);

    } finally {
        await closeTelegram();
    }
}

main();
