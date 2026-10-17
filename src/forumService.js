/**
 * FORUM SERVICE FOR TELEGRAM TOPICS
 * Automatically creates anime topics and copies uploaded episodes into them
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const FORUM_GROUP_ID = process.env.TELEGRAM_FORUM_GROUP_ID || '-1003907689908';
const SOURCE_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || '-1004365995315';

async function telegramApi(method, body) {
    try {
        const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(15000)
        });
        return await res.json();
    } catch (e) {
        return { ok: false, description: e.message };
    }
}

export async function createForumTopic(title) {
    const safeTitle = (title || 'Anime').replace(/[\r\n]+/g, ' ').trim();
    let topicName = `🎬 ${safeTitle} [Hindi Dub]`;
    if (topicName.length > 125) {
        topicName = topicName.slice(0, 122) + '...';
    }
    const data = await telegramApi('createForumTopic', {
        chat_id: FORUM_GROUP_ID,
        name: topicName
    });
    if (data.ok && data.result?.message_thread_id) {
        return data.result.message_thread_id;
    }
    console.warn(`[ForumService] Failed to create topic:`, data);
    return null;
}

export async function copyMessageToTopic(threadId, telegramMessageId) {
    if (!threadId || !telegramMessageId) return null;
    const data = await telegramApi('copyMessage', {
        chat_id: FORUM_GROUP_ID,
        message_thread_id: threadId,
        from_chat_id: SOURCE_CHANNEL_ID,
        message_id: telegramMessageId
    });
    if (data.ok) {
        return data.result.message_id;
    }
    console.warn(`[ForumService] Failed to copy msg ${telegramMessageId} to topic ${threadId}:`, data);
    return null;
}

export async function ensureAnimeTopic(anime) {
    if (!anime) return null;
    if (anime.telegram_topic_id) return anime.telegram_topic_id;
    
    const topicId = await createForumTopic(anime.title_english || anime.title_romaji);
    if (topicId) {
        anime.telegram_topic_id = topicId;
        const { exec } = await import('child_process');
        const sql = `UPDATE telegram_hindi_anime SET telegram_topic_id = ${topicId} WHERE id = ${anime.id};`;
        exec(`sqlite3 /www/wwwroot/anilist_database/anilist.db "${sql}"`);
        console.log(`[ForumService] 📁 Created and linked Forum Topic ID ${topicId} for "${anime.title_english}"`);
    }
    return topicId;
}

export async function syncEpisodeToForumTopic({ anime, episodeNumber, telegramMessageId }) {
    try {
        if (!anime || !telegramMessageId) return;
        const topicId = await ensureAnimeTopic(anime);
        if (topicId) {
            const forumMsgId = await copyMessageToTopic(topicId, telegramMessageId);
            if (forumMsgId) {
                console.log(`[ForumService] 🚀 Copied EP ${episodeNumber} to Forum Topic "${anime.title_english}" (Msg ${forumMsgId})`);
            }
        }
    } catch (err) {
        console.warn(`[ForumService] syncEpisodeToForumTopic error:`, err.message);
    }
}

export async function attachForumButton(channelId, messageId, targetUrl = 'https://t.me/newanimehindi2026') {
    try {
        if (!channelId || !messageId) return false;
        const res = await telegramApi('editMessageReplyMarkup', {
            chat_id: channelId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '📁 Open Hindi Anime Forum Hub',
                            url: targetUrl
                        }
                    ]
                ]
            }
        });
        return res.ok || false;
    } catch (err) {
        console.warn(`[ForumService] attachForumButton error:`, err.message);
        return false;
    }
}
