// API service for Titan Plus Share
const getSavedServerUrl = () => {
  const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);

  // On Laptop / Desktop PC: The Titan server is always running locally!
  if (!isMobile) {
    if (typeof window !== 'undefined' && window.location.protocol.startsWith('http') && window.location.port === '51733') {
      return window.location.origin;
    }
    return 'http://127.0.0.1:51733';
  }

  // On Mobile: check explicitly saved laptop URL
  const saved = localStorage.getItem('titan_server_url');
  if (saved && !saved.includes('localhost') && !saved.includes('127.0.0.1')) {
    return saved;
  }

  // On Mobile: check paired laptop devices
  try {
    const paired = JSON.parse(localStorage.getItem('titan_local_paired') || '[]');
    const laptop = paired.find(d => (d.deviceType === 'laptop' || !d.deviceType) && d.ip && d.ip !== '127.0.0.1' && d.ip !== 'localhost' && d.ip !== 'LAN');
    if (laptop) {
      return `http://${laptop.ip}:${laptop.port || 51733}`;
    }
  } catch (e) {}

  if (saved) return saved;

  if (typeof window !== 'undefined' && window.location.hostname && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return `http://${window.location.hostname}:51733`;
  }

  return 'http://127.0.0.1:51733';
};

export const getServerUrl = () => {
  const url = getSavedServerUrl();
  return url.replace(/\/$/, '');
};

export const setServerUrl = (url) => {
  if (!url) return;
  const clean = url.replace(/\/$/, '');
  localStorage.setItem('titan_server_url', clean);
};

// Auto-discovery helper: probes known subnet / gateway candidates in parallel for lightning-fast discovery
export async function autoDiscoverLaptopServer() {
  const candidates = [];
  
  // 1. Check current serverUrl
  candidates.push(getServerUrl());

  // 2. Check paired devices
  try {
    const paired = JSON.parse(localStorage.getItem('titan_local_paired') || '[]');
    for (const d of paired) {
      if (d.ip && d.ip !== '127.0.0.1' && d.ip !== 'localhost') {
        candidates.push(`http://${d.ip}:${d.port || 51733}`);
      }
    }
  } catch (e) {}

  // 3. Common Android Hotspot Gateway & Subnet IP defaults
  candidates.push('http://192.168.43.1:51733'); // Android default hotspot gateway
  candidates.push('http://192.168.1.1:51733');
  candidates.push('http://192.168.0.1:51733');
  candidates.push('http://10.89.213.60:51733');

  const uniqueCandidates = [...new Set(candidates.filter(Boolean))];
  
  // Probe all candidates concurrently for instant discovery
  const probe = async (host) => {
    const res = await fetch(`${host}/api/status`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) throw new Error('Not ok');
    const data = await res.json();
    if (data.status === 'online') return host;
    throw new Error('Not online');
  };

  try {
    const winner = await Promise.any(uniqueCandidates.map(c => probe(c)));
    if (winner) {
      setServerUrl(winner);
      return winner;
    }
  } catch (e) {}
  return null;
}

export const getDeviceId = () => {
  let id = localStorage.getItem('titan_device_id');
  if (!id) {
    id = 'dev_' + Math.random().toString(36).substring(2, 10);
    localStorage.setItem('titan_device_id', id);
  }
  return id;
};

export const getDeviceName = () => {
  let name = localStorage.getItem('titan_device_name');
  if (!name) {
    const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
    name = isMobile ? 'Mobile Device' : (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'Windows PC' : window.location.hostname);
    localStorage.setItem('titan_device_name', name);
  }
  return name;
};

export const setDeviceName = (name) => {
  localStorage.setItem('titan_device_name', name);
};

export async function checkServerStatus() {
  try {
    const res = await fetch(`${getServerUrl()}/api/status`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error('Status failed');
    return await res.json();
  } catch (e) {
    return null;
  }
}

export async function getPairingInfo() {
  const res = await fetch(`${getServerUrl()}/api/pair/info`);
  return await res.json();
}

export async function authenticateDevice(payload) {
  const res = await fetch(`${getServerUrl()}/api/pair/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return await res.json();
}

export async function getPairedDevices() {
  const myId = getDeviceId();
  const myName = getDeviceName();
  const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);

  const local = JSON.parse(localStorage.getItem('titan_local_paired') || '[]');
  let combined = [...local];

  try {
    const res = await fetch(`${getServerUrl()}/api/pair/list`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const serverList = await res.json();
      for (const item of serverList) {
        if (!combined.some(d => d.deviceId === item.deviceId || d.deviceName === item.deviceName)) {
          combined.push(item);
        }
      }
    }
  } catch (e) {}

  // Filter out self and deduplicate by IP / deviceId
  const seen = new Set();
  const filtered = [];
  for (const d of combined) {
    if (d.deviceId === myId || d.deviceName === myName) continue;
    if (isMobile && d.deviceType === 'mobile' && d.deviceId === myId) continue;
    if (!isMobile && d.deviceType === 'laptop') continue;
    const key = (d.ip && d.ip !== 'LAN' && d.ip !== '127.0.0.1') ? d.ip : d.deviceId;
    if (seen.has(key)) continue;
    seen.add(key);
    filtered.push(d);
  }
  return filtered;
}

export async function removePairedDevice(deviceId) {
  try {
    await fetch(`${getServerUrl()}/api/pair/${deviceId}`, { method: 'DELETE' });
  } catch (e) {}
  const local = JSON.parse(localStorage.getItem('titan_local_paired') || '[]')
    .filter(d => d.deviceId !== deviceId);
  localStorage.setItem('titan_local_paired', JSON.stringify(local));
}

export async function generateShareLink(file, type = 'file', textContent = '') {
  const formData = new FormData();
  formData.append('type', type);
  formData.append('creatorDeviceId', getDeviceId());
  formData.append('creatorDeviceName', getDeviceName());

  if (type === 'text') {
    formData.append('textContent', textContent);
  } else if (file) {
    formData.append('file', file);
    formData.append('originalName', file.name);
  }

  const res = await fetch(`${getServerUrl()}/api/links/create`, {
    method: 'POST',
    body: formData
  });

  if (!res.ok) throw new Error('Failed to create link');
  return await res.json();
}

export async function generateFolderShareLink(files, folderName) {
  const formData = new FormData();
  formData.append('folderName', folderName);
  formData.append('creatorDeviceId', getDeviceId());
  formData.append('creatorDeviceName', getDeviceName());

  const relativePaths = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    formData.append('files', file);
    relativePaths.push(file.webkitRelativePath || file.name);
  }
  formData.append('relativePaths', JSON.stringify(relativePaths));

  const res = await fetch(`${getServerUrl()}/api/links/create-folder`, {
    method: 'POST',
    body: formData
  });

  if (!res.ok) throw new Error('Failed to create folder link');
  return await res.json();
}

export async function getLinksList() {
  try {
    const myId = getDeviceId();
    const res = await fetch(`${getServerUrl()}/api/links/list?creatorDeviceId=${encodeURIComponent(myId)}`);
    if (res.ok) return await res.json();
  } catch (e) {}
  return [];
}

export async function deleteLink(token) {
  try {
    await fetch(`${getServerUrl()}/api/links/${token}`, { method: 'DELETE' });
    return true;
  } catch (e) {
    return false;
  }
}

function tryDecodeSelfContained(str) {
  try {
    let clean = (str || '').trim();
    if (clean.includes('/d/')) {
      clean = clean.split('/d/')[1].split('/')[0].split('?')[0];
    } else if (clean.includes('/api/links/download/')) {
      clean = clean.split('/api/links/download/')[1].split('/')[0].split('?')[0];
    } else if (clean.includes('/')) {
      clean = clean.split('/').pop().split('?')[0];
    }

    if (!clean || clean.length < 8) return null;

    let b64 = clean.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';

    let jsonStr = '';
    try {
      jsonStr = decodeURIComponent(escape(atob(b64)));
    } catch (e1) {
      try {
        jsonStr = atob(b64);
      } catch (e2) {
        return null;
      }
    }

    const p = JSON.parse(jsonStr);
    if (p && (p.n || p.i || p.fileName) && (p.e || p.expiresAt || p.h || p.laptopIp)) {
      const now = Date.now();
      const exp = p.e || p.expiresAt || (now + 10800000);
      const isExpired = now > exp;
      const remainingSeconds = Math.max(0, Math.floor((exp - now) / 1000));
      const hostIp = p.h || p.laptopIp || '127.0.0.1';
      const hostPort = p.p || p.laptopPort || 51733;
      const token = p.i || p.token || clean;

      return {
        token,
        fileName: p.n || p.fileName || 'Shared_File',
        fileSize: p.s || p.fileSize || 0,
        type: p.t || p.type || 'file',
        laptopIp: hostIp,
        laptopPort: hostPort,
        directUrl: p.u || `http://${hostIp}:${hostPort}/api/links/download/${token}`,
        isExpired,
        remainingSeconds,
        expiresAt: exp
      };
    }
  } catch (e) {}
  return null;
}

export async function getLinkInfo(tokenOrUrl) {
  let token = (tokenOrUrl || '').trim();

  if (!token || token.length < 4) {
    throw new Error('Please paste a complete Titan Plus Share link or scan QR code.');
  }

  // 1. First check if token itself is self-contained base64
  const selfContained = tryDecodeSelfContained(token);
  if (selfContained && !selfContained.isExpired) {
    if (selfContained.laptopIp && selfContained.laptopIp !== '127.0.0.1' && selfContained.laptopIp !== 'localhost') {
      setServerUrl(`http://${selfContained.laptopIp}:${selfContained.laptopPort || 51733}`);
    }
    return selfContained;
  }

  let targetUrl = '';
  let parsedOrigin = '';
  let cleanToken = token;

  // If user pasted a full URL (e.g. http://10.89.213.60:51733/d/... or https://...)
  if (token.startsWith('http://') || token.startsWith('https://')) {
    try {
      const parsed = new URL(token);
      parsedOrigin = parsed.origin;
      if (token.includes('/d/')) {
        cleanToken = token.split('/d/')[1].split('/')[0].split('?')[0];
      } else if (token.includes('/')) {
        cleanToken = token.split('/').pop().split('?')[0];
      }

      // If it's a LAN laptop IP, save it immediately as our active server
      if (parsed.hostname && parsed.hostname !== 'localhost' && !parsed.hostname.includes('vercel.app')) {
        setServerUrl(parsedOrigin);
        try {
          const local = JSON.parse(localStorage.getItem('titan_local_paired') || '[]');
          if (!local.some(d => d.ip === parsed.hostname)) {
            local.push({
              deviceId: 'lap_' + parsed.hostname,
              deviceName: 'Host Laptop (' + parsed.hostname + ')',
              deviceType: 'laptop',
              ip: parsed.hostname,
              port: parsed.port || 51733,
              pairedAt: Date.now()
            });
            localStorage.setItem('titan_local_paired', JSON.stringify(local));
          }
        } catch (e) {}
      }

      // Check if cleanToken inside URL is self-contained
      const subSelf = tryDecodeSelfContained(cleanToken);
      if (subSelf && !subSelf.isExpired) {
        return subSelf;
      }

      targetUrl = `${parsedOrigin}/api/links/info/${cleanToken}`;
    } catch (e) {}
  }

  // Check if incomplete URL was pasted
  if ((token.startsWith('http://') || token.startsWith('https://')) && (!cleanToken || cleanToken === 'd' || cleanToken.length < 4)) {
    throw new Error('Please paste the complete download link including token.');
  }

  if (!targetUrl) {
    targetUrl = `${getServerUrl()}/api/links/info/${cleanToken}`;
  }

  // 2. Fetch metadata from host server
  try {
    const res = await fetch(targetUrl, { signal: AbortSignal.timeout(3500) });
    if (res.ok) {
      const data = await res.json();
      return data;
    }
  } catch (e) {}

  // 3. Fallback: try paired laptop IP if available
  try {
    const paired = JSON.parse(localStorage.getItem('titan_local_paired') || '[]');
    for (const d of paired) {
      if (d.ip && d.ip !== '127.0.0.1') {
        const altUrl = `http://${d.ip}:${d.port || 51733}/api/links/info/${cleanToken}`;
        const altRes = await fetch(altUrl, { signal: AbortSignal.timeout(2000) });
        if (altRes.ok) {
          const altData = await altRes.json();
          setServerUrl(`http://${d.ip}:${d.port || 51733}`);
          return altData;
        }
      }
    }
  } catch (e) {}

  // 4. Fallback to Vercel validator
  try {
    const vercelFallback = `https://titan-plus-share.vercel.app/api/links/info/${cleanToken}`;
    const vRes = await fetch(vercelFallback, { signal: AbortSignal.timeout(3500) });
    if (vRes.ok) {
      const vData = await vRes.json();
      return vData;
    }
  } catch (e) {}

  // 5. Fallback for direct IP links: if URL was valid http://<ip>:<port>/d/<token>, return downloadable metadata
  if (parsedOrigin && cleanToken) {
    const directUrl = `${parsedOrigin}/api/links/download/${cleanToken}`;
    return {
      token: cleanToken,
      fileName: 'Titan_Shared_File',
      fileSize: 0,
      type: 'file',
      laptopIp: new URL(parsedOrigin).hostname,
      laptopPort: new URL(parsedOrigin).port || 51733,
      directUrl: directUrl,
      isExpired: false,
      remainingSeconds: 10800,
      expiresAt: Date.now() + 3 * 3600 * 1000
    };
  }

  if (selfContained && selfContained.isExpired) {
    throw new Error('Link has expired (3 hour limit reached)');
  }

  throw new Error('Link expired or not reachable. Ensure the host laptop is online.');
}

export function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

