const { getLink } = require('./_store');

module.exports = (req, res) => {
  let token = req.query.token;
  if (!token && req.url) {
    const parts = req.url.split('?')[0].split('/');
    token = parts[parts.length - 1];
  }

  const link = token ? getLink(token) : null;
  const now = Date.now();

  if (!link || now > link.expiresAt) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(404).send(`<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Titan Plus Share - Link Expired</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8faff; color: #1e293b; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 16px; }
        .card { background: #ffffff; border-radius: 24px; padding: 36px 28px; max-width: 420px; width: 100%; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.06); border: 1px solid #f1f5f9; }
        h2 { font-size: 20px; font-weight: 700; color: #e11d48; margin-top: 12px; }
        p { font-size: 13px; color: #64748b; line-height: 1.5; margin-top: 8px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div style="font-size: 48px;">⏳</div>
        <h2>Download Link Expired</h2>
        <p>This 3-hour transfer link has expired or the host laptop ended sharing. Please request a new link.</p>
      </div>
    </body>
    </html>`);
  }

  const fileSizeMb = (link.fileSize / (1024 * 1024)).toFixed(1);
  const remainingSeconds = Math.max(0, Math.floor((link.expiresAt - now) / 1000));
  const directDownload = link.directUrl || `http://${link.laptopIp}:${link.laptopPort}/api/links/download/${link.token}`;

  const isText = link.type === 'text' || !!link.textContent;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(`<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${isText ? 'Shared Text Note' : `Download ${link.fileName}`} - Titan Plus Share</title>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        background: #f8faff;
        color: #1e293b;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        margin: 0;
        padding: 20px;
      }
      .card {
        background: #ffffff;
        border-radius: 28px;
        padding: 40px 32px;
        max-width: 420px;
        width: 100%;
        text-align: center;
        box-shadow: 0 16px 40px rgba(37, 99, 235, 0.08);
        border: 1px solid #eef2f6;
      }
      .logo {
        width: 56px;
        height: 56px;
        border-radius: 16px;
        margin: 0 auto 12px;
        display: block;
        box-shadow: 0 4px 16px rgba(37, 99, 235, 0.25);
        object-fit: cover;
      }
      .brand {
        font-size: 13px;
        font-weight: 700;
        color: #2563eb;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        margin-bottom: 24px;
      }
      .file-icon {
        font-size: 52px;
        margin-bottom: 12px;
      }
      .filename {
        font-size: 18px;
        font-weight: 700;
        color: #0f172a;
        margin-bottom: 6px;
        word-break: break-word;
      }
      .filesize {
        font-size: 14px;
        color: #64748b;
        margin-bottom: 24px;
      }
      .text-box {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 16px;
        padding: 16px;
        font-family: monospace;
        font-size: 13px;
        color: #0f172a;
        text-align: left;
        max-height: 200px;
        overflow-y: auto;
        white-space: pre-wrap;
        margin-bottom: 20px;
        user-select: text;
      }
      .btn-download {
        display: block;
        width: 100%;
        box-sizing: border-box;
        background: #2563eb;
        color: #ffffff;
        text-decoration: none;
        padding: 15px 20px;
        font-size: 15px;
        font-weight: 600;
        border-radius: 18px;
        box-shadow: 0 8px 24px rgba(37, 99, 235, 0.35);
        transition: transform 0.2s, background 0.2s;
        cursor: pointer;
        border: none;
      }
      .btn-download:hover {
        background: #1d4ed8;
        transform: translateY(-2px);
      }
      .note {
        margin-top: 20px;
        font-size: 12px;
        color: #94a3b8;
        line-height: 1.5;
      }
      .timer {
        margin-top: 14px;
        font-size: 12px;
        font-weight: 600;
        color: #059669;
        background: #ecfdf5;
        padding: 6px 12px;
        border-radius: 20px;
        display: inline-block;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <img src="https://raw.githubusercontent.com/pushpendra-gora/Titan-Plus-Share/main/assets/logo.png" alt="Titan Plus Share" class="logo" />
      <div class="brand">Titan Plus Share</div>
      <div class="file-icon">${isText ? '📝' : '📦'}</div>
      <div class="filename">${isText ? 'Shared Text Note' : link.fileName}</div>
      <div class="filesize">${isText ? `${(link.textContent || '').length} characters` : (fileSizeMb > 0 ? fileSizeMb + ' MB' : link.fileSize + ' B')}</div>

      ${isText ? `
        <div class="text-box" id="noteContent">${link.textContent || ''}</div>
        <button class="btn-download" id="copyBtn" onclick="copyText()">Copy Text</button>
        <button class="btn-download" style="background:#475569;margin-top:10px;" onclick="downloadTxt()">Download as .txt file</button>
      ` : `
        <button class="btn-download" id="dlBtn" onclick="startDirectDownload()">Download File (${fileSizeMb > 0 ? fileSizeMb + ' MB' : link.fileSize + ' B'})</button>
        <div style="margin-top:14px;">
          <a id="directLink" href="${directDownload}" target="_blank" rel="noopener noreferrer" style="font-size:12px;color:#2563eb;text-decoration:underline;">
            Direct Host Laptop Link (Wi-Fi)
          </a>
        </div>
      `}

      <div class="timer" id="countdown">Valid for 3 hours</div>
      <div class="note">Transferred directly from host laptop without size limits.</div>
    </div>
    <script>
      function recordAck() {
        try { fetch('/api/links/ack?token=${link.token}&selfToken=${token}').catch(() => {}); } catch(e) {}
        try { fetch('http://${link.laptopIp}:${link.laptopPort}/api/links/ack?token=${link.token}', { method: 'POST', mode: 'no-cors' }).catch(() => {}); } catch(e) {}
      }

      function copyText() {
        const text = document.getElementById('noteContent').innerText;
        navigator.clipboard.writeText(text);
        recordAck();
        const btn = document.getElementById('copyBtn');
        btn.innerText = 'Copied to Clipboard! ✓';
        btn.style.background = '#059669';
        setTimeout(() => {
          btn.innerText = 'Copy Text';
          btn.style.background = '#2563eb';
        }, 2000);
      }

      function downloadTxt() {
        recordAck();
        const text = document.getElementById('noteContent').innerText;
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = '${(link.fileName || 'Shared_Text.txt').replace(/'/g, "\\'")}';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }

      function startDirectDownload() {
        recordAck();
        const btn = document.getElementById('dlBtn');
        btn.innerText = 'Starting Download...';
        btn.style.background = '#059669';

        // Trigger direct browser navigation to start download
        window.location.assign('${directDownload}');

        // Fallback after 1.5s if Chrome blocks mixed-content from HTTPS
        setTimeout(() => {
          btn.innerText = 'Opening Host Server...';
          window.location.href = 'http://${link.laptopIp}:${link.laptopPort}/d/${link.token}';
        }, 1500);
      }

      let remaining = ${remainingSeconds};
      function update() {
        if (remaining <= 0) {
          document.getElementById('countdown').innerText = 'Link expired';
          return;
        }
        const h = Math.floor(remaining / 3600);
        const m = Math.floor((remaining % 3600) / 60);
        const s = remaining % 60;
        document.getElementById('countdown').innerText = 'Expires in: ' + h + 'h ' + m + 'm ' + s + 's';
        remaining--;
      }
      setInterval(update, 1000);
      update();
    </script>
  </body>
  </html>`);
};

