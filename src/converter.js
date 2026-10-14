/**
 * STREAM DOWNLOADER & FFMPEG CONVERTER ENGINE WITH SMART HIGHEST QUALITY SELECTOR
 * - Parses HLS Master Playlists dynamically
 * - Auto-detects and locks to the HIGHEST resolution available (1080p > 720p > 480p > 360p)
 * - Retains and prioritizes all audio tracks (Hindi Dub, Japanese, English, etc.)
 * - Lossless Remuxing (-c copy) -> Output clean MP4 in seconds with zero CPU waste
 * - Injects '+faststart' movflag for immediate Telegram in-app streaming
 * - Probes video metadata (duration, width, height) via ffprobe
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Creates an in-memory micro proxy that parses a Master M3U8,
 * extracts all quality variants, locks to the HIGHEST QUALITY (1080p / 720p),
 * preserves all audio tracks (prioritizing Hindi), and serves the optimized playlist.
 * 
 * @param {string} masterUrl 
 * @param {Object} headers 
 * @returns {Promise<{ isMaster: boolean, streamUrl: string, topVariant?: Object, variants?: Array, close: () => void }>}
 */
export async function createSmartMasterServer(masterUrl, headers = {}) {
    console.log(`\n🔍 [SMART QUALITY ENGINE] Analyzing stream: ${masterUrl}`);
    
    // Only attempt to parse if it's an HLS playlist URL
    if (!masterUrl.includes('.m3u8') && !masterUrl.includes('hls')) {
        console.log(`[i] Direct media URL detected, proceeding directly.`);
        return { isMaster: false, streamUrl: masterUrl, close: () => {} };
    }

    let content = '';
    try {
        const res = await fetch(masterUrl, { headers });
        if (!res.ok) {
            console.warn(`[!] Master playlist fetch returned ${res.status}, passing URL directly.`);
            return { isMaster: false, streamUrl: masterUrl, close: () => {} };
        }
        content = await res.text();
    } catch (e) {
        console.warn(`[!] Failed to probe master playlist (${e.message}), passing URL directly.`);
        return { isMaster: false, streamUrl: masterUrl, close: () => {} };
    }

    if (!content.includes('#EXT-X-STREAM-INF')) {
        console.log(`[i] Single variant stream detected (already direct video playlist).`);
        return { isMaster: false, streamUrl: masterUrl, close: () => {} };
    }

    const lines = content.split(/\r?\n/);
    const audioLines = [];
    const variants = [];

    let currentInf = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        if (line.startsWith('#EXT-X-MEDIA:TYPE=AUDIO')) {
            // Make URI absolute
            const updatedAudioLine = line.replace(/URI=["']([^"']+)["']/, (m, uri) => {
                const absUri = new URL(uri, masterUrl).href;
                return `URI="${absUri}"`;
            });
            audioLines.push(updatedAudioLine);
        } else if (line.startsWith('#EXT-X-STREAM-INF')) {
            currentInf = line;
        } else if (currentInf) {
            const variantUri = new URL(line, masterUrl).href;
            const resMatch = currentInf.match(/RESOLUTION=(\d+)x(\d+)/i);
            const bwMatch = currentInf.match(/BANDWIDTH=(\d+)/i);
            const width = resMatch ? parseInt(resMatch[1], 10) : 0;
            const height = resMatch ? parseInt(resMatch[2], 10) : 0;
            const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 0;
            
            // Higher resolution always beats lower resolution; if equal, higher bandwidth wins
            const qualityScore = (width * height * 10) + Math.round(bandwidth / 1000);

            variants.push({
                inf: currentInf,
                uri: variantUri,
                width,
                height,
                bandwidth,
                qualityScore,
                label: height ? `${height}p (${width}x${height})` : `${Math.round(bandwidth / 1000)}kbps`
            });
            currentInf = null;
        }
    }

    if (variants.length === 0) {
        console.log(`[i] No stream variants found in playlist, using original stream.`);
        return { isMaster: false, streamUrl: masterUrl, close: () => {} };
    }

    // Sort descending: top quality first
    variants.sort((a, b) => b.qualityScore - a.qualityScore);
    const topVariant = variants[0];

    console.log(`==================================================`);
    console.log(`🎬 SMART RESOLUTION SELECTOR: Found ${variants.length} stream quality level(s):`);
    variants.forEach((v, idx) => {
        console.log(`   ${idx === 0 ? '🏆 [HIGHEST SELECTED]' : '   [AVAILABLE QUALITY]'} -> ${v.label} | Bitrate: ${(v.bandwidth / 1000000).toFixed(2)} Mbps`);
    });
    console.log(`==================================================`);

    // Ensure Hindi audio is prioritized if audio tracks exist
    const prioritizedAudioLines = [...audioLines].sort((a, b) => {
        const isAHi = /hi|hindi|हिन्दी/i.test(a);
        const isBHi = /hi|hindi|हिन्दी/i.test(b);
        if (isAHi && !isBHi) return -1;
        if (!isAHi && isBHi) return 1;
        return 0;
    });

    // Reconstruct optimized local master M3U8 locked exclusively to top quality
    const smartM3u8Content = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        ...prioritizedAudioLines,
        '',
        `# LOCKED TO TOP QUALITY: ${topVariant.label}`,
        topVariant.inf,
        topVariant.uri,
        ''
    ].join('\n');

    // Launch ephemeral localhost micro-server to feed FFmpeg
    const server = http.createServer((req, res) => {
        res.writeHead(200, {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(smartM3u8Content);
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const localUrl = `http://127.0.0.1:${port}/smart_master.m3u8`;

    return {
        isMaster: true,
        streamUrl: localUrl,
        topVariant,
        variants,
        close: () => {
            try { server.close(); } catch {}
        }
    };
}

/**
 * Downloads and converts an HLS stream (m3u8), TS chunks, or direct stream into a single MP4.
 * Smartly resolves highest quality stream (1080p) before conversion.
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

    // Smart quality resolution
    const proxy = await createSmartMasterServer(streamUrl, headers);
    const activeStreamUrl = proxy.streamUrl;

    console.log(`\n==================================================`);
    console.log(`🎬 FFMPEG STREAM CONVERSION`);
    console.log(`   Source: ${streamUrl}`);
    if (proxy.topVariant) {
        console.log(`   Quality: 🏆 ${proxy.topVariant.label}`);
    }
    console.log(`   Output: ${outputPath}`);
    console.log(`==================================================`);

    const runFfmpeg = (extraArgs = []) => {
        return new Promise((resolve, reject) => {
            const args = [
                '-y',
                '-hide_banner',
                '-loglevel', 'info',
                '-protocol_whitelist', 'file,http,https,tcp,tls,crypto,data',
                ...(headerStr ? ['-headers', headerStr] : []),
                '-i', activeStreamUrl,
                ...extraArgs,
                outputPath
            ];

            const proc = spawn('ffmpeg', args, { stdio: 'inherit' });
            proc.on('close', code => {
                if (code === 0) resolve();
                else reject(new Error(`FFmpeg exited with error code ${code}`));
            });
            proc.on('error', reject);
        });
    };

    const startTime = Date.now();

    try {
        console.log(`[*] Executing lossless remux (-c copy + multi-audio)...`);
        await runFfmpeg([
            '-map', '0:v:0',
            '-map', '0:a?',
            '-c', 'copy',
            '-bsf:a', 'aac_adtstoasc',
            '-movflags', '+faststart'
        ]);
    } catch (err) {
        console.warn(`[!] Primary remux failed (${err.message}). Retrying with audio re-encode...`);
        try {
            await runFfmpeg([
                '-map', '0:v:0',
                '-map', '0:a?',
                '-c:v', 'copy',
                '-c:a', 'aac',
                '-b:a', '128k',
                '-movflags', '+faststart'
            ]);
        } catch (fallbackErr) {
            proxy.close();
            throw fallbackErr;
        }
    } finally {
        proxy.close();
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
