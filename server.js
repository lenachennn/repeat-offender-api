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

const app = express();
app.set('trust proxy', true);

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

app.get('/health', (_req, res) => res.type('text/plain').send('ok'));

app.listen(PORT, () => {
  console.log(`Repeat-Offender-API laeuft auf Port ${PORT} (Stufen: ${TIERS.join(', ')}s)`);
});
