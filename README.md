# 🎬 TeleBotAnime · High-Speed Telegram Video Streaming Gateway

A high-performance Node.js video storage and streaming server that uses **Telegram MTProto (GramJS)** as a zero-cost, unlimited-storage cloud backend.

---

## ⚡ Features

- **Unlimited Cloud Video Storage**: Stores full 1080p/4K MP4 & MKV files up to **2 GB / 4 GB** in private Telegram channels.
- **Zero 20MB Bot Limit**: Uses native **Telegram MTProto Layer 198 Client** to bypass the standard 20MB Bot API download cap.
- **HTTP 206 Partial Content (RFC 7233)**: Supports real-time video seeking, scrubbing, and streaming in HTML5 `<video>`, JW Player, and Cinema Player without downloading the entire file upfront.
- **In-Memory LRU RAM Cache (250 MB Cap)**: Repeat chunk and seek requests are served from memory in **< 1ms**.
- **Dark Glassmorphism Cinema Player**: Beautiful Netflix-style web player at `/player/:messageId`.
- **Drag & Drop Web Uploader**: Upload videos directly from your browser to Telegram at `/`.
- **Embeddable Iframe Code**: Easily embed any video into other websites.

---

## 🚀 How to Run

### 1. Locally
```bash
cd telegram-streamer
npm start
```
Server runs at `http://localhost:4015/`.

### 2. On VPS with PM2 (Background Daemon)
```bash
cd /www/wwwroot/scrapers/telegram-streamer
sudo -u www pm2 start server.js --name telegram-streamer
sudo -u www pm2 save
```

---

## 📡 Endpoints

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/` | `GET` | Web Dashboard & Drag-and-Drop Uploader |
| `/player/:messageId` | `GET` | Cinema Video Player UI |
| `/stream/:messageId` | `GET` | Raw HTTP 206 Video Stream (for `<video>` tags & players) |
| `/api/upload` | `POST` | Upload video file to Telegram |
| `/api/files` | `GET` | JSON list of all stored videos |
| `/health` | `GET` | Gateway & Telegram connection status |

---

## 📺 How to Use in Your Player or Website

### Option 1: Direct Video Tag
```html
<video controls width="100%" poster="poster.jpg">
    <source src="http://localhost:4015/stream/4" type="video/mp4">
</video>
```

### Option 2: Embeddable Cinema Player Iframe
```html
<iframe src="http://localhost:4015/player/4" width="100%" height="540" frameborder="0" allowfullscreen></iframe>
```
