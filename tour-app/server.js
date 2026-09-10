// 360 Tour Builder — self-hosted server (Raspberry Pi, a NAS, a laptop, anywhere Node runs).
// Stores the tour structure in data/tour.json and photos as plain JPEG files in data/images/.
//
// Two frontends are served from the same backend:
//   /          -> public/index.html   (read-only viewer — safe to share with anyone)
//   /editor    -> public/editor.html  (add/remove photos, rename scenes, set project details)
//
// Editing is protected by an "edit key". Set it via the EDIT_KEY environment variable, e.g.:
//   EDIT_KEY=something-only-you-know npm start
// If EDIT_KEY is left unset, editing is open to anyone who finds /editor (fine for local
// testing, not recommended once this is reachable from the internet).

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const IMAGES_DIR = path.join(DATA_DIR, 'images');
const DB_FILE = path.join(DATA_DIR, 'tour.json');
const EDIT_KEY = process.env.EDIT_KEY || '';

fs.mkdirSync(IMAGES_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ name: '360 Tour', description: '', order: [], scenes: {} }, null, 2));
}

function readDB() {
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  if (typeof db.description !== 'string') db.description = '';
  return db;
}
function writeDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function requireEditKey(req, res, next) {
  if (!EDIT_KEY) return next();
  if (req.get('x-edit-key') === EDIT_KEY) return next();
  res.status(401).json({ error: 'unauthorized' });
}

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/editor', (req, res) => res.sendFile(path.join(__dirname, 'public', 'editor.html')));

// --- Read endpoints (no key required — the viewer uses these) ---

app.get('/api/state', (req, res) => {
  const db = readDB();
  res.json({ name: db.name, description: db.description, order: db.order, scenes: db.scenes });
});

app.get('/api/images/:id', (req, res) => {
  const p = path.join(IMAGES_DIR, req.params.id + '.jpg');
  if (!fs.existsSync(p)) return res.status(404).end();
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(p);
});

// --- Write endpoints (edit key required if one is configured) ---

app.patch('/api/tour', requireEditKey, (req, res) => {
  const db = readDB();
  const { name, description } = req.body || {};
  if (typeof name === 'string' && name.trim()) db.name = name.trim();
  if (typeof description === 'string') db.description = description.trim();
  writeDB(db);
  res.json({ name: db.name, description: db.description });
});

app.post('/api/scenes', requireEditKey, (req, res) => {
  const { name, dataUrl } = req.body || {};
  if (!dataUrl || !dataUrl.startsWith('data:image/')) {
    return res.status(400).json({ error: 'invalid-image' });
  }
  const id = 'sc_' + crypto.randomBytes(6).toString('hex');
  const base64 = dataUrl.split(',')[1];
  const buffer = Buffer.from(base64, 'base64');
  fs.writeFileSync(path.join(IMAGES_DIR, id + '.jpg'), buffer);

  const db = readDB();
  const sceneName = (name && name.trim()) || ('Scene ' + (db.order.length + 1));
  db.scenes[id] = { id, name: sceneName, hotspots: [] };
  db.order.push(id);
  writeDB(db);
  res.json(db.scenes[id]);
});

app.patch('/api/scenes/:id', requireEditKey, (req, res) => {
  const db = readDB();
  const scene = db.scenes[req.params.id];
  if (!scene) return res.status(404).json({ error: 'not-found' });
  if (typeof req.body.name === 'string' && req.body.name.trim()) {
    scene.name = req.body.name.trim();
  }
  writeDB(db);
  res.json(scene);
});

app.delete('/api/scenes/:id', requireEditKey, (req, res) => {
  const db = readDB();
  const id = req.params.id;
  if (!db.scenes[id]) return res.status(404).json({ error: 'not-found' });
  delete db.scenes[id];
  db.order = db.order.filter((x) => x !== id);
  Object.values(db.scenes).forEach((s) => {
    s.hotspots = (s.hotspots || []).filter((h) => h.target !== id);
  });
  writeDB(db);
  const imgPath = path.join(IMAGES_DIR, id + '.jpg');
  if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
  res.json({ ok: true });
});

app.post('/api/scenes/:id/hotspots', requireEditKey, (req, res) => {
  const db = readDB();
  const scene = db.scenes[req.params.id];
  if (!scene) return res.status(404).json({ error: 'not-found' });
  const { x, y, z, target } = req.body || {};
  if (!db.scenes[target]) return res.status(400).json({ error: 'invalid-target' });
  const hotspot = {
    id: 'h_' + crypto.randomBytes(5).toString('hex'),
    x, y, z, target,
    label: db.scenes[target].name
  };
  scene.hotspots.push(hotspot);
  writeDB(db);
  res.json(hotspot);
});

app.delete('/api/scenes/:id/hotspots/:hid', requireEditKey, (req, res) => {
  const db = readDB();
  const scene = db.scenes[req.params.id];
  if (!scene) return res.status(404).json({ error: 'not-found' });
  scene.hotspots = (scene.hotspots || []).filter((h) => h.id !== req.params.hid);
  writeDB(db);
  res.json({ ok: true });
});

app.delete('/api/tour', requireEditKey, (req, res) => {
  const db = readDB();
  db.order.forEach((id) => {
    const p = path.join(IMAGES_DIR, id + '.jpg');
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });
  writeDB({ name: '360 Tour', description: '', order: [], scenes: {} });
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('360 Tour Builder running at http://localhost:' + PORT);
  console.log('Viewer: http://localhost:' + PORT + '/');
  console.log('Editor: http://localhost:' + PORT + '/editor');
  if (!EDIT_KEY) console.log('Note: EDIT_KEY is not set — the editor is currently open to anyone who finds it.');
});
