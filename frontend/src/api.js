// API service for Titan Plus Share
const getSavedServerUrl = () => {
  const saved = localStorage.getItem('titan_server_url');
  if (saved) return saved;

  // On Mobile, check if we have a paired laptop with a valid LAN IP
  try {
    const paired = JSON.parse(localStorage.getItem('titan_local_paired') || '[]');
    const laptop = paired.find(d => d.ip && d.ip !== '127.0.0.1' && d.ip !== 'localhost' && d.ip !== 'LAN');
    if (laptop) {
      return `http://${laptop.ip}:${laptop.port || 51733}`;
    }
  } catch (e) {}

  // If running in browser with real host IP (not localhost)
  if (window.location.hostname && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return `http://${window.location.hostname}:51733`;
  }

  return `${window.location.protocol}//${window.location.hostname}:51733`;
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

// Auto-discovery helper: probes known subnet / gateway candidates for active Titan server
export async function autoDiscoverLaptopServer() {
  const candidates = [];
  
  // 1. Check current serverUrl
  candidates.push(getServerUrl());

  // 2. Check paired devices
  try {
    const paired = JSON.parse(localStorage.getItem('titan_local_paired') || '[]');
    for (const d of paired) {
      if (d.ip && d.ip !== '127.0.0.1') candidates.push(`http://${d.ip}:${d.port || 51733}`);
    }
  } catch (e) {}

  // 3. Common Android Hotspot Gateway & Subnet IP defaults
  candidates.push('http://10.89.213.60:51733'); // User's active laptop IP
  candidates.push('http://192.168.43.1:51733'); // Android default hotspot gateway
  candidates.push('http://192.168.1.1:51733');
  candidates.push('http://192.168.0.1:51733');

  const uniqueCandidates = [...new Set(candidates)];
  for (const host of uniqueCandidates) {
    try {
      const res = await fetch(`${host}/api/status`, { signal: AbortSignal.timeout(1200) });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'online') {
          setServerUrl(host);
          return host;
        }
      }
    } catch (e) {}
  }
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
  const local = JSON.parse(localStorage.getItem('titan_local_paired') || '[]');
  try {
    const res = await fetch(`${getServerUrl()}/api/pair/list`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const serverList = await res.json();
      const combined = [...serverList];
      for (const loc of local) {
        if (!combined.some(d => d.deviceId === loc.deviceId || d.deviceName === loc.deviceName)) {
          combined.push(loc);
        }
      }
      return combined;
    }
  } catch (e) {}
  return local;
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
    let clean = str.trim();
    if (clean.includes('/d/')) {
      clean = clean.split('/d/')[1].split('/')[0].split('?')[0];
    } else if (clean.includes('/')) {
      clean = clean.split('/').pop().split('?')[0];
    }
    let b64 = clean.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const jsonStr = decodeURIComponent(
      atob(b64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const p = JSON.parse(jsonStr);
    if (p && (p.n || p.i) && p.e) {
      const now = Date.now();
      const isExpired = now > p.e;
      const remainingSeconds = Math.max(0, Math.floor((p.e - now) / 1000));
      return {
        token: p.i || clean,
        fileName: p.n || 'Shared_File',
        fileSize: p.s || 0,
        type: p.t || 'file',
        laptopIp: p.h || '127.0.0.1',
        laptopPort: p.p || 51733,
        directUrl: p.u || `http://${p.h || '127.0.0.1'}:${p.p || 51733}/api/links/download/${p.i || clean}`,
        isExpired,
        remainingSeconds,
        expiresAt: p.e
      };
    }
  } catch (e) {}
  return null;
}

export async function getLinkInfo(tokenOrUrl) {
  let token = (tokenOrUrl || '').trim();

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
        // Also save to paired list
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

  // 3. Fallback to Vercel validator
  try {
    const vercelFallback = `https://titan-plus-share.vercel.app/api/links/info/${cleanToken}`;
    const vRes = await fetch(vercelFallback, { signal: AbortSignal.timeout(3500) });
    if (vRes.ok) {
      const vData = await vRes.json();
      return vData;
    }
  } catch (e) {}

  // 4. Fallback for direct IP links: if URL was valid http://<ip>:<port>/d/<token>, return downloadable metadata
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

