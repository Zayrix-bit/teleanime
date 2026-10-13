/**
 * ANIME METADATA & TELEGRAM STREAM MAPPING DATABASE
 * Maps AniList / MAL ID + Episode + Track -> Telegram Message ID
 * Persisted in data/anime_catalog.json
 */

import fs from 'fs';
import path from 'path';

const CATALOG_FILE = path.resolve('data/anime_catalog.json');

function ensureCatalogFile() {
    const dir = path.dirname(CATALOG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(CATALOG_FILE)) {
        fs.writeFileSync(CATALOG_FILE, JSON.stringify([], null, 2));
    }
}

export function loadCatalog() {
    ensureCatalogFile();
    try {
        const raw = fs.readFileSync(CATALOG_FILE, 'utf-8');
        return JSON.parse(raw);
    } catch {
        return [];
    }
}

export function saveCatalog(catalog) {
    ensureCatalogFile();
    try {
        fs.writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 2));
    } catch (err) {
        console.error("Error saving anime catalog:", err);
    }
}

/**
 * Registers or updates an anime episode mapping.
 */
export function registerAnimeEpisode({
    anilistId = null,
    malId = null,
    title = "Unknown Anime",
    episode = 1,
    track = "sub",
    telegramMessageId,
    resolution = "1080p",
    sizeBytes = 0,
    durationSec = 0,
    poster = ""
}) {
    const catalog = loadCatalog();
    const epNum = parseInt(episode, 10) || 1;
    const trackLower = (track || "sub").toLowerCase();

    const key = anilistId 
        ? `ani:${anilistId}:${epNum}:${trackLower}` 
        : `mal:${malId}:${epNum}:${trackLower}`;

    const existingIndex = catalog.findIndex(item => 
        (anilistId && item.anilistId === anilistId && item.episode === epNum && item.track === trackLower) ||
        (malId && item.malId === malId && item.episode === epNum && item.track === trackLower)
    );

    const record = {
        key,
        title,
        anilistId: anilistId ? parseInt(anilistId, 10) : null,
        malId: malId ? parseInt(malId, 10) : null,
        episode: epNum,
        track: trackLower,
        telegramMessageId: parseInt(telegramMessageId, 10),
        streamUrl: `/stream/${telegramMessageId}`,
        playerUrl: `/player/${telegramMessageId}`,
        resolution,
        sizeBytes,
        sizeMB: (sizeBytes / (1024 * 1024)).toFixed(2),
        durationSec,
        poster,
        uploadedAt: new Date().toISOString()
    };

    if (existingIndex >= 0) {
        catalog[existingIndex] = { ...catalog[existingIndex], ...record };
    } else {
        catalog.unshift(record);
    }

    saveCatalog(catalog);
    console.log(`✅ [Catalog] Registered ${title} EP ${epNum} [${trackLower}] -> Telegram Message #${telegramMessageId}`);
    return record;
}

/**
 * Finds mapped Telegram message ID for an anime episode.
 */
export function findAnimeEpisode({ anilistId, malId, episode = 1, track = "sub" }) {
    const catalog = loadCatalog();
    const epNum = parseInt(episode, 10) || 1;
    const trackLower = (track || "sub").toLowerCase();

    return catalog.find(item => {
        const epMatch = item.episode === epNum;
        const trackMatch = item.track === trackLower;
        if (!epMatch || !trackMatch) return false;

        if (anilistId && item.anilistId === parseInt(anilistId, 10)) return true;
        if (malId && item.malId === parseInt(malId, 10)) return true;
        return false;
    });
}
