const { saveLink, encodeSelfContained } = require('../_store');

module.exports = (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, fileName, fileSize, type, textContent, laptopIp, laptopPort, directUrl, expiresAt } = req.body || {};

  if (!token || !fileName) {
    return res.status(400).json({ error: 'Missing token or fileName' });
  }

  const linkData = {
    token,
    fileName,
    fileSize: fileSize || 0,
    type: type || 'file',
    textContent: textContent || '',
    laptopIp: laptopIp || '127.0.0.1',
    laptopPort: laptopPort || 51733,
    directUrl: directUrl || `http://${laptopIp}:${laptopPort}/api/links/download/${token}`,
    expiresAt: expiresAt || (Date.now() + 3 * 3600 * 1000),
    downloadCount: 0,
    createdAt: Date.now()
  };

  saveLink(token, linkData);
  const selfToken = encodeSelfContained(linkData);

  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host || 'localhost';
  const httpsUrl = `${protocol}://${host}/d/${selfToken}`;

  return res.status(200).json({
    success: true,
    token: selfToken,
    originalToken: token,
    httpsUrl,
    directUrl: linkData.directUrl,
    expiresAt: linkData.expiresAt
  });
};

