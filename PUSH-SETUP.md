# Push Notifications — Setup & Operations

The app is a PWA with Web Push. Users enable alerts via **Menu → Event Alerts**
(on iPhone they must first **Add to Home Screen** and open the app from the icon
— iOS only allows push for installed web apps, 16.4+).

## One-time setup (run once, ~60 seconds)

Secrets are NOT in this repo. They live in `.push-keys.local.json` on Tony's
machine (untracked). Two steps:

1. **Environment variables** — from the repo root:

   ```sh
   PUB=$(python3 -c "import json;print(json.load(open('.push-keys.local.json'))['pub'])")
   PRIV=$(python3 -c "import json;print(json.load(open('.push-keys.local.json'))['priv'])")
   ADMIN=$(python3 -c "import json;print(json.load(open('.push-keys.local.json'))['admin'])")
   for T in production preview; do
     vercel env add VAPID_PUBLIC_KEY  $T --value="$PUB"  --yes --scope river-creative
     vercel env add VAPID_PRIVATE_KEY $T --value="$PRIV" --yes --scope river-creative
     vercel env add VAPID_SUBJECT     $T --value="mailto:tony@kingsarmscoffee.com" --yes --scope river-creative
     vercel env add PUSH_ADMIN_KEY    $T --value="$ADMIN" --yes --scope river-creative
   done
   ```

2. **Link the Blob store** (stores subscriptions; already created as
   `fire-conf-push`): Vercel dashboard → Storage → **fire-conf-push** →
   **Connect Project** → `fire-conf-map` (all environments). This injects
   `BLOB_READ_WRITE_TOKEN`.

Then redeploy (`git commit --allow-empty -m redeploy && git push`) so the
functions pick up the env.

## Google sign-in for /admin.html (one-time)

The composer is gated behind Google sign-in, restricted to allowed domains
(default `revival.com`; override with a `PUSH_ALLOWED_DOMAINS` env var,
comma-separated). Setup:

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   (signed in with the RMI Google Workspace admin account), create a project
   if needed, then **Create Credentials -> OAuth client ID -> Web application**.
   - If prompted to configure the consent screen first: choose **Internal**
     (Workspace) so only org accounts can ever sign in.
   - **Authorized JavaScript origins**: `https://map.fire.revival.com` and
     `https://fire-conf-map-git-pwa-river-creative.vercel.app`
   - No redirect URIs needed.
2. Copy the **Client ID** (`...apps.googleusercontent.com`) and:
   - paste it into `admin.html` (`GOOGLE_CLIENT_ID` constant), and
   - add it as a Vercel env var: `vercel env add GOOGLE_CLIENT_ID production --value="<id>" --yes --scope river-creative` (repeat for `preview`).
3. Redeploy.

The static `PUSH_ADMIN_KEY` still works for programmatic sends (curl/scripts);
the Google path is for humans on /admin.html. The server verifies tokens
against Google's tokeninfo endpoint: audience must match `GOOGLE_CLIENT_ID`,
email must be verified and on an allowed domain.

## Sending an alert

Open **`/admin.html`** on the deployed site, sign in with an allowed Google
account, write a title + message, and:

- **Dry run** — shows how many devices are subscribed (no send)
- **Send to everyone** — broadcasts immediately (no undo)

The optional link field controls what opens when the notification is tapped
(e.g. `/` for the app, or a full URL).

Or from a terminal:

```sh
curl -X POST https://map.fire.revival.com/api/push \
  -H "content-type: application/json" \
  -d '{"action":"send","key":"<ADMIN_KEY>","title":"Evening Session at 7 PM","body":"Doors open 6:00 — Main Sanctuary","url":"/"}'
```

## Architecture

- `manifest.webmanifest`, `icon-*.png` — installable PWA (standalone, dark, flame icon)
- `sw.js` — service worker: displays pushes, handles taps, light offline cache
- `api/push.js` — one function: `subscribe` / `unsubscribe` / `send` (admin-key gated);
  dead subscriptions (404/410) are pruned automatically on each send
- `api/_store.js` — subscriptions in Vercel Blob (`push-subs/*.json`);
  falls back to instance memory when the store isn't linked (testing only)
- Storage mode is reported in every API response (`"mode":"blob"` = durable)

## Gotchas

- **iOS**: install to Home Screen first; permission prompt must follow a user tap
  (the Event Alerts row is that tap).
- A dry-run showing `"mode":"memory"` means the Blob store isn't linked —
  subscriptions are NOT durable until it is.
- VAPID keys must never rotate casually: existing subscriptions die with them.
