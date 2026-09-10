// Same API as server.js, adapted for Netlify Functions + Netlify Blobs.
// Set an EDIT_KEY environment variable in your Netlify site settings to protect
// the editor — without it, anyone who finds /editor can make changes.

const { getStore } = require('@netlify/blobs');

const EDIT_KEY = process.env.EDIT_KEY || '';

function dbStore() { return getStore('tour-db'); }
function imageStore() { return getStore('tour-images'); }

async function readDB() {
  const raw = await dbStore().get('state', { type: 'json' });
  const data = raw || { name: '360 Tour', description: '', order: [], scenes: {} };
  if (typeof data.description !== 'string') data.description = '';
  return data;
}
async function writeDB(data) {
  await dbStore().set('state', JSON.stringify(data));
}

function json(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function hasValidKey(event) {
  if (!EDIT_KEY) return true;
  const headers = event.headers || {};
  const key = headers['x-edit-key'] || headers['X-Edit-Key'];
  return key === EDIT_KEY;
}

exports.handler = async (event) => {
  const method = event.httpMethod;
  const segments = (event.path || '')
    .replace(/^\/(\.netlify\/functions\/api|api)\/?/, '')
    .split('/')
    .filter(Boolean);

  const writeMethods = ['POST', 'PATCH', 'DELETE'];
  if (writeMethods.includes(method) && !hasValidKey(event)) {
    return json(401, { error: 'unauthorized' });
  }

  try {
    // GET /api/state
    if (segments[0] === 'state' && method === 'GET') {
      return json(200, await readDB());
    }

    // PATCH /api/tour
    if (segments[0] === 'tour' && segments.length === 1 && method === 'PATCH') {
      const data = await readDB();
      const { name, description } = JSON.parse(event.body || '{}');
      if (typeof name === 'string' && name.trim()) data.name = name.trim();
      if (typeof description === 'string') data.description = description.trim();
      await writeDB(data);
      return json(200, { name: data.name, description: data.description });
    }

    // POST /api/scenes
    if (segments[0] === 'scenes' && segments.length === 1 && method === 'POST') {
      const { name, dataUrl } = JSON.parse(event.body || '{}');
      if (!dataUrl || !dataUrl.startsWith('data:image/')) return json(400, { error: 'invalid-image' });
      const id = 'sc_' + Math.random().toString(36).slice(2, 10);
      const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');
      await imageStore().set(id, buffer);

      const data = await readDB();
      const sceneName = (name && name.trim()) || ('Scene ' + (data.order.length + 1));
      data.scenes[id] = { id, name: sceneName, hotspots: [] };
      data.order.push(id);
      await writeDB(data);
      return json(200, data.scenes[id]);
    }

    // PATCH /api/scenes/:id
    if (segments[0] === 'scenes' && segments.length === 2 && method === 'PATCH') {
      const id = segments[1];
      const data = await readDB();
      const scene = data.scenes[id];
      if (!scene) return json(404, { error: 'not-found' });
      const { name } = JSON.parse(event.body || '{}');
      if (typeof name === 'string' && name.trim()) scene.name = name.trim();
      await writeDB(data);
      return json(200, scene);
    }

    // DELETE /api/scenes/:id
    if (segments[0] === 'scenes' && segments.length === 2 && method === 'DELETE') {
      const id = segments[1];
      const data = await readDB();
      if (!data.scenes[id]) return json(404, { error: 'not-found' });
      delete data.scenes[id];
      data.order = data.order.filter((x) => x !== id);
      Object.values(data.scenes).forEach((s) => {
        s.hotspots = (s.hotspots || []).filter((h) => h.target !== id);
      });
      await writeDB(data);
      await imageStore().delete(id);
      return json(200, { ok: true });
    }

    // POST /api/scenes/:id/hotspots
    if (segments[0] === 'scenes' && segments.length === 3 && segments[2] === 'hotspots' && method === 'POST') {
      const id = segments[1];
      const data = await readDB();
      const scene = data.scenes[id];
      if (!scene) return json(404, { error: 'not-found' });
      const { x, y, z, target } = JSON.parse(event.body || '{}');
      if (!data.scenes[target]) return json(400, { error: 'invalid-target' });
      const hotspot = {
        id: 'h_' + Math.random().toString(36).slice(2, 9),
        x, y, z, target,
        label: data.scenes[target].name
      };
      scene.hotspots.push(hotspot);
      await writeDB(data);
      return json(200, hotspot);
    }

    // DELETE /api/scenes/:id/hotspots/:hid
    if (segments[0] === 'scenes' && segments.length === 4 && segments[2] === 'hotspots' && method === 'DELETE') {
      const id = segments[1];
      const hid = segments[3];
      const data = await readDB();
      const scene = data.scenes[id];
      if (!scene) return json(404, { error: 'not-found' });
      scene.hotspots = (scene.hotspots || []).filter((h) => h.id !== hid);
      await writeDB(data);
      return json(200, { ok: true });
    }

    // DELETE /api/tour
    if (segments[0] === 'tour' && method === 'DELETE') {
      const data = await readDB();
      for (const id of data.order) await imageStore().delete(id);
      await writeDB({ name: '360 Tour', description: '', order: [], scenes: {} });
      return json(200, { ok: true });
    }

    // GET /api/images/:id
    if (segments[0] === 'images' && segments.length === 2 && method === 'GET') {
      const buf = await imageStore().get(segments[1], { type: 'arrayBuffer' });
      if (!buf) return { statusCode: 404, body: 'Not found' };
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' },
        body: Buffer.from(buf).toString('base64'),
        isBase64Encoded: true
      };
    }

    return json(404, { error: 'unknown-route' });
  } catch (err) {
    return json(500, { error: (err && err.message) || 'server-error' });
  }
};
