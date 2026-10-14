/**
 * DESIDUBANIME.ME PROFESSIONAL MULTI-SERVER SCRAPER & REVERSE-ENGINEERING ENGINE
 * 
 * Supports ALL 4 Video Players / Servers on DesiDubAnime:
 * 1. VidMoly (VMolydub)        - Master HLS M3U8 with Multi-Audio tracks (Hindi, English, Japanese)
 * 2. FilesForever (Mirrordub)   - Fallback mirror host & stream dispatcher
 * 3. Abyss Player (Abyssdub)    - Abyss.to player wrapper & media extractor
 * 4. P2PPlay (Streamp2pdub)     - P2PPlay HLS stream extractor
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const BASE_URL = 'https://www.desidubanime.me';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

import fs from 'fs';
import path from 'path';

const COMPLETED_DB_PATH = path.resolve('data/completed_hindi_anime.json');

/**
 * Loads completed Hindi dubbed anime catalog.
 */
export function getCompletedHindiList({ year = null } = {}) {
    if (fs.existsSync(COMPLETED_DB_PATH)) {
        try {
            const list = JSON.parse(fs.readFileSync(COMPLETED_DB_PATH, 'utf-8'));
            if (year) return list.filter(item => item.year === parseInt(year, 10));
            return list;
        } catch {}
    }
    return [];
}

/**
 * Searches DesiDubAnime for anime matching a keyword.
 * Prioritizes English title first, then known Romaji aliases, then simplified keywords.
 * 
 * @param {string} query - Keyword to search (e.g. 'My Dress-Up Darling', 'solo leveling')
 * @returns {Promise<Array<{ id: number, title: string, slug: string, link: string }>>}
 */
export async function searchAnime(query) {
    console.log(`[*] Searching DesiDubAnime for: "${query}"...`);
    
    // Check if there is a known Romaji alias in completed database
    let aliasQuery = null;
    const completedList = getCompletedHindiList();
    const foundEntry = completedList.find(a => 
        a.title.toLowerCase().includes(query.toLowerCase()) || 
        query.toLowerCase().includes(a.title.toLowerCase())
    );
    if (foundEntry && foundEntry.romaji) {
        aliasQuery = foundEntry.romaji;
        console.log(`[*] Auto-mapped English title "${query}" -> Romaji alias: "${aliasQuery}"`);
    }

    // Candidate queries: English original FIRST, then Romaji alias, then clean title without Season/Cour
    const cleanQuery = query.replace(/\s*(\(S\d+.*?\)|Season\s*\d+|Cour\s*\d+|Part\s*\d+|Arc)/gi, '').replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
    const queriesToTry = [query];
    if (aliasQuery && aliasQuery.toLowerCase() !== query.toLowerCase()) queriesToTry.push(aliasQuery);
    if (cleanQuery && cleanQuery.toLowerCase() !== query.toLowerCase() && cleanQuery.length > 2) queriesToTry.push(cleanQuery);

    for (const q of queriesToTry) {
        const apiUrl = `${BASE_URL}/wp-json/wp/v2/anime?search=${encodeURIComponent(q)}&per_page=15`;
        try {
            const res = await fetch(apiUrl, {
                headers: { 'User-Agent': USER_AGENT }
            });
            if (res.ok) {
                const data = await res.json();
                if (data && data.length > 0) {
                    const mapped = data.map(item => ({
                        id: item.id,
                        title: item.title?.rendered?.replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c)).trim() || '',
                        slug: item.slug,
                        link: item.link
                    }));

                    // Smart sort: if query does not specify Season 2, prioritize Season 1
                    const isSeason2Query = /season\s*2|sea\s*2|\b2nd\b/i.test(q);
                    mapped.sort((a, b) => {
                        const aS2 = /season\s*2|sea\s*2|\b2nd\b/i.test(a.title) || a.slug.includes('-2') || a.slug.includes('sea-2');
                        const bS2 = /season\s*2|sea\s*2|\b2nd\b/i.test(b.title) || b.slug.includes('-2') || b.slug.includes('sea-2');
                        if (!isSeason2Query) {
                            if (aS2 && !bS2) return 1;
                            if (!aS2 && bS2) return -1;
                        }
                        return 0;
                    });

                    return mapped;
                }
            }
        } catch {}
    }

    console.warn(`[!] REST search found no direct match, trying website fallback...`);
    for (const q of queriesToTry) {
        const fb = await fallbackSearch(q);
        if (fb && fb.length > 0) return fb;
    }
    return [];
}

/**
 * Fallback search parser if REST API is cached/throttled.
 */
async function fallbackSearch(query) {
    const searchUrl = `${BASE_URL}/search/?s_keyword=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
        headers: { 'User-Agent': USER_AGENT }
    });
    const html = await res.text();
    
    const results = [];
    const regex = /<a[^>]+href=["'](https:\/\/www\.desidubanime\.me\/anime\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    const seen = new Set();

    while ((match = regex.exec(html)) !== null) {
        const link = match[1];
        if (!seen.has(link) && !link.includes('/genre/')) {
            seen.add(link);
            const slug = link.replace(`${BASE_URL}/anime/`, '').replace(/\/$/, '');
            const titleMatch = match[2].match(/alt=["']([^"']+)["']/) || match[2].match(/title=["']([^"']+)["']/);
            const title = titleMatch ? titleMatch[1] : slug.replace(/[-_]/g, ' ');
            results.push({ id: 0, title, slug, link });
        }
    }
    return results;
}

/**
 * Retrieves paginated catalog list of anime.
 * 
 * @param {Object} options
 * @param {number} [options.page=1]
 * @param {number} [options.perPage=20]
 */
export async function getCatalog({ page = 1, perPage = 20 } = {}) {
    const apiUrl = `${BASE_URL}/wp-json/wp/v2/anime?page=${page}&per_page=${perPage}`;
    const res = await fetch(apiUrl, {
        headers: { 'User-Agent': USER_AGENT }
    });
    
    const totalAnime = parseInt(res.headers.get('x-wp-total') || '0', 10);
    const totalPages = parseInt(res.headers.get('x-wp-totalpages') || '0', 10);
    const items = await res.json();

    return {
        totalAnime,
        totalPages,
        currentPage: page,
        animeList: items.map(x => ({
            id: x.id,
            title: x.title?.rendered?.replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c)).trim() || '',
            slug: x.slug,
            link: x.link
        }))
    };
}

/**
 * Retrieves all available episodes for an anime by slug or URL.
 * 
 * @param {string} animeSlugOrUrl - e.g. 'tensei-shitara-slime-datta-ken-4th-season' or full URL
 * @returns {Promise<Array<{ episodeNumber: number, title: string, url: string }>>}
 */
export async function getAnimeEpisodes(animeSlugOrUrl) {
    let animeUrl = animeSlugOrUrl.startsWith('http') 
        ? animeSlugOrUrl 
        : `${BASE_URL}/anime/${animeSlugOrUrl}/`;
    
    if (!animeUrl.endsWith('/')) animeUrl += '/';

    console.log(`[*] Fetching episode list from: ${animeUrl}`);
    const res = await fetch(animeUrl, {
        headers: { 'User-Agent': USER_AGENT }
    });
    const html = await res.text();

    const watchLinksRegex = /href=["'](https:\/\/www\.desidubanime\.me\/watch\/[^"']+)["']/gi;
    let match;
    const episodesMap = new Map();

    while ((match = watchLinksRegex.exec(html)) !== null) {
        const url = match[1];
        const epMatch = url.match(/episode-(\d+)/i);
        if (epMatch) {
            const epNum = parseInt(epMatch[1], 10);
            if (!episodesMap.has(epNum)) {
                episodesMap.set(epNum, {
                    episodeNumber: epNum,
                    title: `Episode ${epNum}`,
                    url
                });
            }
        }
    }

    if (episodesMap.size > 0) {
        const latestEpUrl = Array.from(episodesMap.values())[0].url;
        try {
            const watchRes = await fetch(latestEpUrl, {
                headers: { 'User-Agent': USER_AGENT }
            });
            const watchHtml = await watchRes.text();
            const watchEpRegex = /<a[^>]+href=["'](https:\/\/www\.desidubanime\.me\/watch\/[^"']+)["'][^>]*data-episode-search-query=["'](\d+)["']/gi;
            let wMatch;
            while ((wMatch = watchEpRegex.exec(watchHtml)) !== null) {
                const epNum = parseInt(wMatch[2], 10);
                episodesMap.set(epNum, {
                    episodeNumber: epNum,
                    title: `Episode ${epNum}`,
                    url: wMatch[1]
                });
            }
        } catch {}
    }

    const sortedEpisodes = Array.from(episodesMap.values()).sort((a, b) => a.episodeNumber - b.episodeNumber);
    console.log(`✅ Discovered ${sortedEpisodes.length} episodes.`);
    return sortedEpisodes;
}

// ─────────────────────────────────────────────────────────────
// INDIVIDUAL PLAYER EXTRACTORS FOR ALL 4 SERVERS
// ─────────────────────────────────────────────────────────────

/**
 * 1. VidMoly (VMolydub) Extractor
 * Extracts Master M3U8 with Hindi, English, and Japanese multi-track audio.
 */
export async function extractVidMolyStream(embedUrl) {
    let cleanUrl = embedUrl;
    const srcMatch = cleanUrl.match(/src=['"]([^'"]+)['"]/i);
    if (srcMatch) cleanUrl = srcMatch[1];
    if (cleanUrl.startsWith('//')) cleanUrl = 'https:' + cleanUrl;
    if (!cleanUrl.startsWith('http')) cleanUrl = 'https://' + cleanUrl;
    cleanUrl = cleanUrl.replace(/vidmoly\.[a-z0-9]+/i, 'vidmoly.org');

    console.log(`[*] Resolving VidMoly Stream: ${cleanUrl}...`);
    const res = await fetch(cleanUrl, {
        headers: {
            'User-Agent': USER_AGENT,
            'Referer': BASE_URL
        }
    });
    const html = await res.text();
    const match = html.match(/sources:\s*\[\s*\{\s*file:\s*['"]([^'"]+)['"]/i) 
        || html.match(/file:\s*['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/i)
        || html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);

    if (match) {
        return {
            server: 'VidMoly',
            streamUrl: match[1] || match[0],
            headers: {
                'User-Agent': USER_AGENT,
                'Referer': 'https://vidmoly.org/'
            }
        };
    }
    throw new Error(`Failed to extract M3U8 from VidMoly: ${embedUrl}`);
}

/**
 * 2. Ruby / StreamRuby (Rubydub) Extractor
 * Unpacks Dean Edwards p.a.c.k.e.r. script and extracts master M3U8 with multi-audio.
 */
export async function extractRubyStream(embedUrl) {
    let cleanUrl = embedUrl;
    const srcMatch = cleanUrl.match(/src=['"]([^'"]+)['"]/i);
    if (srcMatch) cleanUrl = srcMatch[1];
    if (cleanUrl.startsWith('//')) cleanUrl = 'https:' + cleanUrl;
    if (!cleanUrl.startsWith('http')) cleanUrl = 'https://' + cleanUrl;

    console.log(`[*] Resolving Ruby/StreamRuby Stream: ${cleanUrl}...`);
    const res = await fetch(cleanUrl, {
        headers: {
            'User-Agent': USER_AGENT,
            'Referer': BASE_URL
        }
    });
    const html = await res.text();
    const packRegex = /eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\('\|'\)\)\)/;
    const match = html.match(packRegex);
    if (match) {
        try {
            const unpacked = new Function('return ' + match[0].replace(/^eval/, ''))();
            const m3u8Match = unpacked.match(/https?:\/\/[^"']+\.m3u8[^"']*/);
            if (m3u8Match) {
                return {
                    server: 'Ruby',
                    streamUrl: m3u8Match[0],
                    headers: {
                        'User-Agent': USER_AGENT,
                        'Referer': 'https://rubyvidhub.com/'
                    }
                };
            }
        } catch {}
    }
    const directM3u8 = html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
    if (directM3u8) {
        return {
            server: 'Ruby',
            streamUrl: directM3u8[0],
            headers: {
                'User-Agent': USER_AGENT,
                'Referer': 'https://rubyvidhub.com/'
            }
        };
    }
    throw new Error(`Failed to extract M3U8 from Ruby Player: ${embedUrl}`);
}

/**
 * 2. FilesForever (Mirrordub) Extractor
 * Resolves video stream from FilesForever/IQSmartGames backend.
 */
export async function extractFilesForeverStream(embedUrl) {
    console.log(`[*] Resolving FilesForever/Mirror Stream: ${embedUrl}...`);
    const fileIdMatch = embedUrl.match(/\/embed\/([a-zA-Z0-9_-]+)/);
    const fileId = fileIdMatch ? fileIdMatch[1] : '';

    if (!fileId) throw new Error(`Invalid FilesForever URL: ${embedUrl}`);

    // Attempt backend resolver via embedhelper2.php
    try {
        const params = new URLSearchParams({
            sid: fileId,
            UserFavSite: '',
            currentDomain: '["","pro.iqsmartgames.com"]'
        });
        const helperRes = await fetch('https://pro.iqsmartgames.com/embedhelper2.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': USER_AGENT,
                'Referer': `https://pro.iqsmartgames.com/stream/${fileId}?autoplay=1&from_file_page=1`
            },
            body: params.toString()
        });
        if (helperRes.ok) {
            const data = await helperRes.json();
            if (data.mresult) {
                const decoded = JSON.parse(Buffer.from(data.mresult, 'base64').toString('utf-8'));
                if (decoded.smwh) {
                    const hanerixRes = await fetch(`https://hanerix.com/e/${decoded.smwh}`, {
                        headers: {
                            'User-Agent': USER_AGENT,
                            'Referer': 'https://pro.iqsmartgames.com/'
                        }
                    });
                    const hHtml = await hanerixRes.text();
                    const evalMatch = hHtml.match(/eval\((function\(p,a,c,k,e,d\)[\s\S]*?\.split\('\|'\)[\s\S]*?)\)\s*<\/script>/);
                    if (evalMatch) {
                        const fn = new Function('return ' + evalMatch[1]);
                        const unpacked = fn();
                        const hlsMatch = unpacked.match(/["']hls2["']:\s*["']([^"']+)["']/) 
                            || unpacked.match(/["']hls3["']:\s*["']([^"']+)["']/)
                            || unpacked.match(/https?:[^"'\s>]+\.m3u8[^"'\s>]*/);
                        if (hlsMatch) {
                            return {
                                server: 'FilesForever',
                                streamUrl: hlsMatch[1] || hlsMatch[0],
                                headers: {
                                    'User-Agent': USER_AGENT,
                                    'Referer': 'https://hanerix.com/'
                                }
                            };
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.warn(`[!] FilesForever helper failed: ${e.message}`);
    }

    // Direct stream check in page HTML
    const fileUrl = `https://ddn.iqsmartgames.com/file/${fileId}`;
    const fileRes = await fetch(fileUrl, {
        headers: { 'User-Agent': USER_AGENT, 'Referer': embedUrl }
    });
    const fileHtml = await fileRes.text();
    const m3u8Match = fileHtml.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/);
    if (m3u8Match) {
        return {
            server: 'FilesForever',
            streamUrl: m3u8Match[0],
            headers: { 'User-Agent': USER_AGENT, 'Referer': 'https://filesforever.link/' }
        };
    }

    throw new Error(`Failed to extract playable stream from FilesForever: ${embedUrl}`);
}


/**
 * 3. Abyss Player (Abyssdub) Extractor
 * Extracts media slug and tokenized stream parameters from Abyss Player.
 */
export async function extractAbyssStream(embedUrl) {
    console.log(`[*] Resolving Abyss Player Stream: ${embedUrl}...`);
    const res = await fetch(embedUrl, {
        headers: {
            'User-Agent': USER_AGENT,
            'Referer': BASE_URL
        }
    });
    const html = await res.text();

    // Check for base64 datas payload
    const datasMatch = html.match(/const\s+datas\s*=\s*["']([^"']+)["']/);
    if (datasMatch) {
        try {
            const decoded = JSON.parse(Buffer.from(datasMatch[1], 'base64').toString('utf-8'));
            console.log(`[*] Abyss Player Decoded Payload (Slug: ${decoded.slug}, ID: ${decoded.md5_id})`);
            
            // Check direct stream inside payload
            if (decoded.media && decoded.media.startsWith('http')) {
                return {
                    server: 'Abyss',
                    streamUrl: decoded.media,
                    headers: { 'User-Agent': USER_AGENT, 'Referer': 'https://player.abyssplayer.com/' }
                };
            }
        } catch {}
    }

    const m3u8Match = html.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/);
    if (m3u8Match) {
        return {
            server: 'Abyss',
            streamUrl: m3u8Match[0],
            headers: { 'User-Agent': USER_AGENT, 'Referer': 'https://player.abyssplayer.com/' }
        };
    }

    throw new Error(`Abyss Player stream requires client decryption: ${embedUrl}`);
}

/**
 * 4. P2PPlay (Streamp2pdub) Extractor
 * Resolves P2P / WebTorrent / HLS stream from p2pplay.pro.
 */
export async function extractP2PPlayStream(embedUrl) {
    console.log(`[*] Resolving StreamP2P Stream: ${embedUrl}...`);
    const res = await fetch(embedUrl, {
        headers: {
            'User-Agent': USER_AGENT,
            'Referer': BASE_URL
        }
    });
    const html = await res.text();

    const m3u8Match = html.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/);
    if (m3u8Match) {
        return {
            server: 'StreamP2P',
            streamUrl: m3u8Match[0],
            headers: { 'User-Agent': USER_AGENT, 'Referer': 'https://desidubanime.p2pplay.pro/' }
        };
    }

    throw new Error(`StreamP2P stream is served via WebRTC/P2P protocol: ${embedUrl}`);
}

// ─────────────────────────────────────────────────────────────
// MASTER DISPATCHER WITH AUTO-FALLBACK ACROSS ALL 4 PLAYERS
// ─────────────────────────────────────────────────────────────

/**
 * Extracts playable stream from an episode watch URL with full multi-server fallback.
 * 
 * @param {string} watchUrl - e.g. 'https://www.desidubanime.me/watch/...-episode-20/'
 * @param {string} [preferredServer='vidmoly'] - 'vidmoly', 'mirror', 'abyss', 'p2p'
 */
export async function extractEpisodeStream(watchUrl, preferredServer = 'vidmoly') {
    console.log(`\n==================================================`);
    console.log(`🎬 MULTI-SERVER EPISODE EXTRACTION`);
    console.log(`   Watch URL: ${watchUrl}`);
    console.log(`   Preferred: ${preferredServer}`);
    console.log(`==================================================`);

    const res = await fetch(watchUrl, {
        headers: { 'User-Agent': USER_AGENT }
    });
    if (!res.ok) throw new Error(`Failed to load watch page (${res.status}): ${watchUrl}`);
    const html = await res.text();

    // Extract title & episode number
    const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<title>([\s\S]*?)<\/title>/i);
    let title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : 'Anime Episode';
    title = title.replace(/\s*-\s*DesiDubAnime.*/i, '').trim();

    const epMatch = watchUrl.match(/episode-(\d+)/i) || title.match(/Episode\s*(\d+)/i);
    const episodeNumber = epMatch ? parseInt(epMatch[1], 10) : 1;

    // Decode ALL servers from base64 data-embed-id attributes
    const serverRegex = /data-embed-id=['"]([^'"]+)['"]/g;
    let match;
    const servers = [];

    while ((match = serverRegex.exec(html)) !== null) {
        const parts = match[1].split(':');
        if (parts.length === 2) {
            try {
                const name = Buffer.from(parts[0], 'base64').toString('utf-8');
                let embedUrl = Buffer.from(parts[1], 'base64').toString('utf-8');
                const srcMatch = embedUrl.match(/src=['"]([^'"]+)['"]/i);
                if (srcMatch) embedUrl = srcMatch[1];
                if (embedUrl.startsWith('//')) embedUrl = 'https:' + embedUrl;
                if (!embedUrl.startsWith('http')) embedUrl = 'https://' + embedUrl;
                if (embedUrl.includes('vidmoly')) {
                    embedUrl = embedUrl.replace(/vidmoly\.[a-z0-9]+/i, 'vidmoly.org');
                }
                servers.push({ name, embedUrl });
            } catch {}
        }
    }

    const iframeMatch = html.match(/<iframe[^>]+src=['"]([^'"]+)['"]/i);
    if (iframeMatch && !servers.some(s => s.embedUrl === iframeMatch[1])) {
        let defaultUrl = iframeMatch[1];
        if (defaultUrl.startsWith('//')) defaultUrl = 'https:' + defaultUrl;
        if (!defaultUrl.startsWith('http')) defaultUrl = 'https://' + defaultUrl;
        if (defaultUrl.includes('vidmoly')) {
            defaultUrl = defaultUrl.replace(/vidmoly\.[a-z0-9]+/i, 'vidmoly.org');
        }
        servers.unshift({ name: 'DefaultEmbed', embedUrl: defaultUrl });
    }

    console.log(`[*] Detected ${servers.length} server(s) on watch page:`);
    servers.forEach(s => console.log(`   • [${s.name}] -> ${s.embedUrl}`));

    // Sort order based on preferredServer
    const prefStr = (typeof preferredServer === 'string' ? preferredServer : (preferredServer?.server || 'vidmoly')).toLowerCase();
    const serverKeys = ['vidmoly', 'ruby', 'mirror', 'abyss', 'p2p'];
    const orderedKeys = [
        prefStr,
        ...serverKeys.filter(k => k !== prefStr)
    ];

    let lastError = null;

    // Try extractors in prioritized order
    for (const key of orderedKeys) {
        if (key === 'vidmoly') {
            const s = servers.find(x => x.name.toLowerCase().includes('moly') || x.embedUrl.includes('vidmoly'));
            if (s) {
                try {
                    const result = await extractVidMolyStream(s.embedUrl);
                    return {
                        title,
                        episodeNumber,
                        serverName: result.server,
                        streamUrl: result.streamUrl,
                        headers: result.headers,
                        availableServers: servers
                    };
                } catch (e) {
                    console.warn(`[!] VidMoly extraction failed: ${e.message}`);
                    lastError = e;
                }
            }
        }

        if (key === 'ruby') {
            const s = servers.find(x => x.name.toLowerCase().includes('ruby') || x.embedUrl.includes('rubyvidhub') || x.embedUrl.includes('streamruby'));
            if (s) {
                try {
                    const result = await extractRubyStream(s.embedUrl);
                    return {
                        title,
                        episodeNumber,
                        serverName: result.server,
                        streamUrl: result.streamUrl,
                        headers: result.headers,
                        availableServers: servers
                    };
                } catch (e) {
                    console.warn(`[!] Ruby extraction failed: ${e.message}`);
                    lastError = e;
                }
            }
        }

        if (key === 'mirror') {
            const s = servers.find(x => x.name.toLowerCase().includes('mirror') || x.embedUrl.includes('filesforever'));
            if (s) {
                try {
                    const result = await extractFilesForeverStream(s.embedUrl);
                    return {
                        title,
                        episodeNumber,
                        serverName: result.server,
                        streamUrl: result.streamUrl,
                        headers: result.headers,
                        availableServers: servers
                    };
                } catch (e) {
                    console.warn(`[!] FilesForever extraction failed: ${e.message}`);
                    lastError = e;
                }
            }
        }

        if (key === 'abyss') {
            const s = servers.find(x => x.name.toLowerCase().includes('abyss') || x.embedUrl.includes('abyss'));
            if (s) {
                try {
                    const result = await extractAbyssStream(s.embedUrl);
                    return {
                        title,
                        episodeNumber,
                        serverName: result.server,
                        streamUrl: result.streamUrl,
                        headers: result.headers,
                        availableServers: servers
                    };
                } catch (e) {
                    console.warn(`[!] Abyss extraction failed: ${e.message}`);
                    lastError = e;
                }
            }
        }

        if (key === 'p2p') {
            const s = servers.find(x => x.name.toLowerCase().includes('p2p') || x.embedUrl.includes('p2p'));
            if (s) {
                try {
                    const result = await extractP2PPlayStream(s.embedUrl);
                    return {
                        title,
                        episodeNumber,
                        serverName: result.server,
                        streamUrl: result.streamUrl,
                        headers: result.headers,
                        availableServers: servers
                    };
                } catch (e) {
                    console.warn(`[!] StreamP2P extraction failed: ${e.message}`);
                    lastError = e;
                }
            }
        }
    }

    throw lastError || new Error(`No working stream could be extracted from servers for: ${watchUrl}`);
}
