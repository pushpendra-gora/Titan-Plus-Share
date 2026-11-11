const { getLink } = require('../_store');

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Extract token from query or URL path
  let token = req.query.token;
  if (!token && req.url) {
    const parts = req.url.split('?')[0].split('/');
    token = parts[parts.length - 1];
  }

  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }

  const link = getLink(token);
  if (!link) {
    return res.status(404).json({ error: 'Link expired or not found on host laptop' });
  }

  const now = Date.now();
  const isExpired = now > link.expiresAt;
  const remainingSeconds = Math.max(0, Math.floor((link.expiresAt - now) / 1000));

  return res.status(200).json({
    token: link.token,
    type: link.type,
    fileName: link.fileName,
    fileSize: link.fileSize,
    laptopIp: link.laptopIp,
    laptopPort: link.laptopPort,
    directUrl: link.directUrl,
    isExpired,
    remainingSeconds,
    expiresAt: link.expiresAt
  });
};

