// Subscription storage: Vercel Blob when BLOB_READ_WRITE_TOKEN is present,
// in-memory fallback otherwise (Fluid Compute instance reuse makes this good
// enough for smoke testing; link the Blob store for real durability).
const crypto = require('crypto');

const PREFIX = 'push-subs/';
const LOG_PREFIX = 'push-log/';
const hasBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;

const CFG_PATH = 'push-config/config.json';
const mem = (globalThis.__pushSubs = globalThis.__pushSubs || new Map());
const memLog = (globalThis.__pushLog = globalThis.__pushLog || []);
const memCfg = (globalThis.__pushCfg = globalThis.__pushCfg || {});

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

async function logSend(entry) {
  if (hasBlob()) {
    const { put } = require('@vercel/blob');
    const id = Date.now() + '-' + crypto.randomBytes(4).toString('hex');
    await put(LOG_PREFIX + id + '.json', JSON.stringify(entry), {
      access: 'private',
      addRandomSuffix: false,
      contentType: 'application/json',
      allowOverwrite: true,
    });
    return { mode: 'blob' };
  }
  memLog.push(entry);
  return { mode: 'memory' };
}

async function listLog() {
  if (hasBlob()) {
    const { list } = require('@vercel/blob');
    const entries = [];
    let cursor;
    do {
      const page = await list({ prefix: LOG_PREFIX, cursor, limit: 1000 });
      for (const item of page.blobs) {
        try {
          const url = item.downloadUrl || item.url;
          const res = await fetch(url, {
            headers: { authorization: 'Bearer ' + process.env.BLOB_READ_WRITE_TOKEN },
          });
          if (res.ok) entries.push(await res.json());
        } catch (e) { /* skip unreadable blob */ }
      }
      cursor = page.cursor;
    } while (cursor);
    entries.sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
    return { entries, mode: 'blob' };
  }
  return { entries: [...memLog].reverse(), mode: 'memory' };
}

async function getConfig() {
  if (hasBlob()) {
    const { list } = require('@vercel/blob');
    try {
      const page = await list({ prefix: CFG_PATH, limit: 1 });
      if (page.blobs.length) {
        const res = await fetch(page.blobs[0].downloadUrl || page.blobs[0].url, {
          headers: { authorization: 'Bearer ' + process.env.BLOB_READ_WRITE_TOKEN },
        });
        if (res.ok) return { config: await res.json(), mode: 'blob' };
      }
    } catch (e) { /* fall through to defaults */ }
    return { config: {}, mode: 'blob' };
  }
  return { config: memCfg, mode: 'memory' };
}

async function setConfig(patch) {
  const next = Object.assign({}, (await getConfig()).config, patch);
  if (hasBlob()) {
    const { put } = require('@vercel/blob');
    await put(CFG_PATH, JSON.stringify(next), {
      access: 'private',
      addRandomSuffix: false,
      contentType: 'application/json',
      allowOverwrite: true,
    });
    return { config: next, mode: 'blob' };
  }
  Object.assign(memCfg, patch);
  return { config: memCfg, mode: 'memory' };
}

module.exports = { saveSub, removeSub, listSubs, pruneSub, logSend, listLog, getConfig, setConfig };
