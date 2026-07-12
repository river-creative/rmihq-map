// POST { key, title, body, url?, dryRun? } -> broadcast a push notification
// Protected by PUSH_ADMIN_KEY. Dead subscriptions (404/410) are pruned.
const webpush = require('web-push');
const { listSubs, pruneSub } = require('./_store');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method not allowed' });
  }
  const adminKey = process.env.PUSH_ADMIN_KEY;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!adminKey || !pub || !priv) {
    return res.status(503).json({ ok: false, error: 'push env vars not configured' });
  }
  const { key, title, body, url, dryRun } = req.body || {};
  if (key !== adminKey) return res.status(401).json({ ok: false, error: 'bad key' });
  if (!dryRun && (!title || !body)) {
    return res.status(400).json({ ok: false, error: 'title and body required' });
  }

  const { subs, mode } = await listSubs();
  if (dryRun) return res.status(200).json({ ok: true, dryRun: true, total: subs.length, mode });

  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:tony@kingsarmscoffee.com', pub, priv);
  const payload = JSON.stringify({
    title: String(title).slice(0, 120),
    body: String(body).slice(0, 400),
    url: url || '/',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
  });

  let sent = 0, failed = 0, pruned = 0;
  await Promise.all(subs.map(async ({ sub, pathname }) => {
    try {
      await webpush.sendNotification(sub, payload, { TTL: 3600 });
      sent++;
    } catch (e) {
      const code = e && e.statusCode;
      if (code === 404 || code === 410) { await pruneSub(pathname); pruned++; }
      else failed++;
    }
  }));

  return res.status(200).json({ ok: true, sent, failed, pruned, total: subs.length, mode });
};
