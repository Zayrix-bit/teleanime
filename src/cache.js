/**
 * HIGH-SPEED IN-MEMORY CHUNK CACHE FOR TELEGRAM STREAMING
 * Caches frequently requested byte ranges (e.g. video headers and seek points)
 * Max RAM Cap: 250 MB | Default TTL: 15 Minutes
 */

const cache = new Map();
let currentCacheBytes = 0;
const MAX_BYTES = 250 * 1024 * 1024; // 250 MB

export function getCachedChunk(key) {
    const item = cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiry) {
        currentCacheBytes -= item.buffer.length;
        cache.delete(key);
        return null;
    }
    return item.buffer;
}

export function setCachedChunk(key, buffer, ttlMs = 15 * 60 * 1000) {
    if (!buffer || buffer.length === 0) return;
    
    // Evict oldest entries if capacity exceeded
    while ((currentCacheBytes + buffer.length > MAX_BYTES || cache.size > 500) && cache.size > 0) {
        const oldestKey = cache.keys().next().value;
        const oldItem = cache.get(oldestKey);
        if (oldItem) currentCacheBytes -= oldItem.buffer.length;
        cache.delete(oldestKey);
    }

    cache.set(key, { buffer, expiry: Date.now() + ttlMs });
    currentCacheBytes += buffer.length;
}

export function getCacheStats() {
    return {
        entries: cache.size,
        totalBytes: currentCacheBytes,
        totalMB: (currentCacheBytes / (1024 * 1024)).toFixed(2),
        maxMB: (MAX_BYTES / (1024 * 1024)).toFixed(0)
    };
}
