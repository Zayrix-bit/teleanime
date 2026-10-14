/**
 * STREAM DOWNLOADER & FFMPEG CONVERTER ENGINE
 * - Downloads M3U8 HLS playlists & TS chunks
 * - Lossless Remuxing (-c copy) -> Clean MP4 in seconds with zero CPU waste
 * - Injects '+faststart' movflag for immediate Telegram in-app streaming
 * - Probes video metadata (duration, width, height) via ffprobe
 */

import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

/**
 * Downloads and converts an HLS stream (m3u8), TS chunks, or direct stream into a single MP4.
 * 
 * @param {Object} options
 * @param {string} options.streamUrl - Direct M3U8, TS, or MP4 URL
 * @param {string} options.outputPath - Destination path for MP4
 * @param {Object} [options.headers] - Custom HTTP headers (Referer, User-Agent, etc.)
 * @returns {Promise<string>} Path to finished MP4
 */
export async function convertStreamToMp4({ streamUrl, outputPath, headers = {} }) {
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    if (fs.existsSync(outputPath)) {
        try { fs.unlinkSync(outputPath); } catch {}
    }

    // Format headers for FFmpeg
    let headerStr = '';
    if (headers && Object.keys(headers).length > 0) {
        headerStr = Object.entries(headers)
            .map(([k, v]) => `${k}: ${v}\r\n`)
            .join('');
    }

    console.log(`\n==================================================`);
    console.log(`🎬 FFMPEG STREAM CONVERSION`);
    console.log(`   Source: ${streamUrl}`);
    console.log(`   Output: ${outputPath}`);
    console.log(`==================================================`);

    const headerArg = headerStr ? `-headers "${headerStr.replace(/"/g, '\\"')}"` : '';

    // Primary command: Lossless stream copy (-c copy) + faststart
    const ffmpegCmd = [
        'ffmpeg -y -hide_banner -loglevel info',
        '-protocol_whitelist "file,http,https,tcp,tls,crypto,data"',
        headerArg,
        `-i "${streamUrl}"`,
        '-c copy',
        '-bsf:a aac_adtstoasc',
        '-movflags +faststart',
        `"${outputPath}"`
    ].filter(Boolean).join(' ');

    console.log(`[*] Executing FFmpeg remuxing command...`);
    const startTime = Date.now();

    try {
        await execAsync(ffmpegCmd, { maxBuffer: 1024 * 1024 * 50 });
    } catch (err) {
        console.warn(`[!] Primary remux failed (${err.message.slice(0, 150)}). Retrying with audio re-encode...`);
        // Fallback command: Copy video stream, re-encode audio to AAC if bitstream filter complains
        const fallbackCmd = [
            'ffmpeg -y -hide_banner -loglevel warning',
            '-protocol_whitelist "file,http,https,tcp,tls,crypto,data"',
            headerArg,
            `-i "${streamUrl}"`,
            '-c:v copy -c:a aac -b:a 128k',
            '-movflags +faststart',
            `"${outputPath}"`
        ].filter(Boolean).join(' ');

        await execAsync(fallbackCmd, { maxBuffer: 1024 * 1024 * 50 });
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
        throw new Error(`FFmpeg finished but output MP4 was not created or is empty: ${outputPath}`);
    }

    const sizeMB = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2);
    console.log(`✅ Converted to MP4 in ${elapsed}s! (Size: ${sizeMB} MB)`);

    return outputPath;
}

/**
 * Probes the MP4 file to retrieve exact duration, width, and height.
 * 
 * @param {string} filePath 
 * @returns {Promise<{ duration: number, width: number, height: number, sizeMB: string }>}
 */
export async function probeVideo(filePath) {
    const stats = fs.statSync(filePath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

    const probeCmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration -show_entries format=duration -of json "${filePath}"`;

    try {
        const { stdout } = await execAsync(probeCmd);
        const data = JSON.parse(stdout);
        const stream = data.streams?.[0] || {};
        const format = data.format || {};

        const duration = parseFloat(stream.duration || format.duration || '0');
        const width = parseInt(stream.width || '1920', 10);
        const height = parseInt(stream.height || '1080', 10);

        return {
            duration,
            width,
            height,
            sizeMB
        };
    } catch (err) {
        console.warn(`[!] ffprobe failed to read metadata, using defaults: ${err.message}`);
        return {
            duration: 0,
            width: 1920,
            height: 1080,
            sizeMB
        };
    }
}
