// API service for Titan Plus Share
const getSavedServerUrl = () => {
  return localStorage.getItem('titan_server_url') || `${window.location.protocol}//${window.location.hostname}:51733`;
};

export const getServerUrl = () => {
  const url = getSavedServerUrl();
  return url.replace(/\/$/, '');
};

export const setServerUrl = (url) => {
  localStorage.setItem('titan_server_url', url);
};

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

export async function getLinkInfo(tokenOrUrl) {
  let targetUrl = '';
  let token = tokenOrUrl.trim();

  // If user pasted a full URL
  if (token.startsWith('http://') || token.startsWith('https://')) {
    try {
      const parsed = new URL(token);
      const origin = parsed.origin;
      const cleanToken = token.includes('/d/') 
        ? token.split('/d/')[1].split('/')[0].split('?')[0] 
        : token.split('/').pop().split('?')[0];
      targetUrl = `${origin}/api/links/info/${cleanToken}`;
      token = cleanToken;
    } catch (e) {}
  }

  if (!targetUrl) {
    targetUrl = `${getServerUrl()}/api/links/info/${token}`;
  }

  try {
    const res = await fetch(targetUrl, { signal: AbortSignal.timeout(4000) });
    if (res.ok) return await res.json();
  } catch (e) {}

  // Fallback to Vercel HTTPS validator if local didn't answer
  try {
    const vercelFallback = `https://titan-plus-share.vercel.app/api/links/info/${token}`;
    const vRes = await fetch(vercelFallback, { signal: AbortSignal.timeout(4000) });
    if (vRes.ok) return await vRes.json();
  } catch (e) {}

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

