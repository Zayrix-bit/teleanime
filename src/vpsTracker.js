/**
 * VPS DATABASE & METADATA TRACKER CLIENT
 * Connects directly to the VPS AniList & AniZip Database API (https://db.anixo.buzz)
 * Tracks:
 * - AniList ID & metadata
 * - AniZip cross-platform mappings (MAL, TVDB, AniDB, Kitsu)
 * - Episode-by-episode upload status, thumbnails, and Telegram Message IDs
 */

const VPS_API_BASE = process.env.VPS_TRACKER_URL || 'https://db.anixo.buzz';

/**
 * Marks an episode as uploaded in the VPS database.
 * 
 * @param {Object} params
 * @param {number} [params.anilistId] - AniList ID of the anime
 * @param {string} [params.title] - Anime title (fallback for lookup)
 * @param {number} [params.seasonNumber=1] - Season number
 * @param {number} params.episodeNumber - Episode number
 * @param {number} params.telegramMessageId - Telegram channel message ID
 * @param {string} [params.telegramChannelId] - Target channel ID
 * @param {string} [params.telegramFileId] - File ID (optional)
 * @param {number} [params.fileSizeBytes] - File size in bytes
 * @param {number} [params.durationSeconds] - Video duration in seconds
 * @param {string} [params.serverUsed='vidmoly'] - Video player server used
 */
export async function markEpisodeUploaded(params) {
    try {
        const url = `${VPS_API_BASE}/?api=mark_episode_uploaded`;
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'TelegramStreamer/2.0'
            },
            body: JSON.stringify({
                anilist_id: params.anilistId || null,
                title: params.title || '',
                season_number: params.seasonNumber || 1,
                episode_number: params.episodeNumber,
                telegram_message_id: params.telegramMessageId,
                telegram_channel_id: params.telegramChannelId || '',
                telegram_file_id: params.telegramFileId || '',
                file_size_bytes: params.fileSizeBytes || 0,
                duration_seconds: params.durationSeconds || 0,
                server_used: params.serverUsed || 'vidmoly'
            })
        });

        if (!res.ok) {
            console.warn(`[VPS Tracker] HTTP Error ${res.status} while marking episode uploaded.`);
            return null;
        }

        const data = await res.json();
        if (data.success) {
            console.log(`[VPS Tracker] ✅ Successfully synced Episode ${params.episodeNumber} to VPS DB! (AniList ID: ${data.anilist_id || 'N/A'})`);
        }
        return data;
    } catch (err) {
        console.warn(`[VPS Tracker] ⚠️ Failed to sync with VPS database:`, err.message);
        return null;
    }
}

/**
 * Fetches all Hindi dubbed anime from the VPS database with live upload progress.
 */
export async function getVpsHindiAnimeList({ year = null } = {}) {
    try {
        const url = `${VPS_API_BASE}/?api=hindi_anime`;
        const res = await fetch(url);
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
            if (year) {
                return json.data.filter(a => a.year === parseInt(year, 10));
            }
            return json.data;
        }
    } catch (err) {
        console.warn(`[VPS Tracker] Failed to fetch anime list from VPS:`, err.message);
    }
    return [];
}

/**
 * Fetches episode guide and upload status for a specific anime from VPS.
 */
export async function getVpsHindiEpisodes({ anilistId = null, search = '' } = {}) {
    try {
        let query = '';
        if (anilistId) query = `anilist_id=${encodeURIComponent(anilistId)}`;
        else if (search) query = `search=${encodeURIComponent(search)}`;
        
        const url = `${VPS_API_BASE}/?api=hindi_episodes&${query}`;
        const res = await fetch(url);
        const json = await res.json();
        if (json.success && Array.isArray(json.episodes)) {
            return json.episodes;
        }
    } catch (err) {
        console.warn(`[VPS Tracker] Failed to fetch episodes from VPS:`, err.message);
    }
    return [];
}

/**
 * Claims the next pending anime from the VPS queue atomically for this worker.
 * 
 * @param {Object} params
 * @param {string} [params.workerId='worker-1'] - Unique worker identifier
 * @param {number} [params.year] - Optional year filter (e.g. 2022)
 * @returns {Promise<{ success: boolean, anime?: Object, episodes?: Array<Object>, message?: string }>}
 */
export async function claimNextAnime({ workerId = 'worker-1', year = null } = {}) {
    try {
        let q = `worker_id=${encodeURIComponent(workerId)}`;
        if (year) q += `&year=${encodeURIComponent(year)}`;
        const url = `${VPS_API_BASE}/?api=claim_next_anime&${q}`;
        const res = await fetch(url);
        return await res.json();
    } catch (err) {
        console.warn(`[VPS Tracker] Failed to claim next anime from queue:`, err.message);
        return { success: false, message: err.message };
    }
}

/**
 * Marks an entire anime as completed once all episodes have finished uploading.
 */
export async function completeAnime({ animeId = null, anilistId = null } = {}) {
    try {
        let q = '';
        if (animeId) q = `anime_id=${encodeURIComponent(animeId)}`;
        else if (anilistId) q = `anilist_id=${encodeURIComponent(anilistId)}`;
        const url = `${VPS_API_BASE}/?api=complete_anime&${q}`;
        const res = await fetch(url);
        return await res.json();
    } catch (err) {
        console.warn(`[VPS Tracker] Failed to mark anime complete:`, err.message);
        return { success: false, message: err.message };
    }
}

