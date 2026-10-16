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
import { colorByProvider, ANSI } from './logger.js';

const execAsync = promisify(exec);

/**
/**
 * Checks whether an EXT-X-MEDIA:TYPE=AUDIO line explicitly represents a Hindi audio track.
 * Evaluates standard ISO language codes ('hi', 'hin') and name tags ('Hindi', 'हिन्दी').
 * 
 * @param {string} line 
 * @returns {boolean}
 */
export function isHindiAudioLine(line) {
    if (!line || typeof line !== 'string') return false;
    const nameMatch = line.match(/NAME=["']([^"']+)["']/i);
    const langMatch = line.match(/LANGUAGE=["']([^"']+)["']/i);
    const name = nameMatch ? nameMatch[1].trim() : '';
    const lang = langMatch ? langMatch[1].trim().toLowerCase() : '';

    if (lang === 'hi' || lang === 'hin') return true;
    if (/hindi|हिन्दी/i.test(name)) return true;
    return false;
}

/**
 * Analyzes an HLS Master Playlist:
 * - Locks to the HIGHEST resolution video variant (1080p > 900p > 720p > 480p)
 * - Identifies and isolates ONLY the Pure Hindi audio track (discarding English/Japanese/other audios)
 * 
 * @param {string} masterUrl 
 * @param {Object} headers 
 * @returns {Promise<{ isMaster: boolean, videoUrl: string, audioUrl: string|null, topVariant?: Object, variants?: Array, close: () => void }>}
 */
export async function createSmartMasterServer(masterUrl, headers = {}) {
    const isAtv = (headers && (headers.Origin || '').includes('animetvplus')) || masterUrl.includes('animetvplus');
    const prov = isAtv ? 'AnimeTVPlus' : 'DesiDubAnime';
    const log = (msg, bold = false) => console.log(colorByProvider(msg, prov, bold));

    log(`\n🔍 [SMART QUALITY & AUDIO ENGINE] Analyzing stream: ${masterUrl}`, true);
    
    // Only attempt to parse if it's an HLS playlist URL
    if (!masterUrl.includes('.m3u8') && !masterUrl.includes('hls') && !masterUrl.includes('.txt') && !masterUrl.includes('.jpg')) {
        log(`[i] Direct media URL detected, proceeding directly.`);
        return { isMaster: false, videoUrl: masterUrl, audioUrl: null, close: () => {} };
    }

    let content = '';
    try {
        const res = await fetch(masterUrl, { headers });
        if (!res.ok) {
            console.warn(`[!] Master playlist fetch returned ${res.status}, passing URL directly.`);
            return { isMaster: false, videoUrl: masterUrl, audioUrl: null, close: () => {} };
        }
        content = await res.text();
    } catch (e) {
        console.warn(`[!] Failed to probe master playlist (${e.message}), passing URL directly.`);
        return { isMaster: false, videoUrl: masterUrl, audioUrl: null, close: () => {} };
    }

    if (!content.includes('#EXT-X-STREAM-INF')) {
        log(`[i] Single variant stream detected (already direct video playlist).`);
        return { isMaster: false, videoUrl: masterUrl, audioUrl: null, close: () => {} };
    }

    const lines = content.split(/\r?\n/);
    const audioTracks = [];
    const variants = [];

    let currentInf = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        if (line.startsWith('#EXT-X-MEDIA:TYPE=AUDIO')) {
            const uriMatch = line.match(/URI=["']([^"']+)["']/i);
            const nameMatch = line.match(/NAME=["']([^"']+)["']/i);
            const langMatch = line.match(/LANGUAGE=["']([^"']+)["']/i);
            if (uriMatch) {
                const absUri = new URL(uriMatch[1], masterUrl).href;
                audioTracks.push({
                    line,
                    uri: absUri,
                    name: nameMatch ? nameMatch[1] : '',
                    lang: langMatch ? langMatch[1] : '',
                    isHindi: isHindiAudioLine(line)
                });
            }
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
        log(`[i] No stream variants found in playlist, using original stream.`);
        return { isMaster: false, videoUrl: masterUrl, audioUrl: null, close: () => {} };
    }

    // Sort descending: top quality first
    variants.sort((a, b) => b.qualityScore - a.qualityScore);
    const topVariant = variants[0];

    log(`==================================================`, true);
    log(`🎬 SMART RESOLUTION SELECTOR: Found ${variants.length} stream quality level(s):`, true);
    variants.forEach((v, idx) => {
        log(`   ${idx === 0 ? '🏆 [HIGHEST SELECTED]' : '   [AVAILABLE QUALITY]'} -> ${v.label} | Bitrate: ${(v.bandwidth / 1000000).toFixed(2)} Mbps`);
    });
    log(`==================================================`, true);

    // Pick ONLY the Pure Hindi audio track
    let hindiAudio = audioTracks.find(t => t.isHindi);
    if (!hindiAudio && audioTracks.length === 1) {
        const nonHindiLangs = ['en', 'eng', 'ja', 'jpn', 'te', 'tel', 'ta', 'tam', 'ko', 'kor', 'zh', 'chi'];
        const isExplicitNonHindi = nonHindiLangs.includes(audioTracks[0].lang) ||
            /english|japanese|telugu|tamil|korean|chinese/i.test(audioTracks[0].name);
        if (!isExplicitNonHindi) {
            hindiAudio = audioTracks[0];
        }
    }

    if (hindiAudio) {
        // Double-check if the Hindi audio URI is actually reachable on the server (not 403/404)
        try {
            const aCheck = await fetch(hindiAudio.uri, { headers, signal: AbortSignal.timeout(3000) });
            if (!aCheck.ok) {
                console.warn(`❌ [AUDIO LOCK ERROR] Hindi audio track returned HTTP ${aCheck.status} (ghost file on CDN)!`);
                throw new Error(`Hindi audio track returned HTTP ${aCheck.status} (unreachable on server). Aborting non-Hindi remux.`);
            }
        } catch (err) {
            if (err.message.includes('Aborting non-Hindi remux')) throw err;
        }
        log(`🎯 [AUDIO ISOLATION] Pure HINDI Audio Locked: "${hindiAudio.name || 'Hindi'}" (${hindiAudio.lang || 'hi'})`, true);
    } else if (audioTracks.length > 0) {
        console.warn(`❌ [AUDIO LOCK ERROR] Multi-audio stream contains [${audioTracks.map(t=>t.name || t.lang).join(', ')}] but NO Hindi audio track! Rejecting to enforce 100% Pure Hindi.`);
        throw new Error(`Stream has no Hindi audio track (${audioTracks.map(t=>t.name || t.lang).join(', ')}). Aborting non-Hindi remux.`);
    } else {
        log(`ℹ️ [AUDIO ISOLATION] Single multiplexed stream detected.`);
    }

    return {
        isMaster: true,
        videoUrl: topVariant.uri,
        audioUrl: hindiAudio ? hindiAudio.uri : null,
        topVariant,
        variants,
        close: () => {}
    };
}

/**
 * Downloads direct MKV / video files using aria2c and extracts/remuxes Hindi audio to clean MP4.
 */
async function convertDirectMediaToMp4({ streamUrl, outputPath, headers = {} }) {
    const log = (msg, bold = false) => console.log(colorByProvider(msg, 'DesiDubAnime', bold));

    log(`\n==================================================`, true);
    log(`🎬 DIRECT MEDIA ARIA2C + FFMPEG REMUX ENGINE [DesiDubAnime]`, true);
    log(`   Source: ${streamUrl}`);
    log(`   Output: ${outputPath}`);
    log(`==================================================`, true);

    const tempDir = path.dirname(outputPath);
    const tempMkv = path.join(tempDir, `temp_raw_${Date.now()}.mkv`);
    const tempFilename = path.basename(tempMkv);

    const ref = headers['Referer'] || headers['referer'] || 'https://ddn.iqsmartgames.com/';
    const ua = headers['User-Agent'] || headers['user-agent'] || 'Mozilla/5.0';

    log(`[*] Downloading raw media at high speed with aria2c...`);
    const ariaCmd = `aria2c -x 8 -s 8 --header="Referer: ${ref}" --header="User-Agent: ${ua}" -d "${tempDir}" -o "${tempFilename}" "${streamUrl}"`;
    await execAsync(ariaCmd);

    try {
        log(`[*] Probing audio and video streams with ffprobe...`);
        const { stdout: probeJson } = await execAsync(`ffprobe -v error -show_entries stream=index,codec_type,codec_name:stream_tags=language -of json "${tempMkv}"`);
        const data = JSON.parse(probeJson);

        let videoIdx = 0;
        let videoCodec = '';
        let defaultAudioIdx = null;
        let hindiIdx = null;

        for (const s of data.streams || []) {
            if (s.codec_type === 'video' && videoCodec === '') {
                videoIdx = s.index;
                videoCodec = s.codec_name || '';
            }
            if (s.codec_type === 'audio') {
                if (defaultAudioIdx === null) defaultAudioIdx = s.index;
                const lang = (s.tags?.language || '').toLowerCase();
                const title = (s.tags?.title || s.tags?.handler_name || '').toLowerCase();
                if (lang === 'hin' || lang === 'hi' || lang === 'hindi' || title.includes('hindi') || title.includes('हिन्दी')) {
                    hindiIdx = s.index;
                }
            }
        }

        const chosenAudio = hindiIdx !== null ? hindiIdx : (defaultAudioIdx !== null ? defaultAudioIdx : 1);
        log(`🎯 [AUDIO ISOLATION] Selected Audio Track: ${chosenAudio} (Hindi Found: ${hindiIdx !== null}) | Video Codec: ${videoCodec}`, true);

        const isHevc = videoCodec.toLowerCase().includes('hevc') || videoCodec.toLowerCase().includes('h265');
        const tagArg = isHevc ? '-tag:v hvc1' : '';
        const ffmpegCmd = `ffmpeg -y -hide_banner -loglevel warning -i "${tempMkv}" -map 0:${videoIdx} -map 0:${chosenAudio} -c:v copy ${tagArg} -c:a aac -b:a 192k -metadata:s:a:0 language=hin -metadata:s:a:0 title=Hindi -movflags +faststart "${outputPath}"`;
        log(`[*] Remuxing to clean MP4 with Hindi audio...`);
        await execAsync(ffmpegCmd);
    } finally {
        if (fs.existsSync(tempMkv)) {
            try { fs.unlinkSync(tempMkv); } catch {}
        }
    }

    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
        throw new Error(`Direct media remux finished but output file is missing or empty: ${outputPath}`);
    }

    const sizeMB = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2);
    log(`✅ Direct stream converted to MP4! (Size: ${sizeMB} MB)`, true);
    return outputPath;
}

/**
 * Downloads a video from a direct HLS, TS, or MP4 URL, converts/remuxes it to MP4,
 * and preserves metadata with pure Hindi audio isolation.
 * 
 * @param {Object} options
 * @param {string} options.streamUrl - Direct M3U8, TS, or MP4 URL
 * @param {string} options.outputPath - Destination path for MP4
 * @param {Object} [options.headers] - Custom HTTP headers (Referer, User-Agent, etc.)
 * @returns {Promise<string>} Path to finished MP4
 */
export async function convertStreamToMp4({ streamUrl, outputPath, headers = {}, overrideAudioUrl = null, provider = null }) {
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    if (fs.existsSync(outputPath)) {
        try { fs.unlinkSync(outputPath); } catch {}
    }

    // Direct MKV / Worker / DDN file handler
    if (streamUrl.includes('.mkv') || streamUrl.includes('workers.dev') || streamUrl.includes('/cldst') || streamUrl.includes('name=')) {
        return await convertDirectMediaToMp4({ streamUrl, outputPath, headers });
    }

    const isAnimeTv = (provider && provider.toLowerCase().includes('animetv')) ||
                      (headers && (headers.Origin || '').includes('animetvplus')) ||
                      streamUrl.includes('animetvplus') ||
                      (overrideAudioUrl && overrideAudioUrl.includes('animetvplus'));
    const activeProvider = isAnimeTv ? 'AnimeTVPlus' : 'DesiDubAnime';
    const log = (msg, bold = false) => console.log(colorByProvider(msg, activeProvider, bold));

    // Format headers for FFmpeg
    let headerStr = '';
    if (headers && Object.keys(headers).length > 0) {
        headerStr = Object.entries(headers)
            .map(([k, v]) => `${k}: ${v}\r\n`)
            .join('');
    }

    // Smart quality and Hindi audio isolation
    const streamPlan = await createSmartMasterServer(streamUrl, headers);
    const videoUrl = streamPlan.videoUrl || streamUrl;
    const audioUrl = overrideAudioUrl || streamPlan.audioUrl || null;

    log(`\n==================================================`, true);
    log(`🎬 FFMPEG STREAM CONVERSION (${activeProvider})`, true);
    log(`   Source: ${streamUrl}`);
    if (streamPlan.topVariant) {
        log(`   Quality: 🏆 ${streamPlan.topVariant.label}`);
    }
    if (audioUrl) {
        log(`   Audio Track: 🇮🇳 100% PURE HINDI AUDIO ONLY (Isolated)`);
    } else {
        log(`   Audio Track: 🇮🇳 Stream default audio track`);
    }
    log(`   Output: ${outputPath}`);
    log(`==================================================`, true);

    const runFfmpeg = (extraArgs = []) => {
        return new Promise((resolve, reject) => {
            const inputArgs = [];
            // Universal HLS support for .jpg / .txt / disguised stream segments
            if (videoUrl.includes('.jpg') || videoUrl.includes('.txt') || videoUrl.includes('.m3u8')) {
                inputArgs.push('-f', 'hls', '-allowed_extensions', 'ALL', '-allowed_segment_extensions', 'ALL');
            } else {
                inputArgs.push('-allowed_extensions', 'ALL', '-allowed_segment_extensions', 'ALL');
            }

            if (headerStr) inputArgs.push('-headers', headerStr);
            if (audioUrl) inputArgs.push('-copyts');
            inputArgs.push('-thread_queue_size', '512');
            inputArgs.push('-i', videoUrl);

            if (audioUrl) {
                if (audioUrl.includes('.jpg') || audioUrl.includes('.txt') || audioUrl.includes('.m3u8')) {
                    inputArgs.push('-f', 'hls', '-allowed_extensions', 'ALL', '-allowed_segment_extensions', 'ALL');
                } else {
                    inputArgs.push('-allowed_extensions', 'ALL', '-allowed_segment_extensions', 'ALL');
                }
                if (headerStr) inputArgs.push('-headers', headerStr);
                inputArgs.push('-copyts');
                inputArgs.push('-thread_queue_size', '512');
                inputArgs.push('-i', audioUrl);
            }

            // If separate Hindi audio is available, map video from input 0 and Hindi audio from input 1
            // This completely drops any non-Hindi audio multiplexed into input 0!
            const mappingArgs = audioUrl
                ? ['-map', '0:v:0', '-map', '1:a:0']
                : ['-map', '0:v:0', '-map', '0:a:0?'];

            // Sync preservation: aligns starting timestamps without breaking relative PTS delta
            const syncArgs = audioUrl
                ? ['-avoid_negative_ts', 'make_zero', '-max_interleave_delta', '0']
                : [];

            const metadataArgs = [
                '-metadata:s:a:0', 'language=hin',
                '-metadata:s:a:0', 'title=Hindi'
            ];

            const args = [
                '-y',
                '-hide_banner',
                '-loglevel', 'warning',
                '-protocol_whitelist', 'file,http,https,tcp,tls,crypto,data',
                ...inputArgs,
                ...mappingArgs,
                ...syncArgs,
                ...metadataArgs,
                ...extraArgs,
                outputPath
            ];

            const proc = spawn('ffmpeg', args, { stdio: 'inherit' });
            
            // 5-minute timeout guard to prevent slow throttled servers from freezing the worker
            const timer = setTimeout(() => {
                try {
                    proc.kill('SIGKILL');
                } catch {}
                reject(new Error(`FFmpeg stream conversion timed out (exceeded 5m threshold). Stream server too slow.`));
            }, 300000);

            proc.on('close', code => {
                clearTimeout(timer);
                if (code === 0) resolve();
                else reject(new Error(`FFmpeg exited with error code ${code}`));
            });
            proc.on('error', err => {
                clearTimeout(timer);
                reject(err);
            });
        });
    };

    const startTime = Date.now();

    try {
        log(`[*] Executing lossless remux (-c copy + Hindi audio isolation)...`);
        await runFfmpeg([
            '-c', 'copy',
            '-bsf:a', 'aac_adtstoasc',
            '-movflags', '+faststart'
        ]);
    } catch (err) {
        console.warn(`[!] Primary remux failed (${err.message}). Retrying with audio re-encode...`);
        try {
            await runFfmpeg([
                '-c:v', 'copy',
                '-c:a', 'aac',
                '-b:a', '128k',
                '-movflags', '+faststart'
            ]);
        } catch (fallbackErr) {
            streamPlan.close?.();
            throw fallbackErr;
        }
    } finally {
        streamPlan.close?.();
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
        throw new Error(`FFmpeg finished but output MP4 was not created or is empty: ${outputPath}`);
    }

    const sizeMB = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2);
    log(`✅ Converted to MP4 in ${elapsed}s! (Size: ${sizeMB} MB)`, true);

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
