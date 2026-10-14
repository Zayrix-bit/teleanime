/**
 * STREAM SCRAPER INTERFACE & PLUGIN REGISTRY
 * 
 * Note: When you share your target site details, your custom scraping
 * logic will be added here in 'siteScrapers'.
 */

// Registry of site-specific scraper handlers
const siteScrapers = {
    /**
     * Example template for custom site scraper:
     * 
     * 'mysite': async ({ url, id, episode, quality }) => {
     *     // Fetch target webpage or API
     *     // Extract m3u8 or mp4 stream URL
     *     // Return { streamUrl, title, headers, subtitles }
     * }
     */
};

/**
 * Registers a new site scraper plugin.
 * 
 * @param {string} name - Identifier for the site
 * @param {Function} handler - Async function returning { streamUrl, title, headers }
 */
export function registerScraper(name, handler) {
    siteScrapers[name.toLowerCase()] = handler;
}

/**
 * Main scraper dispatcher.
 * Resolves a page URL, search query, or direct stream link into a usable stream URL.
 * 
 * @param {Object} options
 * @param {string} [options.url] - Direct stream URL or target webpage URL
 * @param {string} [options.site] - Site key to invoke a specific scraper plugin
 * @param {string} [options.title] - Optional video title
 * @param {string|number} [options.episode] - Episode number if applicable
 * @param {string} [options.quality] - Preferred resolution (e.g. 1080p, 720p)
 * @returns {Promise<{ streamUrl: string, title: string, headers: Object, subtitles: Array }>}
 */
export async function scrapeStream({ url, site, title = '', episode = null, quality = '1080p' } = {}) {
    console.log(`\n==================================================`);
    console.log(`🔍 RESOLVING STREAM`);
    if (site) console.log(`   Site Scraper: ${site}`);
    if (url) console.log(`   Input URL: ${url}`);
    if (episode) console.log(`   Episode: ${episode}`);
    console.log(`==================================================`);

    // 1. If a specific site scraper plugin is requested
    if (site && siteScrapers[site.toLowerCase()]) {
        console.log(`[*] Executing scraper for site: "${site}"...`);
        return await siteScrapers[site.toLowerCase()]({ url, episode, quality });
    }

    // 2. Direct stream URL (M3U8 / MP4 / TS)
    if (url) {
        const isM3u8 = url.includes('.m3u8');
        const isMp4 = url.includes('.mp4');
        const isTs = url.includes('.ts');

        if (isM3u8 || isMp4 || isTs) {
            console.log(`✅ Direct stream detected (${isM3u8 ? 'HLS M3U8' : isMp4 ? 'Direct MP4' : 'TS Stream'}).`);
            const fallbackTitle = title || `Stream_${Date.now()}`;
            return {
                streamUrl: url,
                title: fallbackTitle,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                subtitles: []
            };
        }

        // If URL is a webpage, the user can plug in the extractor when ready
        console.log(`[!] Target URL provided: ${url}`);
        return {
            streamUrl: url,
            title: title || `Video_${Date.now()}`,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            subtitles: []
        };
    }

    throw new Error("No URL or valid site scraper specified. Provide --url <link> or --site <name>.");
}
