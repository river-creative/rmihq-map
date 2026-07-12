// Single push endpoint (one function so the in-memory fallback shares state):
//   POST { action:"subscribe",   subscription }          -> store subscription
//   POST { action:"unsubscribe", endpoint }              -> remove subscription
//   POST { action:"send", key, title, body, url?, dryRun? } -> broadcast (PUSH_ADMIN_KEY gated)
const webpush = require('web-push');
const { saveSub, removeSub, listSubs, pruneSub } = require('./_store');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method not allowed' });
  }
  const body = req.body || {};
  try {
    if (body.action === 'subscribe') {
      const sub = body.subscription;
      if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
        return res.status(400).json({ ok: false, error: 'invalid subscription' });
      }
      const { mode } = await saveSub(sub);
      return res.status(200).json({ ok: true, mode });
    }

    if (body.action === 'unsubscribe') {
      if (!body.endpoint) return res.status(400).json({ ok: false, error: 'missing endpoint' });
      const { mode } = await removeSub(body.endpoint);
      return res.status(200).json({ ok: true, mode });
    }

    if (body.action === 'send') {
      const adminKey = process.env.PUSH_ADMIN_KEY;
      const pub = process.env.VAPID_PUBLIC_KEY;
      const priv = process.env.VAPID_PRIVATE_KEY;
      if (!adminKey || !pub || !priv) {
        return res.status(503).json({ ok: false, error: 'push env vars not configured' });
      }
      // auth: static admin key (programmatic) OR a Google ID token from an allowed domain
      let authed = body.key === adminKey;
      if (!authed && body.idToken) {
        try {
          const info = await (await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(body.idToken))).json();
          const email = String(info.email || '').toLowerCase();
          const okToken = info.aud === process.env.GOOGLE_CLIENT_ID && info.email_verified === 'true';
          const allowEmails = (process.env.PUSH_ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
          if (allowEmails.length) {
            authed = okToken && allowEmails.includes(email);   // strict allowlist when configured
          } else {
            const domains = (process.env.PUSH_ALLOWED_DOMAINS || 'revival.com').split(',').map(s => s.trim().toLowerCase());
            authed = okToken && domains.includes(email.split('@')[1] || '');
          }
        } catch (e) { authed = false; }
      }
      if (!authed) return res.status(401).json({ ok: false, error: 'unauthorized' });

      const { subs, mode } = await listSubs();
      if (body.dryRun) return res.status(200).json({ ok: true, dryRun: true, total: subs.length, mode });
      if (!body.title || !body.body) return res.status(400).json({ ok: false, error: 'title and body required' });

      webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:tony@kingsarmscoffee.com', pub, priv);
      const payload = JSON.stringify({
        title: String(body.title).slice(0, 120),
        body: String(body.body).slice(0, 400),
        url: body.url || '/',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
      });

      let sent = 0, failed = 0, pruned = 0; const errors = [];
      await Promise.all(subs.map(async ({ sub, pathname }) => {
        try {
          await webpush.sendNotification(sub, payload, { TTL: 3600 });
          sent++;
        } catch (e) {
          const code = e && e.statusCode;
          if (code === 404 || code === 410) { await pruneSub(pathname); pruned++; }
          else { failed++; if (errors.length < 3) errors.push(code || String(e && e.message).slice(0, 80)); }
        }
      }));
      return res.status(200).json({ ok: true, sent, failed, pruned, total: subs.length, mode, errors });
    }

    return res.status(400).json({ ok: false, error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
};
