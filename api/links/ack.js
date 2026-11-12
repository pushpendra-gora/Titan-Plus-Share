const { getLink, recordAck } = require('../_store');

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let token = req.query.token || req.body?.token;
  if (!token && req.url) {
    const parts = req.url.split('?')[0].split('/');
    token = parts[parts.length - 1];
  }

  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }

  const count = recordAck(token);
  if (req.query.selfToken) recordAck(req.query.selfToken);
  if (req.body?.selfToken) recordAck(req.body.selfToken);

  return res.status(200).json({
    success: true,
    token,
    downloadCount: count
  });
};

