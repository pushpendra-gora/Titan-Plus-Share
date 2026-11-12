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
  const wifiList = [];
  const otherList = [];

  for (const name of Object.keys(interfaces)) {
    const isWifiOrHotspot = /wi-fi|wlan|wireless|hotspot/i.test(name);
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal && net.address !== '127.0.0.1') {
        // Skip virtual or apipa addresses if possible
        if (net.address.startsWith('169.254.')) continue;
        if (isWifiOrHotspot) {
          wifiList.push(net.address);
        } else {
          otherList.push(net.address);
        }
      }
    }
  }

  const combined = [...wifiList, ...otherList];
  return combined.length > 0 ? combined : ['127.0.0.1'];
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sanitizeFileName(name) {
  if (!name) return 'file_' + Date.now();
  const base = path.basename(name);
  return base.replace(/[^\w\.\-\s]/g, '_').substring(0, 220) || 'file.dat';
}

function isLocalRequest(req) {
  const ip = req.ip || req.connection?.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip.endsWith('127.0.0.1');
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

  // Prune stale pending pushes older than 1 hour
  for (const [id, push] of Object.entries(pendingPushes)) {
    if (now - (push.createdAt || 0) > 3600000) {
      if (push.filePath && push.filePath.includes('uploads') && fs.existsSync(push.filePath)) {
        try { fs.unlinkSync(push.filePath); } catch (e) {}
      }
      delete pendingPushes[id];
    }
  }

  // Prune orphaned upload files older than 4 hours
  try {
    const files = fs.readdirSync(UPLOAD_DIR);
    for (const f of files) {
      const fullPath = path.join(UPLOAD_DIR, f);
      try {
        const stats = fs.statSync(fullPath);
        if (now - stats.mtimeMs > 4 * 3600 * 1000) {
          const isReferenced = sharedLinks.some(l => l.filePath === fullPath) || 
                               Object.values(pendingPushes).some(p => p.filePath === fullPath);
          if (!isReferenced) {
            fs.unlinkSync(fullPath);
          }
        }
      } catch (e) {}
    }
  } catch (e) {}
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
        const clientIp = ws._socket?.remoteAddress?.replace(/^.*:/, '') || 'LAN';
        onlineClients.set(ws, {
          deviceId: data.deviceId,
          deviceName: data.deviceName,
          deviceType: data.deviceType,
          ip: clientIp
        });
        ws.deviceId = data.deviceId;

        // Auto-update pairedDevices list with fresh deviceId (avoids stale ID mismatch)
        let changed = false;
        pairedDevices = pairedDevices.map((d) => {
          const matchIp = clientIp !== 'LAN' && d.ip === clientIp;
          const matchName = d.deviceName === data.deviceName;
          const matchId = d.deviceId === data.deviceId;
          if (matchIp || matchName || matchId) {
            changed = true;
            return {
              ...d,
              deviceId: data.deviceId,
              deviceName: data.deviceName || d.deviceName,
              deviceType: data.deviceType || d.deviceType,
              ip: clientIp !== 'LAN' ? clientIp : d.ip,
              status: 'online',
              lastSeen: Date.now()
            };
          }
          return d;
        });

        // Deduplicate paired devices
        const seen = new Set();
        pairedDevices = pairedDevices.filter((d) => {
          const key = (d.ip && d.ip !== 'LAN') ? d.ip : d.deviceId;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        if (changed) {
          saveJson(PAIRED_FILE, pairedDevices);
          broadcastWs('devices-updated', pairedDevices);
        }

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

  const clientIp = ip || req.ip.replace('::ffff:', '');
  const existingIdx = pairedDevices.findIndex((d) => 
    d.deviceId === deviceId || (clientIp && clientIp !== '127.0.0.1' && d.ip === clientIp) || d.deviceName === deviceName
  );
  const deviceRecord = {
    deviceId,
    deviceName,
    deviceType: deviceType || 'mobile',
    ip: clientIp,
    pairedAt: new Date().toISOString(),
    status: 'online'
  };

  if (existingIdx >= 0) {
    pairedDevices[existingIdx] = deviceRecord;
  } else {
    pairedDevices.push(deviceRecord);
  }

  // Deduplicate
  const seen = new Set();
  pairedDevices = pairedDevices.filter((d) => {
    const key = (d.ip && d.ip !== 'LAN' && d.ip !== '127.0.0.1') ? d.ip : d.deviceId;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  saveJson(PAIRED_FILE, pairedDevices);
  broadcastWs('devices-updated', pairedDevices);

  res.json({ success: true, message: 'Device successfully paired', device: deviceRecord });
});

app.get('/api/pair/list', (req, res) => {
  res.json(pairedDevices);
});

// Live Network Device Discovery: ONLY returns devices currently reachable on this exact Wi-Fi network
app.get('/api/peers/online', (req, res) => {
  const { myDeviceId } = req.query;
  const list = [];
  const seenIds = new Set();
  const seenIps = new Set();

  const currentIps = getLocalIpAddresses();
  const currentSubnets = currentIps.map(ip => ip.split('.').slice(0, 3).join('.'));

  // 1. Devices with an active WebSocket connection right now (App is open and ready)
  for (const client of onlineClients.values()) {
    if (client.deviceId && client.deviceId !== myDeviceId) {
      list.push({
        deviceId: client.deviceId,
        deviceName: client.deviceName || 'Device',
        deviceType: client.deviceType || 'mobile',
        ip: client.ip && client.ip !== 'LAN' ? client.ip : (currentIps[0] || 'LAN'),
        status: 'online',
        isReady: true,
        lastSeen: client.lastSeen || Date.now()
      });
      seenIds.add(client.deviceId);
      if (client.ip && client.ip !== 'LAN') seenIps.add(client.ip);
    }
  }

  // 2. Devices that were paired on THIS SAME Wi-Fi subnet (On Wi-Fi in background)
  for (const dev of pairedDevices) {
    if (dev.deviceId === myDeviceId || seenIds.has(dev.deviceId)) continue;
    if (dev.ip && seenIps.has(dev.ip)) continue;

    const devSubnet = dev.ip ? dev.ip.split('.').slice(0, 3).join('.') : '';
    const isSameSubnet = devSubnet && currentSubnets.includes(devSubnet);

    // Only include if on the same local subnet
    if (isSameSubnet) {
      list.push({
        deviceId: dev.deviceId,
        deviceName: dev.deviceName || 'Device',
        deviceType: dev.deviceType || 'mobile',
        ip: dev.ip,
        status: 'standby', // on Wi-Fi, background notification will wake it up
        isReady: false,
        lastSeen: dev.pairedAt || Date.now()
      });
      seenIds.add(dev.deviceId);
    }
  }

  res.json(list);
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
    c: linkEntry.textContent || '',
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
      textContent: linkEntry.textContent || '',
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
    const { type, textContent, originalName, creatorDeviceId, creatorDeviceName } = req.body;
    const token = crypto.randomBytes(6).toString('hex');
    const now = Date.now();
    const expiresAt = now + LINK_EXPIRY_MS;

    let linkEntry = {
      id: token,
      type: type || 'file',
      creatorDeviceId: creatorDeviceId || '',
      creatorDeviceName: creatorDeviceName || 'Device',
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
    const { folderName = 'Archive', creatorDeviceId, creatorDeviceName } = req.body;
    const safeFolderName = sanitizeFileName(folderName);
    const token = crypto.randomBytes(6).toString('hex');
    const zipPath = path.join(UPLOAD_DIR, `${Date.now()}-${safeFolderName}.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    await new Promise((resolve, reject) => {
      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);
      archive.pipe(output);

      let relativePaths = [];
      try {
        relativePaths = JSON.parse(req.body.relativePaths || '[]');
      } catch (e) {}

      if (req.files && req.files.length > 0) {
        req.files.forEach((file, idx) => {
          let rel = relativePaths[idx] || file.originalname;
          // Zip slip protection: strip leading separators and parent path traversal
          rel = rel.replace(/^(\.\.[\/\\])+/, '').replace(/^[\\\/]+/, '');
          archive.file(file.path, { name: rel });
        });
      }

      archive.finalize();
    });

    // Remove raw parts
    if (req.files) {
      req.files.forEach((f) => {
        try { fs.unlinkSync(f.path); } catch (e) { }
      });
    }

    const now = Date.now();
    const stats = fs.statSync(zipPath);
    const linkEntry = {
      id: token,
      type: 'folder',
      creatorDeviceId: creatorDeviceId || '',
      creatorDeviceName: creatorDeviceName || 'Device',
      fileName: `${safeFolderName}.zip`,
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
  } catch (err) {
    if (req.files) {
      req.files.forEach((f) => {
        try { fs.unlinkSync(f.path); } catch (e) { }
      });
    }
    res.status(500).json({ error: err.message || 'Failed to package folder' });
  }
});

function findLink(rawToken) {
  if (!rawToken) return null;
  let token = rawToken.toString().trim();
  if (token.includes('/d/')) token = token.split('/d/')[1].split('/')[0].split('?')[0];
  if (token.includes('/download/')) token = token.split('/download/')[1].split('/')[0].split('?')[0];
  if (token.includes('/')) token = token.split('/').pop().split('?')[0];

  let link = sharedLinks.find((l) => l.id === token);
  if (!link) {
    try {
      let b64 = token.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const raw = Buffer.from(b64, 'base64').toString('utf8');
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
    textContent: link.textContent || null,
    creatorDeviceId: link.creatorDeviceId || '',
    isExpired,
    remainingSeconds,
    expiresAt: link.expiresAt
  });
});

app.get('/api/links/list', async (req, res) => {
  const { creatorDeviceId } = req.query;
  const now = Date.now();
  const primaryIp = getLocalIpAddresses()[0];
  const vercelRelay = process.env.VERCEL_RELAY_URL || 'https://titan-plus-share.vercel.app';

  // Sync download status from Vercel for any active pending links
  for (const l of sharedLinks) {
    if (now <= l.expiresAt && (!l.downloadCount || l.status !== 'downloaded')) {
      try {
        const selfToken = makeSelfContainedToken(l, l.id);
        const vRes = await fetch(`${vercelRelay}/api/links/info?token=${selfToken}&id=${l.id}`, { signal: AbortSignal.timeout(1500) });
        if (vRes.ok) {
          const vData = await vRes.json();
          if (vData.downloadCount > 0) {
            l.downloadCount = vData.downloadCount;
            l.status = 'downloaded';
            l.downloadProgress = 100;
            l.lastDownloadedAt = Date.now();
            saveJson(LINKS_FILE, sharedLinks);
            broadcastWs('link-download-completed', { token: l.id, fileName: l.fileName, downloadedAt: l.lastDownloadedAt });
          }
        }
      } catch (e) {}
    }
  }

  // ONLY return links created by the requesting device
  let filtered = [];
  if (creatorDeviceId) {
    filtered = sharedLinks.filter((l) => l.creatorDeviceId === creatorDeviceId);
  } else {
    filtered = sharedLinks;
  }

  const list = filtered.map((l) => ({
    id: l.id,
    fileName: l.fileName,
    fileSize: l.fileSize,
    type: l.type,
    textContent: l.textContent || null,
    creatorDeviceId: l.creatorDeviceId || '',
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

// Acknowledge a link download or viewing
app.all('/api/links/ack', (req, res) => {
  const token = req.query.token || req.body?.token;
  if (!token) return res.status(400).json({ error: 'Token is required' });

  const link = findLink(token);
  if (link) {
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
    return res.json({ success: true, downloadCount: link.downloadCount });
  }

  res.json({ success: true, message: 'Acknowledged' });
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

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    const safeTextName = (link.fileName || 'Shared_Note.txt').replace(/[^\w\.\-\s]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${safeTextName}"; filename*=UTF-8''${encodeURIComponent(link.fileName || 'Shared_Note.txt')}`);
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

  const safeFileName = sanitizeFileName(link.fileName);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"; filename*=UTF-8''${encodeURIComponent(link.fileName)}`);
  res.setHeader('Content-Type', link.mimeType || 'application/octet-stream');
  res.setHeader('Content-Length', totalBytes);

  const stream = fs.createReadStream(link.filePath);
  let lastProgressReport = 0;

  stream.on('error', (err) => {
    console.error('Download stream error:', err);
    if (!res.headersSent) res.status(500).send('Stream error');
  });

  req.on('close', () => {
    stream.destroy();
  });

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
  const safeTitle = escapeHtml(link.fileName);
  const safeDisplayName = link.type === 'text' ? 'Shared Text Note' : escapeHtml(link.fileName);
  const safeText = escapeHtml(link.textContent || '');
  const safeId = encodeURIComponent(link.id);

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>${safeTitle} - Titan Plus Share</title>
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
        <div class="file-icon">${link.type === 'text' ? '📝' : '📥'}</div>
        <div class="filename">${safeDisplayName}</div>
        <div class="filesize">${link.type === 'text' ? (link.textContent || '').length + ' characters' : (fileSizeMb > 0 ? fileSizeMb + ' MB' : link.fileSize + ' B')}</div>
        ${link.type === 'text' ? `
          <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:14px;padding:14px;font-family:monospace;font-size:13px;text-align:left;white-space:pre-wrap;max-height:180px;overflow-y:auto;margin-bottom:16px;user-select:text;" id="txtContent">${safeText}</div>
          <button class="btn-download" id="copyBtn" onclick="copyTextNote()" style="border:none;cursor:pointer;margin-bottom:10px;">Copy Text</button>
          <a href="/api/links/download/${safeId}" style="color:#64748b;font-size:12px;text-decoration:none;">Download as .txt file</a>
        ` : `
          <a class="btn-download" href="/api/links/download/${safeId}">Download File</a>
        `}
        <div class="timer" id="countdown">Valid for 3 hours</div>
      </div>
      <script>
        function copyTextNote() {
          const el = document.getElementById('txtContent');
          if (!el) return;
          navigator.clipboard.writeText(el.innerText).then(() => {
            const btn = document.getElementById('copyBtn');
            btn.innerText = 'Copied to Clipboard! ✓';
            btn.style.background = '#10b981';
            fetch('/api/links/download/${safeId}').catch(() => {});
            setTimeout(() => {
              btn.innerText = 'Copy Text';
              btn.style.background = '#2563eb';
            }, 3000);
          });
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
  if (!isLocalRequest(req)) {
    return res.status(403).json({ error: 'Save path configuration is restricted to local machine' });
  }
  const { savePath } = req.body;
  if (savePath && typeof savePath === 'string') {
    const resolved = path.resolve(savePath);
    if (resolved !== path.parse(resolved).root) {
      customSavePath = resolved;
      if (!fs.existsSync(customSavePath)) {
        try { fs.mkdirSync(customSavePath, { recursive: true }); } catch (e) { }
      }
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

  // Sanitize file name to prevent Path Traversal
  const safeName = sanitizeFileName(originalName || req.file.originalname);

  // If custom save path configured, copy file there
  let finalDestination = req.file.path;
  try {
    if (fs.existsSync(customSavePath)) {
      const targetName = path.join(customSavePath, safeName);
      fs.copyFileSync(req.file.path, targetName);
      finalDestination = targetName;
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
  } catch (e) {
    console.error('Could not copy to custom save path:', e);
  }

  broadcastWs('incoming-transfer', {
    senderId,
    senderName,
    fileName: safeName,
    fileSize: req.file.size,
    filePath: finalDestination,
    receivedAt: Date.now()
  });

  res.json({ success: true, message: 'Transfer received successfully', savedTo: finalDestination });
});

// Announce a transfer immediately BEFORE file bytes start uploading (Mobile alerted in 2ms)
app.post('/api/transfer/init-push', (req, res) => {
  const { targetDeviceId, senderName, fileName, fileSize, transferType, textContent } = req.body;
  const primaryIp = getLocalIpAddresses()[0];
  const targetDevice = pairedDevices.find(d => 
    d.deviceId === targetDeviceId || 
    (d.ip && targetDeviceId && (targetDeviceId.includes(d.ip) || d.deviceId === targetDeviceId))
  );

  const transferId = crypto.randomBytes(8).toString('hex');
  const isText = transferType === 'text' || !!textContent;

  pendingPushes[transferId] = {
    transferId,
    targetDeviceId,
    targetDeviceType: targetDevice?.deviceType || 'mobile',
    targetDeviceIp: targetDevice?.ip || '',
    senderName: senderName || 'Laptop',
    fileName: fileName || (isText ? 'Text Message' : 'File'),
    fileSize: fileSize || 0,
    transferType: isText ? 'text' : 'file',
    textContent: textContent || '',
    status: 'staged',
    serverUrl: `http://${primaryIp}:${PORT}`,
    downloadUrl: `http://${primaryIp}:${PORT}/api/transfer/pull/${transferId}`,
    createdAt: Date.now()
  };

  // Only broadcast immediately if it is text (since text data is already fully present in payload)
  if (isText) {
    broadcastWs('incoming-file-push', {
      transferId,
      targetDeviceId,
      targetDeviceType: targetDevice?.deviceType || 'mobile',
      targetDeviceIp: targetDevice?.ip || '',
      senderName: senderName || 'Laptop',
      fileName: 'Text Message',
      fileSize: fileSize || 0,
      transferType: 'text',
      textContent: textContent || '',
      serverUrl: `http://${primaryIp}:${PORT}`,
      downloadUrl: `http://${primaryIp}:${PORT}/api/transfer/pull/${transferId}`
    });
  }

  res.json({
    success: true,
    transferId,
    downloadUrl: `http://${primaryIp}:${PORT}/api/transfer/pull/${transferId}`
  });
});

// Laptop Pushes to Mobile Device (Staged direct LAN transfer)
app.post('/api/transfer/push', upload.single('file'), (req, res) => {
  const { targetDeviceId, senderName, originalName, transferType, textContent, filePath: bodyFilePath, transferId: existingId } = req.body;
  const primaryIp = getLocalIpAddresses()[0];
  const targetDevice = pairedDevices.find(d => 
    d.deviceId === targetDeviceId || 
    (d.ip && targetDeviceId && (targetDeviceId.includes(d.ip) || d.deviceId === targetDeviceId))
  );

  const transferId = existingId || crypto.randomBytes(8).toString('hex');

  if (transferType === 'text' || textContent) {
    const isAlreadyCompleted = pendingPushes[transferId]?.status === 'completed';
    pendingPushes[transferId] = {
      ...pendingPushes[transferId],
      transferId,
      targetDeviceId,
      targetDeviceType: targetDevice?.deviceType || 'mobile',
      targetDeviceIp: targetDevice?.ip || '',
      senderName: senderName || 'Laptop',
      transferType: 'text',
      textContent: textContent || '',
      fileName: 'Text Message',
      fileSize: Buffer.byteLength(textContent || '', 'utf8'),
      status: isAlreadyCompleted ? 'completed' : 'staged',
      serverUrl: `http://${primaryIp}:${PORT}`,
      downloadUrl: `http://${primaryIp}:${PORT}/api/transfer/pull/${transferId}`,
      createdAt: pendingPushes[transferId]?.createdAt || Date.now()
    };

    if (!isAlreadyCompleted) {
      broadcastWs('incoming-file-push', {
        transferId,
        targetDeviceId,
        targetDeviceType: targetDevice?.deviceType || 'mobile',
        targetDeviceIp: targetDevice?.ip || '',
        senderName: senderName || 'Laptop',
        transferType: 'text',
        textContent: textContent || '',
        fileName: 'Text Message',
        fileSize: Buffer.byteLength(textContent || '', 'utf8'),
        serverUrl: `http://${primaryIp}:${PORT}`,
        downloadUrl: `http://${primaryIp}:${PORT}/api/transfer/pull/${transferId}`
      });
    }
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
    if (!isLocalRequest(req)) {
      return res.status(403).json({ error: 'Direct file path access is restricted to localhost' });
    }
    finalFilePath = bodyFilePath;
    const stat = fs.statSync(bodyFilePath);
    finalFileSize = stat.size;
    finalFileName = sanitizeFileName(originalName || path.basename(bodyFilePath));
  }

  if (!finalFilePath) {
    return res.status(400).json({ error: 'No file uploaded or found on server' });
  }

  finalFileName = sanitizeFileName(finalFileName);

  pendingPushes[transferId] = {
    transferId,
    targetDeviceId,
    targetDeviceType: targetDevice?.deviceType || 'mobile',
    targetDeviceIp: targetDevice?.ip || '',
    senderName: senderName || 'Laptop',
    fileName: finalFileName,
    fileSize: finalFileSize,
    filePath: finalFilePath,
    transferType: 'file',
    status: 'staged',
    serverUrl: `http://${primaryIp}:${PORT}`,
    downloadUrl: `http://${primaryIp}:${PORT}/api/transfer/pull/${transferId}`,
    createdAt: Date.now()
  };

  // Broadcast to mobile NOW that the file is 100% staged and ready on disk
  broadcastWs('incoming-file-push', {
    transferId,
    targetDeviceId,
    targetDeviceType: targetDevice?.deviceType || 'mobile',
    targetDeviceIp: targetDevice?.ip || '',
    senderName: senderName || 'Laptop',
    fileName: finalFileName,
    fileSize: finalFileSize,
    serverUrl: `http://${primaryIp}:${PORT}`,
    downloadUrl: `http://${primaryIp}:${PORT}/api/transfer/pull/${transferId}`
  });

  res.json({
    success: true,
    transferId,
    fileName: finalFileName,
    fileSize: finalFileSize
  });
});

// Cancel a transfer and cleanup staged file
app.post('/api/transfer/cancel/:id', (req, res) => {
  const { id } = req.params;
  const push = pendingPushes[id];
  if (push) {
    if (push.filePath && push.filePath.includes('uploads') && fs.existsSync(push.filePath)) {
      try { fs.unlinkSync(push.filePath); } catch (e) {}
    }
    delete pendingPushes[id];
  }
  broadcastWs('transfer-cancelled', { transferId: id });
  res.json({ success: true });
});

// Mobile Pulls/Streams the pushed file from Laptop Server
app.get('/api/transfer/pull/:id', async (req, res) => {
  const { id } = req.params;
  const push = pendingPushes[id];
  if (!push) {
    return res.status(404).send('Transfer expired or not found');
  }

  // Gracefully wait up to 45s if file is being written to server over localhost
  let waited = 0;
  while ((!push.filePath || !fs.existsSync(push.filePath)) && waited < 45000) {
    await new Promise(r => setTimeout(r, 200));
    waited += 200;
  }

  if (!push.filePath || !fs.existsSync(push.filePath)) {
    return res.status(404).send('Transfer file not available');
  }

  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(push.fileName)}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', push.fileSize);

  const stream = fs.createReadStream(push.filePath, { highWaterMark: 128 * 1024 });
  stream.on('error', (err) => {
    console.error('Pull stream error:', err);
    if (!res.headersSent) res.status(500).send('Stream error');
  });
  req.on('close', () => {
    stream.destroy();
  });
  stream.pipe(res);

  res.on('finish', () => {
    push.status = 'completed';
    push.completedAt = Date.now();
    broadcastWs('transfer-completed', { transferId: id, success: true });
    // Clean up temporary uploads after 120 seconds
    setTimeout(() => {
      try {
        if (push.filePath && push.filePath.includes('uploads') && fs.existsSync(push.filePath)) {
          fs.unlinkSync(push.filePath);
        }
      } catch (e) { }
    }, 120000);
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

// Live peer download progress reporting
app.post('/api/transfer/progress', (req, res) => {
  broadcastWs('peer-transfer-progress', req.body);
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
  const { deviceId, deviceType } = req.query;
  const primaryIp = getLocalIpAddresses()[0];
  const reqIp = req.ip.replace('::ffff:', '');
  const list = Object.values(pendingPushes)
    .filter((p) => {
      if (p.status !== 'staged') return false;
      if (!p.targetDeviceId) return true;
      if (deviceId && p.targetDeviceId === deviceId) return true;
      if (deviceType === 'mobile' || p.targetDeviceType === 'mobile') return true;
      if (p.targetDeviceIp && p.targetDeviceIp === reqIp) return true;
      return false;
    })
    .map((p) => ({
      transferId: p.transferId,
      targetDeviceId: p.targetDeviceId,
      senderName: p.senderName,
      fileName: p.fileName,
      fileSize: p.fileSize,
      transferType: p.transferType || 'file',
      textContent: p.textContent || '',
      serverUrl: p.serverUrl || `http://${primaryIp}:${PORT}`,
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
  if (!isLocalRequest(req)) {
    return res.status(403).json({ error: 'CLI sharing is restricted to localhost' });
  }
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
