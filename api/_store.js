// Lightweight in-memory store + self-contained token fallback + /tmp persistence for Vercel Serverless
const fs = require('fs');
const linksStore = new Map();
const ACKS_FILE = '/tmp/titan_acks.json';

function readAcks() {
  try {
    if (fs.existsSync(ACKS_FILE)) {
      return JSON.parse(fs.readFileSync(ACKS_FILE, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function writeAcks(acks) {
  try {
    fs.writeFileSync(ACKS_FILE, JSON.stringify(acks));
  } catch (e) {}
}

function recordAck(token) {
  if (!token) return 1;
  const acks = readAcks();
  acks[token] = (acks[token] || 0) + 1;
  writeAcks(acks);

  if (linksStore.has(token)) {
    const l = linksStore.get(token);
    l.downloadCount = (l.downloadCount || 0) + 1;
    l.status = 'downloaded';
    l.lastDownloadedAt = Date.now();
  }
  return acks[token];
}

function getAckCount(token) {
  if (!token) return 0;
  const acks = readAcks();
  return acks[token] || (linksStore.get(token)?.downloadCount || 0);
}

function cleanExpired() {
  const now = Date.now();
  for (const [token, data] of linksStore.entries()) {
    if (data.expiresAt && now > data.expiresAt) {
      linksStore.delete(token);
    }
  }
}

// Encode metadata into a compact base64url token fallback
function encodeSelfContained(data) {
  try {
    const min = {
      i: data.token,
      n: data.fileName,
      s: data.fileSize,
      t: data.type,
      c: data.textContent || '',
      h: data.laptopIp,
      p: data.laptopPort,
      u: data.directUrl,
      e: data.expiresAt
    };
    return Buffer.from(JSON.stringify(min)).toString('base64url');
  } catch (e) {
    return null;
  }
}

function decodeSelfContained(str) {
  try {
    let clean = (str || '').trim();
    if (clean.includes('/d/')) clean = clean.split('/d/')[1].split('/')[0].split('?')[0];
    if (clean.includes('/api/links/download/')) clean = clean.split('/api/links/download/')[1].split('/')[0].split('?')[0];
    if (clean.includes('/')) clean = clean.split('/').pop().split('?')[0];

    const raw = Buffer.from(clean, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.i || parsed.n)) {
      const shortToken = parsed.i || clean;
      const count = getAckCount(shortToken) || getAckCount(clean);
      return {
        token: shortToken,
        fileName: parsed.n || 'Shared_File',
        fileSize: parsed.s || 0,
        type: parsed.t || 'file',
        textContent: parsed.c || parsed.textContent || '',
        laptopIp: parsed.h || '127.0.0.1',
        laptopPort: parsed.p || 51733,
        directUrl: parsed.u || `http://${parsed.h || '127.0.0.1'}:${parsed.p || 51733}/api/links/download/${shortToken}`,
        expiresAt: parsed.e || (Date.now() + 3 * 3600 * 1000),
        downloadCount: count,
        status: count > 0 ? 'downloaded' : 'pending'
      };
    }
  } catch (e) {}
  return null;
}

module.exports = {
  saveLink(token, data) {
    cleanExpired();
    linksStore.set(token, data);
  },
  getLink(token) {
    cleanExpired();
    if (linksStore.has(token)) {
      const l = linksStore.get(token);
      const count = getAckCount(token);
      if (count > (l.downloadCount || 0)) {
        l.downloadCount = count;
        l.status = 'downloaded';
      }
      return l;
    }
    // Attempt self-contained token decoding
    return decodeSelfContained(token);
  },
  getAll() {
    cleanExpired();
    return Array.from(linksStore.values());
  },
  encodeSelfContained,
  recordAck,
  getAckCount
};

