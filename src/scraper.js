/**
 * STREAM SCRAPER INTERFACE & PLUGIN REGISTRY
 * Supports DesiDubAnime reverse-engineered extractor + universal streams
 */

import { searchAnime, getAnimeEpisodes, extractEpisodeStream } from './desidubScraper.js';
import { extractAnimeTvPlusStream, getMalIdFromAniList } from './animeTvPlusScraper.js';

// Registry of site-specific scraper handlers
const siteScrapers = {
    /**
     * AnimeTVPlus Handler (Default High-Speed 1080p Multi-Audio)
     */
    'animetvplus': async ({ malId, anilistId, episode = 1 }) => {
        const streamData = await extractAnimeTvPlusStream({
            malId,
            anilistId,
            episodeNumber: episode
        });
        if (!streamData) {
            throw new Error(`AnimeTVPlus has no 1080p Hindi stream for MAL ${malId || 'N/A'} EP ${episode}`);
        }
        return streamData;
    },
    /**
     * DesiDubAnime Handler
     */
    'desidub': async ({ url, query, episode, title, server = 'vidmoly' }) => {
        // Case 1: Direct watch URL provided
        if (url && url.includes('/watch/')) {
            const streamData = await extractEpisodeStream(url, server);
            return {
                streamUrl: streamData.streamUrl,
                title: title || streamData.title,
                episode: streamData.episodeNumber,
                serverName: streamData.serverName,
                headers: streamData.headers
            };
        }

        // Case 2: Anime URL provided with episode number
        if (url && url.includes('/anime/')) {
            const episodes = await getAnimeEpisodes(url);
            const targetEpNum = episode ? parseInt(episode, 10) : 1;
            const targetEp = episodes.find(e => e.episodeNumber === targetEpNum) || episodes[0];
            if (!targetEp) throw new Error(`Episode ${targetEpNum} not found for ${url}`);
            
            const streamData = await extractEpisodeStream(targetEp.url, server);
            return {
                streamUrl: streamData.streamUrl,
                title: title || `${streamData.title} - EP ${targetEpNum}`,
                episode: targetEpNum,
                serverName: streamData.serverName,
                headers: streamData.headers
            };
        }

        // Case 3: Keyword/Query provided
        const searchTerm = query || title;
        if (searchTerm) {
            const results = await searchAnime(searchTerm);
            if (!results || results.length === 0) {
                throw new Error(`No anime found on DesiDubAnime matching: "${searchTerm}"`);
            }
            const anime = results[0];
            console.log(`[*] Selected Anime: "${anime.title}" (${anime.link})`);

            const episodes = await getAnimeEpisodes(anime.link);
            const targetEpNum = episode ? parseInt(episode, 10) : 1;
            const targetEp = episodes.find(e => e.episodeNumber === targetEpNum) || episodes[0];
            if (!targetEp) throw new Error(`Episode ${targetEpNum} not found for "${anime.title}"`);

            const streamData = await extractEpisodeStream(targetEp.url, server);
            return {
                streamUrl: streamData.streamUrl,
                title: `${anime.title} - Episode ${targetEpNum}`,
                episode: targetEpNum,
                serverName: streamData.serverName,
                headers: streamData.headers
            };
        }

        throw new Error("For desidub, provide either --url <watch_or_anime_url> or --title/--query <keyword>");
    }
};

/**
 * Registers a new custom site scraper plugin.
 */
export function registerScraper(name, handler) {
    siteScrapers[name.toLowerCase()] = handler;
}

/**
 * Main scraper dispatcher.
 * Auto-detects target URL provider or dispatches to registered plugins.
 */
export async function scrapeStream({ url, site, title = '', query = '', episode = null, server = 'vidmoly', quality = '1080p' } = {}) {
    console.log(`\n==================================================`);
    console.log(`🔍 RESOLVING STREAM`);
    if (site) console.log(`   Site: ${site}`);
    if (url) console.log(`   URL: ${url}`);
    if (query) console.log(`   Query: ${query}`);
    if (episode) console.log(`   Episode: ${episode}`);
    if (server) console.log(`   Preferred Server: ${server}`);
    console.log(`==================================================`);

    // Auto-detect desidubanime.me URLs
    if (url && url.includes('desidubanime.me')) {
        return await siteScrapers['desidub']({ url, episode, title, query, server });
    }

    // Explicit site scraper requested
    if (site && siteScrapers[site.toLowerCase()]) {
        return await siteScrapers[site.toLowerCase()]({ url, episode, title, query, server });
    }

    // Direct stream link (M3U8 / MP4 / TS)
    if (url) {
        const isM3u8 = url.includes('.m3u8');
        const isMp4 = url.includes('.mp4');
        const isTs = url.includes('.ts');

        if (isM3u8 || isMp4 || isTs) {
            console.log(`✅ Direct stream detected (${isM3u8 ? 'HLS M3U8' : isMp4 ? 'Direct MP4' : 'TS Stream'}).`);
            return {
                streamUrl: url,
                title: title || `Stream_${Date.now()}`,
                episode: episode || 1,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            };
        }

        return {
            streamUrl: url,
            title: title || `Video_${Date.now()}`,
            episode: episode || 1,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        };
    }

    throw new Error("No URL or site scraper specified. Provide --url <link> or --site desidub --query <name>.");
}
