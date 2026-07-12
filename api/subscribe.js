// POST   { subscription } -> store it
// DELETE { endpoint }     -> remove it
const { saveSub, removeSub } = require('./_store');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'POST') {
      const sub = (req.body && req.body.subscription) || req.body;
      if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
        return res.status(400).json({ ok: false, error: 'invalid subscription' });
      }
      const { mode } = await saveSub(sub);
      return res.status(200).json({ ok: true, mode });
    }
    if (req.method === 'DELETE') {
      const endpoint = req.body && req.body.endpoint;
      if (!endpoint) return res.status(400).json({ ok: false, error: 'missing endpoint' });
      const { mode } = await removeSub(endpoint);
      return res.status(200).json({ ok: true, mode });
    }
    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ ok: false, error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
};
