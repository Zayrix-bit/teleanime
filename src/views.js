/**
 * USER INTERFACE & EMBED PLAYER TEMPLATES
 * Premium Dark Glassmorphism Cinema UI for Telegram Video Streaming
 */

export function renderPlayerHtml({ 
    messageId, 
    fileName, 
    sizeMB, 
    streamUrl, 
    title, 
    episode, 
    track, 
    poster, 
    anilistId, 
    malId 
}) {
    const displayTitle = title 
        ? `${title} · Episode ${episode} [${(track || 'sub').toUpperCase()}]`
        : fileName;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${displayTitle} · Cinema Player</title>
    <style>
        :root {
            --bg-base: #06070a;
            --bg-card: #0f1118;
            --accent-primary: #38bdf8;
            --accent-glow: rgba(56, 189, 248, 0.25);
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --border-color: #1e2235;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background-color: var(--bg-base);
            color: var(--text-main);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            overflow-x: hidden;
        }
        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 24px;
            background: rgba(15, 17, 24, 0.85);
            backdrop-filter: blur(12px);
            border-bottom: 1px solid var(--border-color);
            position: sticky;
            top: 0;
            z-index: 50;
        }
        .header-title {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .badge {
            background: rgba(56, 189, 248, 0.15);
            color: var(--accent-primary);
            border: 1px solid rgba(56, 189, 248, 0.3);
            font-size: 11px;
            font-weight: 700;
            padding: 3px 8px;
            border-radius: 6px;
            letter-spacing: 0.05em;
        }
        .badge-id {
            background: rgba(168, 85, 247, 0.15);
            color: #c084fc;
            border: 1px solid rgba(168, 85, 247, 0.3);
            font-size: 11px;
            font-weight: 600;
            padding: 3px 8px;
            border-radius: 6px;
        }
        .file-name {
            font-size: 15px;
            font-weight: 600;
            max-width: 500px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .file-size {
            font-size: 12px;
            color: var(--text-muted);
            margin-left: 8px;
        }
        .actions {
            display: flex;
            gap: 10px;
        }
        .btn {
            background: var(--border-color);
            color: var(--text-main);
            border: 1px solid #2a3048;
            padding: 7px 14px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s ease;
        }
        .btn:hover {
            background: #282f48;
            border-color: var(--accent-primary);
            color: var(--accent-primary);
        }
        .btn-primary {
            background: var(--accent-primary);
            color: #040d1a;
            border: none;
            font-weight: 600;
        }
        .btn-primary:hover {
            background: #7dd3fc;
            color: #040d1a;
        }
        .player-wrapper {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            position: relative;
        }
        .video-container {
            width: 100%;
            max-width: 1100px;
            aspect-ratio: 16 / 9;
            background: #000;
            border-radius: 14px;
            overflow: hidden;
            border: 1px solid var(--border-color);
            box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.8), 0 0 35px -5px var(--accent-glow);
            position: relative;
        }
        video {
            width: 100%;
            height: 100%;
            object-fit: contain;
            display: block;
        }
        .footer-info {
            padding: 16px 24px;
            text-align: center;
            font-size: 12px;
            color: var(--text-muted);
            border-top: 1px solid var(--border-color);
        }
        .copy-toast {
            position: fixed;
            bottom: 24px;
            left: 50%;
            transform: translateX(-50%) translateY(100px);
            background: #10b981;
            color: #fff;
            padding: 10px 20px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            z-index: 100;
        }
        .copy-toast.show {
            transform: translateX(-50%) translateY(0);
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-title">
            <span class="badge">TELEGRAM STREAM</span>
            ${anilistId ? `<span class="badge-id">AniList #${anilistId}</span>` : ''}
            ${malId ? `<span class="badge-id" style="color: #f472b6; border-color: rgba(236,72,153,0.3); background: rgba(236,72,153,0.15);">MAL #${malId}</span>` : ''}
            <span class="file-name">${displayTitle}</span>
            <span class="file-size">(${sizeMB || '0'} MB)</span>
        </div>
        <div class="actions">
            <a href="/" class="btn">← Dashboard</a>
            <button class="btn" onclick="copyStreamUrl()">Copy Stream URL</button>
            <button class="btn btn-primary" onclick="copyEmbedCode()">Copy &lt;iframe&gt;</button>
        </div>
    </div>

    <div class="player-wrapper">
        <div class="video-container">
            <video controls autoplay playsinline preload="metadata">
                <source src="${streamUrl}" type="video/mp4">
                Your browser does not support HTML5 video streaming.
            </video>
        </div>
    </div>

    <div class="footer-info">
        Streaming via Telegram MTProto Layer 198 · Zero-Egress Storage · Direct Partial Range (RFC 7233)
    </div>

    <div id="toast" class="copy-toast">Copied to clipboard!</div>

    <script>
        function showToast(text) {
            const t = document.getElementById('toast');
            t.innerText = text;
            t.classList.add('show');
            setTimeout(() => t.classList.remove('show'), 2200);
        }
        function copyStreamUrl() {
            navigator.clipboard.writeText(window.location.origin + '${streamUrl}');
            showToast('Stream URL copied!');
        }
        function copyEmbedCode() {
            const code = '<iframe src="' + window.location.href + '" width="100%" height="100%" frameborder="0" allowfullscreen></iframe>';
            navigator.clipboard.writeText(code);
            showToast('Iframe embed code copied!');
        }
    </script>
</body>
</html>`;
}

export function renderDashboardHtml({ videos = [], animeCatalog = [], cacheStats = {} }) {
    const catalogRows = animeCatalog.map(a => `
        <tr>
            <td style="width: 48px;">
                ${a.poster ? `<img src="${a.poster}" style="width: 42px; height: 58px; object-fit: cover; border-radius: 6px; border: 1px solid #202638;">` : '<div style="width: 42px; height: 58px; background: #151926; border-radius: 6px;"></div>'}
            </td>
            <td>
                <div class="vid-title" style="font-size: 14px;">${a.title}</div>
                <div class="vid-caption" style="display: flex; gap: 8px; margin-top: 4px; align-items: center;">
                    <span style="color: #38bdf8; font-weight: 700; background: rgba(56,189,248,0.1); padding: 2px 6px; border-radius: 4px;">EP ${a.episode}</span>
                    <span style="color: #c084fc; font-size: 11px;">AniList #${a.anilistId || 'N/A'}</span>
                    <span style="color: #f472b6; font-size: 11px;">MAL #${a.malId || 'N/A'}</span>
                </div>
            </td>
            <td>
                <span class="size-badge" style="background: ${a.track === 'dub' ? 'rgba(236,72,153,0.15)' : 'rgba(56,189,248,0.15)'}; color: ${a.track === 'dub' ? '#f472b6' : '#38bdf8'}; font-weight: 700;">
                    ${(a.track || 'sub').toUpperCase()}
                </span>
            </td>
            <td><span class="size-badge">${a.sizeMB || '0'} MB</span></td>
            <td style="color: #94a3b8; font-family: monospace; font-size: 12px;">#${a.telegramMessageId}</td>
            <td class="col-actions">
                <a href="${a.playerUrl || `/player/${a.telegramMessageId}`}" class="btn-play">▶ Watch</a>
                <a href="${a.streamUrl || `/stream/${a.telegramMessageId}`}" target="_blank" class="btn-sub">Stream</a>
            </td>
        </tr>
    `).join('');

    const videoRows = videos.map(v => `
        <tr>
            <td class="col-id">#${v.id}</td>
            <td class="col-title">
                <div class="vid-title">${v.fileName}</div>
                <div class="vid-caption">${v.caption || 'No caption'}</div>
            </td>
            <td><span class="size-badge">${v.sizeMB} MB</span></td>
            <td>${v.resolution}</td>
            <td class="col-date">${v.date}</td>
            <td class="col-actions">
                <a href="/player/${v.id}" class="btn-play">▶ Play</a>
                <a href="/stream/${v.id}" target="_blank" class="btn-sub">Stream URL</a>
            </td>
        </tr>
    `).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TeleBotAnime · Cloud Video Gateway</title>
    <style>
        :root {
            --bg-base: #08090e;
            --bg-card: #0f121b;
            --bg-subtle: #151926;
            --border: #202638;
            --accent: #38bdf8;
            --accent-glow: rgba(56, 189, 248, 0.2);
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background-color: var(--bg-base);
            color: var(--text-main);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            min-height: 100vh;
            padding: 32px 24px;
        }
        .container {
            max-width: 1100px;
            margin: 0 auto;
        }
        .top-hero {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 28px;
            padding-bottom: 20px;
            border-bottom: 1px solid var(--border);
        }
        .logo-group h1 {
            font-size: 22px;
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .logo-group p {
            font-size: 13px;
            color: var(--text-muted);
            margin-top: 4px;
        }
        .stat-badge {
            background: var(--bg-subtle);
            border: 1px solid var(--border);
            padding: 8px 14px;
            border-radius: 8px;
            font-size: 12px;
            color: var(--accent);
            font-weight: 600;
        }
        .upload-card {
            background: var(--bg-card);
            border: 2px dashed #283048;
            border-radius: 14px;
            padding: 32px;
            text-align: center;
            margin-bottom: 32px;
            transition: all 0.2s ease;
            position: relative;
        }
        .upload-card:hover {
            border-color: var(--accent);
            background: rgba(56, 189, 248, 0.02);
        }
        .upload-title {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 8px;
        }
        .upload-sub {
            font-size: 13px;
            color: var(--text-muted);
            margin-bottom: 18px;
        }
        .file-input {
            position: absolute;
            top: 0; left: 0; width: 100%; height: 100%;
            opacity: 0;
            cursor: pointer;
        }
        .upload-btn {
            background: var(--accent);
            color: #040d1a;
            font-weight: 700;
            padding: 10px 24px;
            border-radius: 8px;
            border: none;
            cursor: pointer;
            pointer-events: none;
            display: inline-block;
        }
        .progress-bar {
            height: 6px;
            background: #202638;
            border-radius: 3px;
            margin-top: 16px;
            overflow: hidden;
            display: none;
        }
        .progress-fill {
            height: 100%;
            width: 0%;
            background: var(--accent);
            transition: width 0.2s ease;
        }
        .table-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 14px;
            overflow: hidden;
        }
        .table-header {
            padding: 16px 20px;
            font-size: 14px;
            font-weight: 700;
            border-bottom: 1px solid var(--border);
            display: flex;
            justify-content: space-between;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }
        th, td {
            padding: 14px 18px;
            text-align: left;
            border-bottom: 1px solid var(--border);
        }
        th {
            background: var(--bg-subtle);
            color: var(--text-muted);
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        tr:last-child td { border-bottom: none; }
        tr:hover td { background: rgba(255, 255, 255, 0.015); }
        .col-id { font-family: monospace; color: var(--text-muted); font-weight: 700; width: 60px; }
        .col-title { max-width: 380px; }
        .vid-title { font-weight: 600; color: #fff; word-break: break-all; }
        .vid-caption { font-size: 11.5px; color: var(--text-muted); margin-top: 2px; }
        .size-badge {
            background: rgba(56, 189, 248, 0.1);
            color: var(--accent);
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 11.5px;
            font-family: monospace;
        }
        .col-actions { display: flex; gap: 8px; justify-content: flex-end; }
        .btn-play {
            background: var(--accent);
            color: #040d1a;
            font-weight: 600;
            padding: 6px 14px;
            border-radius: 6px;
            text-decoration: none;
            font-size: 12px;
        }
        .btn-sub {
            background: var(--bg-subtle);
            border: 1px solid var(--border);
            color: var(--text-main);
            padding: 6px 12px;
            border-radius: 6px;
            text-decoration: none;
            font-size: 12px;
        }
        .btn-sub:hover { border-color: var(--accent); color: var(--accent); }
    </style>
</head>
<body>
    <div class="container">
        <div class="top-hero">
            <div class="logo-group">
                <h1>🎬 TeleBotAnime · Stream Gateway</h1>
                <p>Telegram MTProto High-Speed Video Storage & HTTP Streaming Server</p>
            </div>
            <div class="stat-badge">
                RAM Cache: ${cacheStats.totalMB || 0} MB / ${cacheStats.maxMB || 250} MB
            </div>
        </div>

        <div class="upload-card">
            <input type="file" id="videoUploader" class="file-input" accept="video/mp4,video/x-matroska,video/webm">
            <div class="upload-title">Drag & Drop Any Video File to Upload</div>
            <div class="upload-sub">Files are automatically pushed to Telegram Storage Channel and given instant stream links</div>
            <span class="upload-btn">Select Video (.mp4, .mkv, .webm)</span>
            <div id="progBar" class="progress-bar">
                <div id="progFill" class="progress-fill"></div>
            </div>
            <div id="uploadStatus" style="font-size: 12px; margin-top: 10px; color: #38bdf8;"></div>
        </div>

        <!-- ANIME MAPPING DATABASE CARD -->
        <div class="table-card" style="margin-bottom: 24px;">
            <div class="table-header">
                <span style="display: flex; align-items: center; gap: 8px;">
                    <span style="color: #38bdf8;">⛩</span> Anime Mapping Catalog (${animeCatalog.length} Episodes Mapped)
                </span>
                <span style="color: var(--text-muted); font-size: 12px;">AniList + MAL Unified Indexed</span>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Poster</th>
                        <th>Anime Title & IDs</th>
                        <th>Track</th>
                        <th>Size</th>
                        <th>TG Msg</th>
                        <th style="text-align: right;">Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${catalogRows.length ? catalogRows : '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">No anime episodes mapped yet. Ingest your first episode via GitHub Actions or Ingestion CLI!</td></tr>'}
                </tbody>
            </table>
        </div>

        <div class="table-card">
            <div class="table-header">
                <span>Stored Media Channel Files (${videos.length} Videos)</span>
                <span style="color: var(--text-muted); font-size: 12px;">Storage: @telehexaanibot</span>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Msg ID</th>
                        <th>Video Title & Caption</th>
                        <th>Size</th>
                        <th>Res</th>
                        <th>Added Date</th>
                        <th style="text-align: right;">Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${videoRows.length ? videoRows : '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No videos found in channel yet. Upload your first video above!</td></tr>'}
                </tbody>
            </table>
        </div>
    </div>

    <script>
        const input = document.getElementById('videoUploader');
        const progBar = document.getElementById('progBar');
        const progFill = document.getElementById('progFill');
        const status = document.getElementById('uploadStatus');

        input.addEventListener('change', () => {
            const file = input.files[0];
            if (!file) return;

            const form = new FormData();
            form.append('video', file);

            progBar.style.display = 'block';
            status.innerText = 'Uploading ' + file.name + ' (' + (file.size / (1024*1024)).toFixed(1) + ' MB)...';

            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/upload', true);

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const pct = Math.round((e.loaded / e.total) * 100);
                    progFill.style.width = pct + '%';
                    status.innerText = 'Uploading: ' + pct + '%...';
                }
            };

            xhr.onload = () => {
                if (xhr.status === 200) {
                    const res = JSON.parse(xhr.responseText);
                    status.innerHTML = '✅ Uploaded to Telegram! <a href="/player/' + res.messageId + '" style="color:#38bdf8;font-weight:bold;">Watch Now ▶</a>';
                    setTimeout(() => window.location.reload(), 2000);
                } else {
                    status.innerText = '❌ Upload failed: ' + xhr.responseText;
                }
            };

            xhr.onerror = () => {
                status.innerText = '❌ Network error during upload.';
            };

            xhr.send(form);
        });
    </script>
</body>
</html>`;
}
