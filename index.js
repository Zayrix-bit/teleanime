/**
 * CLOUD STREAM SCRAPER & TELEGRAM UPLOADER PIPELINE
 * 
 * Pipeline Execution:
 * 1. Scrapes target website / resolves master m3u8 or ts stream URL
 * 2. Downloads and remuxes stream chunks into a clean, single MP4 using FFmpeg (-c copy)
 * 3. Probes video dimensions and duration with ffprobe
 * 4. Uploads to private/public Telegram Channel with native streaming attributes enabled
 * 5. Cleans up temporary files
 * 
 * Usage:
 *   node index.js --url "https://example.com/playlist.m3u8" --title "Episode 01"
 *   node index.js --site "mysite" --ep 1 --title "My Show"
 */

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { scrapeStream } from './src/scraper.js';
import { convertStreamToMp4, probeVideo } from './src/converter.js';
import { uploadVideo, closeTelegram } from './src/telegram.js';

dotenv.config();

// Parse CLI arguments
function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        url: '',
        title: '',
        site: '',
        ep: '',
        caption: '',
        channel: '',
        keepLocal: false
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--url' || arg === '-u') opts.url = args[++i];
        else if (arg === '--title' || arg === '-t') opts.title = args[++i];
        else if (arg === '--site' || arg === '-s') opts.site = args[++i];
        else if (arg === '--ep' || arg === '-e') opts.ep = args[++i];
        else if (arg === '--caption' || arg === '-c') opts.caption = args[++i];
        else if (arg === '--channel') opts.channel = args[++i];
        else if (arg === '--keep-local') opts.keepLocal = true;
    }

    return opts;
}

async function main() {
    const opts = parseArgs();

    if (!opts.url && !opts.site) {
        console.error("❌ Error: Missing required arguments.");
        console.log(`
Usage:
  node index.js --url "<stream_or_page_url>" --title "<title>" [options]
  node index.js --site "<site_name>" --ep <number> --title "<title>" [options]

Options:
  --url, -u       Target URL or direct stream link (m3u8, mp4, ts)
  --site, -s      Scraper plugin identifier (when custom scraper is plugged in)
  --title, -t     Video title / episode name
  --ep, -e        Episode number
  --caption, -c   Custom caption for Telegram message
  --channel       Telegram Channel ID override
  --keep-local    Do not delete temporary MP4 after upload
        `);
        process.exit(1);
    }

    const tempDir = path.resolve('temp_uploads');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    let outputPath = '';

    try {
        // STEP 1: SCRAPE / RESOLVE STREAM URL
        console.log("▶ [Step 1/4] Resolving stream source...");
        const resolved = await scrapeStream({
            url: opts.url,
            site: opts.site,
            title: opts.title,
            episode: opts.ep
        });

        const videoTitle = opts.title || resolved.title || `Video_${Date.now()}`;
        const sanitizedTitle = videoTitle.replace(/[^a-zA-Z0-9_\-\.\s]/g, '').trim();
        outputPath = path.join(tempDir, `${sanitizedTitle || 'stream_video'}_${Date.now()}.mp4`);

        // STEP 2: CONVERT / REMUX STREAM CHUNKS TO MP4
        console.log("▶ [Step 2/4] Downloading & converting stream chunks to MP4...");
        await convertStreamToMp4({
            streamUrl: resolved.streamUrl,
            outputPath,
            headers: resolved.headers
        });

        // STEP 3: PROBE VIDEO METADATA (DURATION & RESOLUTION)
        console.log("▶ [Step 3/4] Extracting video metadata...");
        const meta = await probeVideo(outputPath);
        console.log(`ℹ️ Resolution: ${meta.width}x${meta.height} | Duration: ${meta.duration.toFixed(1)}s | Size: ${meta.sizeMB} MB`);

        // STEP 4: UPLOAD TO TELEGRAM VIA MTPROTO
        console.log("▶ [Step 4/4] Uploading video to Telegram storage channel...");
        const defaultCaption = opts.caption || [
            `🎬 **${videoTitle}**`,
            opts.ep ? `📌 Episode: ${opts.ep}` : '',
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

        console.log("==================================================");
        console.log(`✨ PIPELINE COMPLETED SUCCESSFULLY!`);
        console.log(`   Uploaded Message ID: ${uploadResult.messageId}`);
        console.log(`   Telegram Link: ${uploadResult.directLink}`);
        console.log("==================================================");

    } catch (err) {
        console.error("\n❌ Pipeline failed with error:", err.message);
        process.exitCode = 1;
    } finally {
        // CLEANUP LOCAL TEMPORARY FILE
        if (outputPath && fs.existsSync(outputPath) && !opts.keepLocal) {
            try {
                fs.unlinkSync(outputPath);
                console.log(`🧹 Cleaned up temporary local file: ${outputPath}`);
            } catch {}
        }

        // CLOSE TELEGRAM SESSION CLEANLY
        await closeTelegram();
    }
}

main();
