const { getLink, recordAck } = require('../_store');

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let token = req.query.token || req.body?.token;
  const action = req.query.action || req.body?.action || 'download';
  if (!token && req.url) {
    const parts = req.url.split('?')[0].split('/');
    token = parts[parts.length - 1];
  }

  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }

  const count = recordAck(token, action);
  if (req.query.selfToken) recordAck(req.query.selfToken, action);
  if (req.body?.selfToken) recordAck(req.body.selfToken, action);

  return res.status(200).json({
    success: true,
    token,
    action,
    downloadCount: count
  });
};

