// Lightweight in-memory store + self-contained token fallback for Vercel Serverless
const linksStore = new Map();

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
    const raw = Buffer.from(str, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.i || parsed.n)) {
      return {
        token: parsed.i || str,
        fileName: parsed.n || 'Shared_File',
        fileSize: parsed.s || 0,
        type: parsed.t || 'file',
        laptopIp: parsed.h || '127.0.0.1',
        laptopPort: parsed.p || 51733,
        directUrl: parsed.u || `http://${parsed.h || '127.0.0.1'}:${parsed.p || 51733}/api/links/download/${parsed.i || str}`,
        expiresAt: parsed.e || (Date.now() + 3 * 3600 * 1000)
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
      return linksStore.get(token);
    }
    // Attempt self-contained token decoding
    return decodeSelfContained(token);
  },
  getAll() {
    cleanExpired();
    return Array.from(linksStore.values());
  },
  encodeSelfContained
};

