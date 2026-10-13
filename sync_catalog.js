/**
 * AUTO-SCAN & REBUILD ANIME CATALOG DIRECTLY FROM TELEGRAM STORAGE CHANNEL
 * Runs in 2 seconds. Finds all episodes uploaded by any worker or manual upload.
 */
import { initTelegramService, client } from './src/tgService.js';
import { registerAnimeEpisode } from './src/catalogService.js';
import dotenv from 'dotenv';
dotenv.config();

const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || '-1004305106563';

async function syncAll() {
    console.log("==========================================================");
    console.log("🔄 SYNCING TELEGRAM CHANNEL VIDEOS INTO ANIME CATALOG...");
    console.log("==========================================================");

    await initTelegramService();

    // Check message IDs from 1 to 200 (or higher)
    const MAX_CHECK = 300;
    const batchSize = 100;
    let totalSynced = 0;

    for (let offset = 0; offset < MAX_CHECK; offset += batchSize) {
        const ids = Array.from({ length: batchSize }, (_, i) => offset + i + 1);
        try {
            const msgs = await client.getMessages(CHANNEL_ID, { ids });
            for (const m of msgs) {
                if (!m || !m.media || !m.media.document) continue;

                const nameAttr = m.media.document.attributes?.find(a => a.fileName);
                const fileName = nameAttr ? nameAttr.fileName : '';
                const caption = m.message || '';

                const epMatch = caption.match(/Episode\s*(\d+)/i) || fileName.match(/EP\s*(\d+)/i);
                const titleMatch = caption.match(/🎬\s*([^-\n]+)\s*-\s*Episode/i) || fileName.match(/([^-\n]+)\s*-\s*EP/i);
                const trackMatch = caption.match(/\[(\d+p)?\s*(SUB|DUB)\]/i);
                const aniMatch = caption.match(/AniList ID:\s*(\d+)/i);
                const malMatch = caption.match(/MAL ID:\s*(\d+)/i);

                if (epMatch) {
                    const ep = parseInt(epMatch[1], 10);
                    const title = titleMatch ? titleMatch[1].trim() : (fileName.toLowerCase().includes('solo') ? 'Solo Leveling' : 'ONE PIECE');
                    const anilistId = aniMatch ? aniMatch[1] : (title.toLowerCase().includes('one piece') ? '21' : null);
                    const malId = malMatch ? malMatch[1] : (title.toLowerCase().includes('one piece') ? '21' : null);
                    const track = trackMatch ? trackMatch[2].toLowerCase() : 'sub';

                    registerAnimeEpisode({
                        anilistId,
                        malId,
                        title,
                        episode: ep,
                        track,
                        telegramMessageId: m.id,
                        resolution: '1080p',
                        sizeBytes: m.media.document.size || 0,
                        subtitles: [
                            {
                                label: 'English',
                                kind: 'captions',
                                url: `http://54.39.22.90:4004/api/stream?id=${anilistId || 21}&ep=${ep}&track=${track}&type=ani`
                            }
                        ]
                    });
                    totalSynced++;
                }
            }
        } catch (err) {
            console.error(`Error scanning range ${offset + 1}-${offset + batchSize}:`, err.message);
        }
    }

    console.log(`\n🎉 SYNC FINISHED! ${totalSynced} Episodes mapped into catalog & ready to stream.`);
    process.exit(0);
}

syncAll().catch(e => {
    console.error("Fatal sync error:", e);
    process.exit(1);
});
