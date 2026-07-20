// Repeat-Offender-API fuer Chatty.
// Merkt sich pro Kanal + Nutzer die Anzahl der Verstoesse und liefert eine
// eskalierende Timeout-Dauer in Sekunden zurueck. Chatty ruft /next per
// $request(...) auf und setzt damit den Timeout.

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const PORT = Number(process.env.PORT || 8787);
const API_KEY = process.env.API_KEY || '';
const TIERS = (process.env.TIERS || '60,300,600,3600,86400,604800,1209600')
  .split(',')
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => Number.isFinite(n) && n > 0);
const DECAY_MS = Number(process.env.DECAY_DAYS || 30) * 24 * 60 * 60 * 1000;

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'offenders.json');

if (!API_KEY) {
  console.error('FEHLER: API_KEY fehlt in der .env');
  process.exit(1);
}

let db = load();

function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

// Kanal/Name vereinheitlichen: klein, ohne fuehrendes #
function norm(v) {
  return String(v || '').trim().toLowerCase().replace(/^#/, '');
}

function getEntry(chan, user) {
  const c = norm(chan);
  const u = norm(user);
  if (!c || !u) return null;
  db[c] = db[c] || {};
  return { chan: c, user: u, rec: db[c][u] || { count: 0, lastOffense: 0 } };
}

// Dauer fuer den n-ten Verstoss (1-basiert)
function durationFor(count) {
  const idx = Math.min(count, TIERS.length) - 1;
  return TIERS[Math.max(0, idx)];
}

// --- Offizielle Twitch-Abzeichen ---
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID || '';
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || '';
let twToken = { value: null, expires: 0 };
let globalBadges = { data: null, fetchedAt: 0 };
const channelBadges = new Map(); // login -> { data, fetchedAt }
const channelId = new Map();     // login -> id

async function twGetToken() {
  if (twToken.value && Date.now() < twToken.expires) return twToken.value;
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: TWITCH_CLIENT_ID, client_secret: TWITCH_CLIENT_SECRET, grant_type: 'client_credentials' }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('kein Twitch-Token (Client-ID/Secret pruefen)');
  twToken = { value: j.access_token, expires: Date.now() + (j.expires_in - 60) * 1000 };
  return twToken.value;
}

async function twGet(url) {
  const token = await twGetToken();
  const res = await fetch(url, { headers: { 'Client-Id': TWITCH_CLIENT_ID, 'Authorization': 'Bearer ' + token } });
  if (!res.ok) throw new Error('Twitch API ' + res.status);
  return res.json();
}

function badgeMap(sets, out) {
  for (const s of sets) for (const v of s.versions) out[`${s.set_id}/${v.id}`] = v.image_url_2x;
  return out;
}

async function getGlobalBadges() {
  if (globalBadges.data && Date.now() - globalBadges.fetchedAt < 24 * 60 * 60 * 1000) return globalBadges.data;
  const j = await twGet('https://api.twitch.tv/helix/chat/badges/global');
  globalBadges = { data: badgeMap(j.data, {}), fetchedAt: Date.now() };
  return globalBadges.data;
}

async function getChannelBadges(login) {
  const l = norm(login);
  const cached = channelBadges.get(l);
  if (cached && Date.now() - cached.fetchedAt < 60 * 60 * 1000) return cached.data;
  let id = channelId.get(l);
  if (!id) {
    const u = await twGet('https://api.twitch.tv/helix/users?login=' + encodeURIComponent(l));
    id = u.data[0] ? u.data[0].id : null;
    channelId.set(l, id);
  }
  let map = {};
  if (id) map = badgeMap((await twGet('https://api.twitch.tv/helix/chat/badges?broadcaster_id=' + id)).data, {});
  channelBadges.set(l, { data: map, fetchedAt: Date.now() });
  return map;
}

const app = express();
app.set('trust proxy', true);

// Erlaubt dem lokalen Chat-Fenster (andere Herkunft) den Zugriff
app.use((_req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  next();
});

// Schluessel-Pruefung fuer alle Endpunkte
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  if (req.query.key !== API_KEY) {
    return res.status(403).type('text/plain').send('forbidden');
  }
  next();
});

// Zaehlt einen Verstoss hoch und gibt NUR die Timeout-Dauer (Sekunden) als Text zurueck.
// Genau das, was Chatty in /timeout <user> <dauer> einsetzt.
app.get('/next', (req, res) => {
  const entry = getEntry(req.query.chan, req.query.user);
  if (!entry) return res.status(400).type('text/plain').send('bad request');

  const { chan, user, rec } = entry;
  if (DECAY_MS > 0 && rec.lastOffense && Date.now() - rec.lastOffense > DECAY_MS) {
    rec.count = 0;
  }
  rec.count += 1;
  rec.lastOffense = Date.now();
  db[chan][user] = rec;
  save();

  const seconds = durationFor(rec.count);
  console.log(`[next] ${chan}/${user} -> Verstoss #${rec.count} = ${seconds}s`);
  res.type('text/plain').send(String(seconds));
});

// Zeigt Zaehler + naechste Dauer OHNE hochzuzaehlen.
app.get('/status', (req, res) => {
  const entry = getEntry(req.query.chan, req.query.user);
  if (!entry) return res.status(400).type('text/plain').send('bad request');
  const { rec } = entry;
  const next = durationFor(rec.count + 1);
  res
    .type('text/plain')
    .send(`Verstoesse: ${rec.count} | naechster Timeout: ${next}s`);
});

// Setzt einen Nutzer zurueck.
app.get('/reset', (req, res) => {
  const entry = getEntry(req.query.chan, req.query.user);
  if (!entry) return res.status(400).type('text/plain').send('bad request');
  const { chan, user } = entry;
  if (db[chan]) delete db[chan][user];
  save();
  console.log(`[reset] ${chan}/${user} zurueckgesetzt`);
  res.type('text/plain').send('reset ok');
});

// Liefert alle bekannten Wiederholungstaeter eines Kanals als JSON.
// Das Chat-Fenster fragt das regelmaessig ab, um Nutzer farblich zu markieren.
app.get('/list', (req, res) => {
  const c = norm(req.query.chan);
  const out = {};
  for (const [user, rec] of Object.entries(db[c] || {})) {
    out[user] = { count: rec.count, lastOffense: rec.lastOffense };
  }
  res.json(out);
});

// Offizielle Twitch-Abzeichen fuer einen Kanal (global + kanaleigene Sub-Abzeichen).
// Antwort: { "set/version": "bild-url", ... }
app.get('/badges', async (req, res) => {
  if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) {
    return res.status(503).json({ error: 'Twitch nicht konfiguriert' });
  }
  try {
    const global = await getGlobalBadges();
    const channel = req.query.chan ? await getChannelBadges(req.query.chan) : {};
    res.json({ ...global, ...channel }); // kanaleigene ueberschreiben globale
  } catch (e) {
    console.error('[badges]', e.message);
    res.status(502).json({ error: e.message });
  }
});

app.get('/health', (_req, res) => res.type('text/plain').send('ok'));

app.listen(PORT, () => {
  console.log(`Repeat-Offender-API laeuft auf Port ${PORT} (Stufen: ${TIERS.join(', ')}s)`);
});
