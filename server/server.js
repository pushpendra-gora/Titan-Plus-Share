 const express = require('express');
const cors = require('cors');
const multer = require('multer');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { WebSocketServer } = require('ws');
const archiver = require('archiver');
const dgram = require('dgram');

const PORT = process.env.PORT || 51733;
const DISCOVERY_PORT = 41235;
const LINK_EXPIRY_MS = 3 * 60 * 60 * 1000; // 3 hours expiry
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PENDING_DIR = path.join(DATA_DIR, 'pending_pushes');
const LINKS_FILE = path.join(DATA_DIR, 'links.json');
const PAIRED_FILE = path.join(DATA_DIR, 'paired_devices.json');

[DATA_DIR, UPLOAD_DIR, PENDING_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

let pendingPushes = {};

function loadJson(file, def) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`Error reading ${file}:`, err);
  }
  return def;
}

function saveJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`Error writing ${file}:`, err);
  }
}

let sharedLinks = loadJson(LINKS_FILE, []);
let pairedDevices = loadJson(PAIRED_FILE, []);
let activeTransfers = {};

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses.length > 0 ? addresses : ['127.0.0.1'];
}

function cleanupExpiredLinks() {
  const now = Date.now();
  const remaining = [];
  for (const link of sharedLinks) {
    if (link.expiresAt && now > link.expiresAt) {
      if (link.filePath && fs.existsSync(link.filePath)) {
        try {
          fs.unlinkSync(link.filePath);
        } catch (e) { }
      }
    } else {
      remaining.push(link);
    }
  }
  if (remaining.length !== sharedLinks.length) {
    sharedLinks = remaining;
    saveJson(LINKS_FILE, sharedLinks);
  }
}
setInterval(cleanupExpiredLinks, 60 * 1000);

const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + crypto.randomBytes(4).toString('hex');
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${uniqueSuffix}-${safeName}`);
  }
});
const upload = multer({ storage });

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const wsClients = new Set();
const onlineClients = new Map(); // ws -> client info

wss.on('connection', (ws) => {
  wsClients.add(ws);

  ws.on('close', () => {
    wsClients.delete(ws);
    onlineClients.delete(ws);
    broadcastWs('online-peers-updated', Array.from(onlineClients.values()));
  });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      } else if (data.type === 'identify') {
        onlineClients.set(ws, {
          deviceId: data.deviceId,
          deviceName: data.deviceName,
          deviceType: data.deviceType,
          ip: ws._socket?.remoteAddress?.replace(/^.*:/, '') || 'LAN'
        });
        ws.deviceId = data.deviceId;
        broadcastWs('online-peers-updated', Array.from(onlineClients.values()));
      } else if (data.type === 'transfer-progress') {
        broadcastWs('peer-transfer-progress', data);
      }
    } catch (e) { }
  });
});

function broadcastWs(event, payload) {
  const msg = JSON.stringify({ event, payload });
  for (const client of wsClients) {
    if (client.readyState === 1) client.send(msg);
  }
}

app.get('/api/status', (req, res) => {
  res.json({
    appName: 'Titan Plus Share',
    status: 'online',
    isServer: true,
    hostname: os.hostname(),
    platform: process.platform,
    ips: getLocalIpAddresses(),
    port: PORT,
    activeLinksCount: sharedLinks.length,
    pairedDevicesCount: pairedDevices.length
  });
});

app.get('/api/pair/info', async (req, res) => {
  const serverIps = getLocalIpAddresses();
  const primaryIp = serverIps[0] || '127.0.0.1';
  const token = crypto.randomBytes(16).toString('hex');
  const payload = {
    appName: 'Titan Plus Share',
    type: 'laptop',
    name: os.hostname(),
    ip: primaryIp,
    ips: serverIps,
    port: PORT,
    token
  };
  const qrString = JSON.stringify(payload);
  const qrDataUrl = await QRCode.toDataURL(qrString, { margin: 1, width: 260 });
  res.json({
    payload,
    qrCode: qrDataUrl
  });
});

app.post('/api/pair/authenticate', (req, res) => {
  const { deviceId, deviceName, deviceType, ip } = req.body;
  if (!deviceId || !deviceName) {
    return res.status(400).json({ error: 'Device details missing' });
  }

  const existingIdx = pairedDevices.findIndex((d) => d.deviceId === deviceId);
  const deviceRecord = {
    deviceId,
    deviceName,
    deviceType: deviceType || 'mobile',
    ip: ip || req.ip.replace('::ffff:', ''),
    pairedAt: new Date().toISOString(),
    status: 'online'
  };

  if (existingIdx >= 0) {
    pairedDevices[existingIdx] = deviceRecord;
  } else {
    pairedDevices.push(deviceRecord);
  }
  saveJson(PAIRED_FILE, pairedDevices);
  broadcastWs('devices-updated', pairedDevices);

  res.json({ success: true, message: 'Device successfully paired', device: deviceRecord });
});

app.get('/api/pair/list', (req, res) => {
  res.json(pairedDevices);
});

app.delete('/api/pair/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  pairedDevices = pairedDevices.filter((d) => d.deviceId !== deviceId);
  saveJson(PAIRED_FILE, pairedDevices);
  broadcastWs('devices-updated', pairedDevices);
  res.json({ success: true });
});

function makeSelfContainedToken(linkEntry, token) {
  const primaryIp = getLocalIpAddresses()[0];
  const min = {
    i: token,
    n: linkEntry.fileName,
    s: linkEntry.fileSize,
    t: linkEntry.type,
    h: primaryIp,
    p: PORT,
    e: linkEntry.expiresAt
  };
  return Buffer.from(JSON.stringify(min)).toString('base64url');
}

async function registerWithVercel(linkEntry, token) {
  const vercelRelay = process.env.VERCEL_RELAY_URL || 'https://titan-plus-share.vercel.app';
  const primaryIp = getLocalIpAddresses()[0];
  const selfToken = makeSelfContainedToken(linkEntry, token);

  try {
    const payload = {
      token,
      selfToken,
      fileName: linkEntry.fileName,
      fileSize: linkEntry.fileSize,
      type: linkEntry.type,
      laptopIp: primaryIp,
      laptopPort: PORT,
      directUrl: `http://${primaryIp}:${PORT}/api/links/download/${token}`,
      expiresAt: linkEntry.expiresAt
    };
    const response = await fetch(`${vercelRelay}/api/links/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (response.ok) {
      const data = await response.json();
      if (data.httpsUrl) return data.httpsUrl;
    }
  } catch (err) { }
  return `http://${primaryIp}:${PORT}/d/${selfToken}`;
}

app.post('/api/links/create', upload.single('file'), async (req, res) => {
  try {
    const { type, textContent, originalName } = req.body;
    const token = crypto.randomBytes(6).toString('hex');
    const now = Date.now();
    const expiresAt = now + LINK_EXPIRY_MS;

    let linkEntry = {
      id: token,
      type: type || 'file',
      createdAt: now,
      expiresAt,
      downloadCount: 0
    };

    if (type === 'text') {
      linkEntry.fileName = 'Shared_Text.txt';
      linkEntry.textContent = textContent || '';
      linkEntry.fileSize = Buffer.byteLength(linkEntry.textContent, 'utf8');
    } else if (req.file) {
      linkEntry.fileName = originalName || req.file.originalname;
      linkEntry.fileSize = req.file.size;
      linkEntry.filePath = req.file.path;
      linkEntry.mimeType = req.file.mimetype;
    } else {
      return res.status(400).json({ error: 'No content provided' });
    }

    const primaryIp = getLocalIpAddresses()[0];
    const fullUrl = await registerWithVercel(linkEntry, token);
    const localUrl = `http://${primaryIp}:${PORT}/d/${token}`;
    const qrDataUrl = await QRCode.toDataURL(fullUrl, { margin: 1, width: 220 });

    linkEntry.url = fullUrl;
    linkEntry.localUrl = localUrl;
    linkEntry.qrCode = qrDataUrl;
    linkEntry.status = 'pending';
    linkEntry.downloadProgress = 0;

    sharedLinks.push(linkEntry);
    saveJson(LINKS_FILE, sharedLinks);
    broadcastWs('links-updated', sharedLinks);

    res.json({
      success: true,
      token,
      url: fullUrl,
      localUrl,
      qrCode: qrDataUrl,
      fileName: linkEntry.fileName,
      fileSize: linkEntry.fileSize,
      expiresAt: linkEntry.expiresAt,
      expiresInHours: 3
    });
  } catch (err) {
    console.error('Link creation error:', err);
    res.status(500).json({ error: 'Failed to generate link' });
  }
});

app.post('/api/links/create-folder', upload.array('files'), async (req, res) => {
  try {
    const folderName = req.body.folderName || 'Archive';
    const token = crypto.randomBytes(6).toString('hex');
    const zipPath = path.join(UPLOAD_DIR, `${Date.now()}-${folderName}.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.pipe(output);

    const relativePaths = JSON.parse(req.body.relativePaths || '[]');
    req.files.forEach((file, idx) => {
      const rel = relativePaths[idx] || file.originalname;
      archive.file(file.path, { name: rel });
    });

    await archive.finalize();

    output.on('close', async () => {
      // Remove raw parts
      req.files.forEach((f) => {
        try { fs.unlinkSync(f.path); } catch (e) { }
      });

      const now = Date.now();
      const stats = fs.statSync(zipPath);
      const linkEntry = {
        id: token,
        type: 'folder',
        fileName: `${folderName}.zip`,
        filePath: zipPath,
        fileSize: stats.size,
        mimeType: 'application/zip',
        createdAt: now,
        expiresAt: now + LINK_EXPIRY_MS,
        downloadCount: 0
      };

      const primaryIp = getLocalIpAddresses()[0];
      const fullUrl = await registerWithVercel(linkEntry, token);
      const localUrl = `http://${primaryIp}:${PORT}/d/${token}`;
      const qrDataUrl = await QRCode.toDataURL(fullUrl, { margin: 1, width: 220 });

      linkEntry.url = fullUrl;
      linkEntry.localUrl = localUrl;
      linkEntry.qrCode = qrDataUrl;
      linkEntry.status = 'pending';
      linkEntry.downloadProgress = 0;

      sharedLinks.push(linkEntry);
      saveJson(LINKS_FILE, sharedLinks);
      broadcastWs('links-updated', sharedLinks);

      res.json({
        success: true,
        token,
        url: fullUrl,
        localUrl,
        qrCode: qrDataUrl,
        fileName: linkEntry.fileName,
        fileSize: linkEntry.fileSize,
        expiresAt: linkEntry.expiresAt,
        expiresInHours: 3
      });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function findLink(token) {
  let link = sharedLinks.find((l) => l.id === token);
  if (!link) {
    try {
      const raw = Buffer.from(token, 'base64url').toString('utf8');
      const p = JSON.parse(raw);
      if (p && p.i) {
        link = sharedLinks.find((l) => l.id === p.i);
      }
    } catch (e) { }
  }
  return link;
}

app.get('/api/links/info/:token', (req, res) => {
  const { token } = req.params;
  const link = findLink(token);
  if (!link) return res.status(404).json({ error: 'Link not found' });

  const isExpired = Date.now() > link.expiresAt;
  const remainingSeconds = Math.max(0, Math.floor((link.expiresAt - Date.now()) / 1000));

  res.json({
    token: link.id,
    type: link.type,
    fileName: link.fileName,
    fileSize: link.fileSize,
    isExpired,
    remainingSeconds,
    expiresAt: link.expiresAt
  });
});

app.get('/api/links/list', (req, res) => {
  const now = Date.now();
  const primaryIp = getLocalIpAddresses()[0];
  const list = sharedLinks.map((l) => ({
    id: l.id,
    fileName: l.fileName,
    fileSize: l.fileSize,
    type: l.type,
    createdAt: l.createdAt,
    expiresAt: l.expiresAt,
    downloadCount: l.downloadCount || 0,
    status: now > l.expiresAt ? 'expired' : (l.status || (l.downloadCount > 0 ? 'downloaded' : 'pending')),
    downloadProgress: l.downloadProgress || (l.downloadCount > 0 ? 100 : 0),
    lastDownloadedAt: l.lastDownloadedAt || null,
    remainingSeconds: Math.max(0, Math.floor((l.expiresAt - now) / 1000)),
    isExpired: now > l.expiresAt,
    url: l.url || `https://titan-plus-share.vercel.app/d/${l.id}`,
    localUrl: l.localUrl || `http://${primaryIp}:${PORT}/d/${l.id}`,
    directUrl: `http://${primaryIp}:${PORT}/api/links/download/${l.id}`,
    qrCode: l.qrCode || null
  }));
  res.json(list);
});

app.delete('/api/links/:token', (req, res) => {
  const { token } = req.params;
  const idx = sharedLinks.findIndex((l) => l.id === token);
  if (idx >= 0) {
    const link = sharedLinks[idx];
    if (link.filePath && link.filePath.includes('uploads') && fs.existsSync(link.filePath)) {
      try { fs.unlinkSync(link.filePath); } catch (e) {}
    }
    sharedLinks.splice(idx, 1);
    saveJson(LINKS_FILE, sharedLinks);
    broadcastWs('links-updated', sharedLinks);
  }
  res.json({ success: true });
});

app.get('/api/links/download/:token', (req, res) => {
  const { token } = req.params;
  const link = findLink(token);
  if (!link) return res.status(404).send('Link not found');
  if (Date.now() > link.expiresAt) return res.status(410).send('Link has expired (3 hour limit reached)');

  if (link.type === 'text') {
    link.downloadCount = (link.downloadCount || 0) + 1;
    link.status = 'downloaded';
    link.downloadProgress = 100;
    link.lastDownloadedAt = Date.now();
    saveJson(LINKS_FILE, sharedLinks);

    broadcastWs('link-download-completed', {
      token: link.id,
      fileName: link.fileName,
      downloadedAt: link.lastDownloadedAt
    });
    broadcastWs('links-updated', sharedLinks);

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(link.fileName)}"`);
    return res.send(link.textContent);
  }

  if (!link.filePath || !fs.existsSync(link.filePath)) {
    return res.status(404).send('File missing on host');
  }

  const stat = fs.statSync(link.filePath);
  const totalBytes = stat.size || link.fileSize || 1;
  let bytesSent = 0;

  link.status = 'downloading';
  link.downloadProgress = 0;
  broadcastWs('link-download-progress', {
    token: link.id,
    fileName: link.fileName,
    bytesSent: 0,
    totalBytes,
    percent: 0
  });

  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(link.fileName)}"`);
  res.setHeader('Content-Type', link.mimeType || 'application/octet-stream');
  res.setHeader('Content-Length', totalBytes);

  const stream = fs.createReadStream(link.filePath);
  let lastProgressReport = 0;

  stream.on('data', (chunk) => {
    bytesSent += chunk.length;
    const now = Date.now();
    if (now - lastProgressReport > 200 || bytesSent === totalBytes) {
      lastProgressReport = now;
      const percent = Math.min(100, Math.round((bytesSent / totalBytes) * 100));
      link.downloadProgress = percent;
      broadcastWs('link-download-progress', {
        token: link.id,
        fileName: link.fileName,
        bytesSent,
        totalBytes,
        percent
      });
    }
  });

  stream.pipe(res);

  res.on('finish', () => {
    link.status = 'downloaded';
    link.downloadProgress = 100;
    link.downloadCount = (link.downloadCount || 0) + 1;
    link.lastDownloadedAt = Date.now();
    saveJson(LINKS_FILE, sharedLinks);

    broadcastWs('link-download-completed', {
      token: link.id,
      fileName: link.fileName,
      downloadedAt: link.lastDownloadedAt
    });
    broadcastWs('links-updated', sharedLinks);
  });
});

// Web download page
app.get('/d/:token', (req, res) => {
  const { token } = req.params;
  const link = findLink(token);
  if (!link) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><title>Not Found - Titan Plus Share</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8f9fe;color:#1e1e2f;text-align:center}</style>
      </head>
      <body>
        <div style="background:#fff;padding:40px;border-radius:24px;box-shadow:0 10px 30px rgba(0,0,0,0.06);max-width:380px">
          <h2 style="color:#2563eb">Link Expired or Not Found</h2>
          <p style="color:#64748b;font-size:14px;margin-top:10px;">This link has expired (links expire after 3 hours) or does not exist.</p>
        </div>
      </body>
      </html>
    `);
  }

  const remainingSeconds = Math.max(0, Math.floor((link.expiresAt - Date.now()) / 1000));
  const fileSizeMb = (link.fileSize / (1024 * 1024)).toFixed(2);

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>${link.fileName} - Titan Plus Share</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          background: #f8f9fe;
          color: #1e1e2f;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .card {
          background: #ffffff;
          border-radius: 24px;
          padding: 32px 28px;
          max-width: 440px;
          width: 100%;
          box-shadow: 0 16px 40px rgba(108, 92, 231, 0.08);
          border: 1px solid rgba(220, 224, 240, 0.7);
          text-align: center;
        }
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: #eff6ff;
          color: #2563eb;
          font-size: 13px;
          font-weight: 600;
          padding: 6px 14px;
          border-radius: 20px;
          margin-bottom: 20px;
        }
        .file-icon {
          width: 72px;
          height: 72px;
          background: #eff6ff;
          color: #2563eb;
          border-radius: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 18px;
          font-size: 28px;
          font-weight: bold;
        }
        .filename {
          font-size: 19px;
          font-weight: 700;
          word-break: break-all;
          margin-bottom: 8px;
        }
        .filesize {
          font-size: 14px;
          color: #64748b;
          margin-bottom: 24px;
        }
        .btn-download {
          display: block;
          width: 100%;
          background: #2563eb;
          color: #ffffff;
          text-decoration: none;
          padding: 14px 20px;
          font-size: 16px;
          font-weight: 600;
          border-radius: 16px;
          box-shadow: 0 8px 24px rgba(37, 99, 235, 0.35);
          transition: transform 0.2s, background 0.2s;
        }
        .btn-download:hover {
          background: #1d4ed8;
          transform: translateY(-2px);
        }
        .timer {
          margin-top: 18px;
          font-size: 13px;
          color: #a0aec0;
        }
      </style>
    </head>
    <body>
      <div class="card">
        <img src="/logo.png" alt="Titan Plus Share" style="width:52px;height:52px;border-radius:14px;margin:0 auto 12px;display:block;box-shadow:0 4px 16px rgba(37,99,235,0.25);object-fit:cover;" />
        <div class="badge">Titan Plus Share</div>
        <div class="file-icon">📥</div>
        <div class="filename">${link.fileName}</div>
        <div class="filesize">${fileSizeMb > 0 ? fileSizeMb + ' MB' : link.fileSize + ' B'}</div>
        <a class="btn-download" href="/api/links/download/${link.id}">Download File</a>
        <div class="timer" id="countdown">Valid for 3 hours</div>
      </div>
      <script>
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
        update();
        setInterval(update, 1000);
      </script>
    </body>
    </html>
  `);
});

let customSavePath = path.join(os.homedir(), 'Downloads', 'TitanPlusShare');
if (!fs.existsSync(customSavePath)) {
  try { fs.mkdirSync(customSavePath, { recursive: true }); } catch (e) { }
}

app.post('/api/settings/save-path', (req, res) => {
  const { savePath } = req.body;
  if (savePath && typeof savePath === 'string') {
    customSavePath = savePath;
    if (!fs.existsSync(customSavePath)) {
      try { fs.mkdirSync(customSavePath, { recursive: true }); } catch (e) { }
    }
  }
  res.json({ success: true, savePath: customSavePath });
});

app.get('/api/settings/save-path', (req, res) => {
  res.json({ savePath: customSavePath });
});

// Direct LAN transfer endpoint
app.post('/api/transfer/send', upload.single('file'), (req, res) => {
  const { senderId, senderName, originalName, transferType, textContent } = req.body;

  if (transferType === 'text' || textContent) {
    broadcastWs('incoming-transfer', {
      senderId,
      senderName,
      transferType: 'text',
      textContent: textContent || '',
      fileName: 'Text Message',
      fileSize: Buffer.byteLength(textContent || '', 'utf8'),
      receivedAt: Date.now()
    });
    return res.json({ success: true, message: 'Text note received successfully' });
  }

  if (!req.file) return res.status(400).json({ error: 'No file received' });

  // If custom save path configured, copy file there
  let finalDestination = req.file.path;
  try {
    if (fs.existsSync(customSavePath)) {
      const targetName = path.join(customSavePath, originalName || req.file.originalname);
      fs.copyFileSync(req.file.path, targetName);
      finalDestination = targetName;
    }
  } catch (e) {
    console.error('Could not copy to custom save path:', e);
  }

  broadcastWs('incoming-transfer', {
    senderId,
    senderName,
    fileName: originalName || req.file.originalname,
    fileSize: req.file.size,
    filePath: finalDestination,
    receivedAt: Date.now()
  });

  res.json({ success: true, message: 'Transfer received successfully', savedTo: finalDestination });
});

// Laptop Pushes to Mobile Device (Staged direct LAN transfer)
app.post('/api/transfer/push', upload.single('file'), (req, res) => {
  const { targetDeviceId, senderName, originalName, transferType, textContent, filePath: bodyFilePath } = req.body;

  if (transferType === 'text' || textContent) {
    const transferId = crypto.randomBytes(8).toString('hex');
    pendingPushes[transferId] = {
      transferId,
      targetDeviceId,
      senderName: senderName || 'Laptop',
      transferType: 'text',
      textContent: textContent || '',
      fileName: 'Text Message',
      fileSize: Buffer.byteLength(textContent || '', 'utf8'),
      status: 'staged',
      createdAt: Date.now()
    };

    broadcastWs('incoming-file-push', {
      transferId,
      targetDeviceId,
      senderName: senderName || 'Laptop',
      transferType: 'text',
      textContent: textContent || '',
      fileName: 'Text Message',
      fileSize: Buffer.byteLength(textContent || '', 'utf8')
    });
    return res.json({ success: true, transferId, message: 'Text staged for mobile' });
  }

  let finalFilePath = null;
  let finalFileSize = 0;
  let finalFileName = originalName;

  if (req.file) {
    finalFilePath = req.file.path;
    finalFileSize = req.file.size;
    finalFileName = originalName || req.file.originalname;
  } else if (bodyFilePath && fs.existsSync(bodyFilePath)) {
    finalFilePath = bodyFilePath;
    const stat = fs.statSync(bodyFilePath);
    finalFileSize = stat.size;
    finalFileName = originalName || path.basename(bodyFilePath);
  }

  if (!finalFilePath) {
    return res.status(400).json({ error: 'No file uploaded or found on server' });
  }

  const transferId = crypto.randomBytes(8).toString('hex');
  const primaryIp = getLocalIpAddresses()[0];

  pendingPushes[transferId] = {
    transferId,
    targetDeviceId,
    senderName: senderName || 'Laptop',
    fileName: finalFileName,
    fileSize: finalFileSize,
    filePath: finalFilePath,
    transferType: 'file',
    status: 'staged',
    createdAt: Date.now()
  };

  broadcastWs('incoming-file-push', {
    transferId,
    targetDeviceId,
    senderName: senderName || 'Laptop',
    fileName: finalFileName,
    fileSize: finalFileSize,
    downloadUrl: `http://${primaryIp}:${PORT}/api/transfer/pull/${transferId}`
  });

  res.json({
    success: true,
    transferId,
    fileName: finalFileName,
    fileSize: finalFileSize
  });
});

// Mobile Pulls/Streams the pushed file from Laptop Server
app.get('/api/transfer/pull/:id', (req, res) => {
  const { id } = req.params;
  const push = pendingPushes[id];
  if (!push || !fs.existsSync(push.filePath)) {
    return res.status(404).send('Transfer expired or file not found');
  }

  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(push.fileName)}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', push.fileSize);

  const stream = fs.createReadStream(push.filePath);
  stream.pipe(res);

  res.on('finish', () => {
    push.status = 'completed';
    push.completedAt = Date.now();
    broadcastWs('transfer-completed', { transferId: id, success: true });
    // Clean up temporary uploads after 60 seconds (only if in uploads dir)
    setTimeout(() => {
      try {
        if (push.filePath.includes('uploads') && fs.existsSync(push.filePath)) {
          fs.unlinkSync(push.filePath);
        }
      } catch (e) { }
    }, 60000);
  });
});

// Transfer Acknowledgment
app.post('/api/transfer/ack', (req, res) => {
  const { transferId, success } = req.body;
  if (transferId && pendingPushes[transferId]) {
    pendingPushes[transferId].status = 'completed';
    pendingPushes[transferId].completedAt = Date.now();
  }
  broadcastWs('transfer-completed', { transferId, success: !!success });
  res.json({ success: true });
});

// Check status of a transfer (used by laptop to know when mobile finished)
app.get('/api/transfer/status/:id', (req, res) => {
  const { id } = req.params;
  const push = pendingPushes[id];
  if (!push) {
    return res.json({ transferId: id, status: 'completed', completed: true });
  }
  res.json({
    transferId: id,
    status: push.status || 'staged',
    completed: push.status === 'completed'
  });
});

// Mobile checks for pending pushes (e.g., when mobile app was closed when laptop sent)
app.get('/api/transfer/pending', (req, res) => {
  const { deviceId } = req.query;
  const primaryIp = getLocalIpAddresses()[0];
  const list = Object.values(pendingPushes)
    .filter((p) => p.status === 'staged' && (!p.targetDeviceId || !deviceId || p.targetDeviceId === deviceId))
    .map((p) => ({
      transferId: p.transferId,
      targetDeviceId: p.targetDeviceId,
      senderName: p.senderName,
      fileName: p.fileName,
      fileSize: p.fileSize,
      transferType: p.transferType || 'file',
      textContent: p.textContent || '',
      downloadUrl: `http://${primaryIp}:${PORT}/api/transfer/pull/${p.transferId}`
    }));
  res.json(list);
});

// UDP LAN Discovery
function startDiscovery() {
  try {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    socket.bind(DISCOVERY_PORT, () => {
      socket.setBroadcast(true);
    });

    socket.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.titanBeacon && data.name !== os.hostname()) {
          broadcastWs('peer-discovered', {
            ...data,
            ip: rinfo.address
          });
        }
      } catch (e) { }
    });

    setInterval(() => {
      const beacon = JSON.stringify({
        titanBeacon: true,
        name: os.hostname(),
        type: 'laptop',
        port: PORT
      });
      socket.send(beacon, 0, beacon.length, DISCOVERY_PORT, '255.255.255.255', () => { });
    }, 4000);
  } catch (err) {
    console.warn('UDP Discovery warning:', err.message);
  }
}

let pendingSharedItem = null;

app.post('/api/cli/share', (req, res) => {
  const { filePath } = req.body;
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(400).json({ error: 'File path invalid' });
  }

  const stat = fs.statSync(filePath);
  const isDir = stat.isDirectory();
  const fileName = path.basename(filePath);

  pendingSharedItem = {
    type: isDir ? 'folder' : 'file',
    name: fileName,
    size: stat.size,
    path: filePath,
    timestamp: Date.now()
  };

  broadcastWs('external-file-shared', pendingSharedItem);
  res.json({ success: true, item: pendingSharedItem });
});

app.get('/api/cli/pending-share', (req, res) => {
  const item = pendingSharedItem;
  pendingSharedItem = null; // consume once
  res.json({ item });
});

// Serve built frontend if exists
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/d/')) return next();
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Titan Plus Share Server running on port ${PORT}`);
  console.log(`Local Access: http://localhost:${PORT}`);
  getLocalIpAddresses().forEach((ip) => {
    console.log(`Network Access: http://${ip}:${PORT}`);
  });
  startDiscovery();
});
