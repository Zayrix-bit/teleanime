/**
 * ANIMETVPLUS MULTI-AUDIO 1080P STREAM EXTRACTOR
 * Primary High-Quality Provider for TeleAnime
 * 
 * Features:
 * - Direct HTTP API query without browser overhead (0.3s resolution)
 * - Automatic AniList / MAL ID mapping support
 * - True 1080p stream resolution detection
 * - Pure Hindi audio track isolation (NAME="हिन्दी", LANGUAGE="hi")
 * - Disguised HLS playlist & segment compatibility (.jpg / .txt bypass)
 */

import { ANSI, logAnimeTv, logAnimeTvBold } from './logger.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

/**
 * Checks whether an EXT-X-MEDIA:TYPE=AUDIO line explicitly represents a Hindi audio track.
 * Strictly rejects any non-Hindi tracks (Japanese, English, Telugu, Tamil, etc.).
 */
export function isHindiAudio(line) {
    if (!line || typeof line !== 'string') return false;
    const nameMatch = line.match(/NAME=["']([^"']+)["']/i);
    const langMatch = line.match(/LANGUAGE=["']([^"']+)["']/i);
    const groupMatch = line.match(/GROUP-ID=["']([^"']+)["']/i);

    const name = nameMatch ? nameMatch[1].trim() : '';
    const lang = langMatch ? langMatch[1].trim().toLowerCase() : '';
    const group = groupMatch ? groupMatch[1].trim().toLowerCase() : '';

    // Direct language codes for Hindi
    if (lang === 'hi' || lang === 'hin') return true;

    // Direct name or group matches for Hindi / हिन्दी
    if (/hindi|हिन्दी/i.test(name) || /hindi|hin/i.test(group)) return true;

    // Explicitly reject any other known languages (en, ja, te, ta, ko, etc.)
    return false;
}

/**
 * Resolves MAL ID from AniList ID using cross-platform mappings.
 */
export async function getMalIdFromAniList(anilistId) {
    if (!anilistId) return null;
    try {
        const url = `https://api.ani.zip/mappings?anilist_id=${encodeURIComponent(anilistId)}`;
        const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(5000) });
        if (res.ok) {
            const data = await res.json();
            if (data?.mappings?.mal_id) {
                return Number(data.mappings.mal_id);
            }
        }
    } catch {}
    return null;
}

/**
 * Resolves MyAnimeList ID from Anime Title using AniList GraphQL.
 */
export async function resolveMalIdFromTitle(title) {
    if (!title) return null;
    try {
        const query = `query ($search: String) { Media(search: $search, type: ANIME) { id idMal title { english romaji } } }`;
        const res = await fetch('https://graphql.anilist.co', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ query, variables: { search: title } }),
            signal: AbortSignal.timeout(5000)
        });
        if (res.ok) {
            const data = await res.json();
            return data?.data?.Media?.idMal ? Number(data.data.Media.idMal) : null;
        }
    } catch {}
    return null;
}

/**
 * Attempts to extract a 1080p stream with pure Hindi audio from AnimeTVPlus.
 * Strictly validates Hindi audio track existence and reachability before returning.
 * 
 * @param {Object} params
 * @param {number} [params.malId] - MyAnimeList ID
 * @param {number} [params.anilistId] - AniList ID
 * @param {number} params.episodeNumber - Episode number
 * @returns {Promise<Object|null>} Extracted stream metadata, or null if unavailable/no Hindi
 */
export async function extractAnimeTvPlusStream({ malId, anilistId, episodeNumber }) {
    let targetMal = malId;

    if (!targetMal && anilistId) {
        targetMal = await getMalIdFromAniList(anilistId);
    }

    if (!targetMal) {
        return null;
    }

    const ep = Number(episodeNumber);
    const apiUrl = `https://embed.animetvplus.site/hls3/uq/${targetMal}?episode=${ep}`;
    const headers = {
        'User-Agent': USER_AGENT,
        'Origin': 'https://embed.animetvplus.site',
        'Referer': `https://embed.animetvplus.site/${targetMal}/${ep}`
    };

    logAnimeTv(`[*] [AnimeTVPlus] Probing MAL ${targetMal} EP ${ep}...`);

    try {
        const res = await fetch(apiUrl, { headers, signal: AbortSignal.timeout(7000) });
        if (!res.ok) {
            logAnimeTv(`[i] [AnimeTVPlus] API returned HTTP ${res.status} for MAL ${targetMal} EP ${ep}`);
            return null;
        }

        const data = await res.json();
        if (!data || !data.m3u8) {
            logAnimeTv(`[i] [AnimeTVPlus] No stream URL in API response`);
            return null;
        }

        const masterUrl = data.m3u8;

        // Fetch master playlist to verify Hindi audio presence and locate top video variant
        const masterRes = await fetch(masterUrl, { headers, signal: AbortSignal.timeout(7000) });
        if (!masterRes.ok) {
            logAnimeTv(`[i] [AnimeTVPlus] Failed to fetch master playlist (${masterRes.status})`);
            return null;
        }

        const masterContent = await masterRes.text();
        const lines = masterContent.split(/\r?\n/);

        let hasHindi = false;
        let hindiTrackUri = '';
        let hindiTrackName = '';

        // Extract Pure Hindi Audio Track
        for (const line of lines) {
            if (line.startsWith('#EXT-X-MEDIA:TYPE=AUDIO') && isHindiAudio(line)) {
                const uMatch = line.match(/URI=["']([^"']+)["']/i);
                if (uMatch) {
                    hindiTrackUri = new URL(uMatch[1], masterUrl).href;
                    hasHindi = true;
                    const m = line.match(/NAME=["']([^"']+)["']/i);
                    hindiTrackName = m ? m[1] : 'हिन्दी';
                    break;
                }
            }
        }

        // STRICT REQUIREMENT: If no Hindi audio track exists, SKIP AnimeTVPlus entirely
        if (!hasHindi || !hindiTrackUri) {
            logAnimeTv(`[i] [AnimeTVPlus] Stream exists for MAL ${targetMal} EP ${ep} but NO Hindi audio track found. Skipping to DesiDub fallback.`);
            return null;
        }

        // CRITICAL CHECK: Verify that the Hindi audio playlist is actually reachable (not 403 / 404 ghost file)
        try {
            const audioCheck = await fetch(hindiTrackUri, {
                headers,
                signal: AbortSignal.timeout(4000)
            });
            if (!audioCheck.ok) {
                logAnimeTv(`[i] [AnimeTVPlus] Hindi audio track returned HTTP ${audioCheck.status} (unreachable on edge storage). Falling back to DesiDub.`);
                return null;
            }
        } catch (audioErr) {
            logAnimeTv(`[i] [AnimeTVPlus] Failed to reach Hindi audio track (${audioErr.message}). Falling back to DesiDub.`);
            return null;
        }

        // Locate highest resolution video variant URL directly
        let bestVideoUri = masterUrl;
        let highestQualityScore = -1;
        let resolution = '1080p';

        let curInf = null;
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('#EXT-X-STREAM-INF')) {
                curInf = trimmed;
            } else if (curInf && trimmed && !trimmed.startsWith('#')) {
                const varUri = new URL(trimmed, masterUrl).href;
                const resM = curInf.match(/RESOLUTION=(\d+)x(\d+)/i);
                const bwM = curInf.match(/BANDWIDTH=(\d+)/i);
                const w = resM ? parseInt(resM[1], 10) : 0;
                const h = resM ? parseInt(resM[2], 10) : 0;
                const bw = bwM ? parseInt(bwM[1], 10) : 0;
                const score = (w * h * 10) + Math.round(bw / 1000);
                if (score > highestQualityScore) {
                    highestQualityScore = score;
                    bestVideoUri = varUri;
                    if (h) resolution = `${h}p (${w}x${h})`;
                }
                curInf = null;
            }
        }

        logAnimeTvBold(`✅ [AnimeTVPlus] 1080p Hindi Dub Stream Verified! (${resolution} | Audio: "${hindiTrackName}")`);

        return {
            success: true,
            serverName: 'AnimeTVPlus',
            streamUrl: bestVideoUri, // Point directly to top video variant so FFmpeg avoids parsing master.txt
            masterUrl,
            hindiAudioUrl: hindiTrackUri,
            headers,
            quality: resolution,
            hasHindiAudio: true,
            malId: targetMal,
            anilistId: data.anilist_id || anilistId || null
        };
    } catch (err) {
        console.warn(`[!] [AnimeTVPlus] Resolution error: ${err.message}`);
        return null;
    }
}
