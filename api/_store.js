// Subscription storage: Vercel Blob when BLOB_READ_WRITE_TOKEN is present,
// in-memory fallback otherwise (Fluid Compute instance reuse makes this good
// enough for smoke testing; link the Blob store for real durability).
const crypto = require('crypto');

const PREFIX = 'push-subs/';
const hasBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;

const mem = (globalThis.__pushSubs = globalThis.__pushSubs || new Map());

function idFor(endpoint) {
  return crypto.createHash('sha256').update(endpoint).digest('hex');
}

async function saveSub(sub) {
  const id = idFor(sub.endpoint);
  if (hasBlob()) {
    const { put } = require('@vercel/blob');
    await put(PREFIX + id + '.json', JSON.stringify(sub), {
      access: 'private',
      addRandomSuffix: false,
      contentType: 'application/json',
      allowOverwrite: true,
    });
    return { id, mode: 'blob' };
  }
  mem.set(id, sub);
  return { id, mode: 'memory' };
}

async function removeSub(endpoint) {
  const id = idFor(endpoint);
  if (hasBlob()) {
    const { del } = require('@vercel/blob');
    await del(PREFIX + id + '.json').catch(() => {});
    return { id, mode: 'blob' };
  }
  mem.delete(id);
  return { id, mode: 'memory' };
}

async function listSubs() {
  if (hasBlob()) {
    const { list } = require('@vercel/blob');
    const subs = [];
    let cursor;
    do {
      const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
      for (const item of page.blobs) {
        try {
          const url = item.downloadUrl || item.url;
          const res = await fetch(url, {
            headers: { authorization: 'Bearer ' + process.env.BLOB_READ_WRITE_TOKEN },
          });
          if (res.ok) subs.push({ sub: await res.json(), pathname: item.pathname });
        } catch (e) { /* skip unreadable blob */ }
      }
      cursor = page.cursor;
    } while (cursor);
    return { subs, mode: 'blob' };
  }
  return {
    subs: [...mem.entries()].map(([id, sub]) => ({ sub, pathname: PREFIX + id + '.json' })),
    mode: 'memory',
  };
}

async function pruneSub(pathname) {
  if (hasBlob()) {
    const { del } = require('@vercel/blob');
    await del(pathname).catch(() => {});
  } else {
    mem.delete(pathname.replace(PREFIX, '').replace('.json', ''));
  }
}

module.exports = { saveSub, removeSub, listSubs, pruneSub };
