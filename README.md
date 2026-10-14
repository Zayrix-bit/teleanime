# 🚀 Cloud Stream Scraper & Telegram Ingestion Pipeline

A lightweight, high-performance Node.js & FFmpeg pipeline designed to run on GitHub Actions or locally. It scrapes stream links (M3U8 / HLS / TS chunks / direct MP4), converts them into a single clean, web-optimized MP4 with `faststart`, and uploads directly to a Telegram Channel via native MTProto Layer with in-app streaming enabled.

---

## ⚡ Architecture & Pipeline

```
[Target Site / Stream URL]
           │
           ▼
1. Scraper / Stream Resolver (src/scraper.js)
           │ (Extracts M3U8, TS chunks, or direct MP4 link)
           ▼
2. FFmpeg Remuxer & Merger (src/converter.js)
           │ (Lossless stream copy -c copy + faststart movflags)
           ▼
3. FFprobe Video Metadata Extraction
           │ (Duration, width, height, bitrate)
           ▼
4. Telegram MTProto Uploader (src/telegram.js)
           │ (Chunked upload, supportsStreaming: true, progress logs)
           ▼
[Telegram Storage Channel]
```

---

## 📁 Clean Repository Structure

```
telegram-streamer/
├── .github/
│   └── workflows/
│       └── stream_pipeline.yml  # GitHub Actions workflow dispatch pipeline
├── src/
│   ├── scraper.js               # Scraper dispatcher & site plugin interface
│   ├── converter.js             # M3U8 / TS stream downloader & FFmpeg remuxer
│   └── telegram.js              # Telegram MTProto client & uploader
├── index.js                     # Main CLI pipeline orchestrator
├── package.json                 # Minimal dependencies (telegram, dotenv)
├── .env                         # Local environment credentials
├── .env.example                 # Example configuration
└── README.md
```

---

## 🚀 Usage

### 1. Run with Direct Stream Link (M3U8 / MP4)
```bash
node index.js --url "https://example.com/stream/index.m3u8" --title "My Episode 01" --ep 1
```

### 2. Run with Custom Caption
```bash
node index.js --url "https://example.com/video.mp4" --title "One Piece" --ep 101 --caption "🎬 One Piece Episode 101 [1080p]"
```

### 3. Run via GitHub Actions
Go to **Actions** -> **Cloud Stream Scraper & Telegram Ingestion** -> **Run workflow**:
- **Target URL**: Stream link or site page URL
- **Title**: Episode or video title
- **Episode Number**: Optional

---

## 🔌 Adding Your Custom Site Scraper

In `src/scraper.js`, register your site handler:

```javascript
import { registerScraper } from './src/scraper.js';

registerScraper('mysite', async ({ url, episode, quality }) => {
    // 1. Fetch webpage or API
    // 2. Extract m3u8 or ts stream URL
    return {
        streamUrl: 'https://...',
        title: 'Extracted Title',
        headers: { 'Referer': 'https://mysite.com/' }
    };
});
```
