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
    if (parsed && parsed.i) {
      return {
        token: parsed.i,
        fileName: parsed.n,
        fileSize: parsed.s,
        type: parsed.t,
        laptopIp: parsed.h,
        laptopPort: parsed.p,
        directUrl: parsed.u,
        expiresAt: parsed.e
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

