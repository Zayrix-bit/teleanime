# 🎬 DesiDubAnime Scraper & High-Speed Telegram Stream Pipeline

A reverse-engineered, professional Node.js & FFmpeg pipeline for **[DesiDubAnime.me](https://www.desidubanime.me/)**. It automates search, catalog indexing, episode resolution, multi-server stream extraction (VidMoly master M3U8 with Hindi Dub audio), lossless remuxing into single MP4 with `faststart`, and instant MTProto uploading to a Telegram Channel.

---

## ⚡ Reverse-Engineered Architecture & Features

```
[DesiDubAnime.me]
       │
       ├─► 1. REST Search & Catalog (WordPress REST API: /wp-json/wp/v2/anime)
       │      Fast JSON response with 540+ regional dubbed anime.
       │
       ├─► 2. Episode Discovery (/anime/{slug}/ & /watch/{slug}-episode-{ep}/)
       │      Auto-discovers all available episode numbers and watch URLs.
       │
       ├─► 3. Player Embed Decoder (Base64 data-embed-id attributes)
       │      Decodes servers: VMolydub, Mirrordub, Abyssdub, Streamp2pdub.
       │
       ├─► 4. Stream Extractor (VidMoly / VMolydub)
       │      Extracts Master M3U8 with Multi-Audio tracks (Hindi, English, Japanese).
       │
       ├─► 5. Lossless FFmpeg Remuxer (-c copy -movflags +faststart)
       │      Maps video + Hindi audio track into a single web-optimized MP4 in seconds.
       │
       └─► 6. Telegram MTProto Uploader (supportsStreaming: true)
              Uploads directly to Telegram Channel with in-app streaming enabled.
```

---

## 🚀 CLI Usage

### 1. Search Anime
```bash
node index.js --search "slime"
```

### 2. List Episodes of an Anime
```bash
node index.js --episodes "tensei-shitara-slime-datta-ken-4th-season"
```

### 3. Browse 540+ Anime Catalog
```bash
node index.js --catalog --page 1
```

### 4. Scrape, Convert & Upload Specific Episode
```bash
# By Anime Name & Episode
node index.js --anime "slime" --ep 20

# By Direct DesiDubAnime Watch URL
node index.js --url "https://www.desidubanime.me/watch/tensei-shitara-slime-datta-ken-4th-season-episode-20/"
```

### 5. Universal Direct Stream URL
```bash
node index.js --url "https://example.com/stream.m3u8" --title "Custom Episode"
```

---

## ☁️ Running on GitHub Actions

Go to **Actions** ➔ **DesiDubAnime & Stream Ingestion Pipeline** ➔ **Run workflow**:

- **Mode**: `desidub_anime` (or `direct_url`)
- **Anime Name**: e.g., `slime` or `solo leveling`
- **Episode Number**: e.g., `20`
- **Direct URL**: (If using `direct_url` mode)

---

## 📁 Repository Structure

```
telegram-streamer/
├── .github/
│   └── workflows/
│       └── stream_pipeline.yml     # GitHub Actions workflow dispatch
├── src/
│   ├── desidubScraper.js           # Core DesiDubAnime search, catalog & stream decoder
│   ├── scraper.js                  # Main scraper dispatcher & plugin registry
│   ├── converter.js                # FFmpeg HLS remuxer & ffprobe metadata extractor
│   └── telegram.js                 # Telegram MTProto client with chunked uploader
├── index.js                        # Master CLI tool
├── package.json                    # Minimal dependencies (telegram, dotenv)
├── .env.example                    # Telegram credentials template
└── README.md
```
