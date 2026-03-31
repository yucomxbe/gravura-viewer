#!/usr/bin/env node
/**
 * gravura-viewer/server.js
 * Express server that scans the Gravura output directory and exposes a
 * JSON API consumed by the SPA, plus file-serving for thumbnails and PDFs.
 */

import express           from 'express';
import path              from 'path';
import fs                from 'fs/promises';
import { fileURLToPath } from 'url';
import { config }        from 'dotenv';

// Load .env from the server's own directory (not from process CWD)
config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env') });

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const PORT        = parseInt(process.env.PORT        || '3333', 10);
const POSTERS_DIR = path.resolve(process.env.POSTERS_DIR || './output');
const STATE_FILE  = process.env.STATE_FILE ? path.resolve(process.env.STATE_FILE) : null;
const CACHE_TTL   = parseInt(process.env.CACHE_TTL   || '30000', 10);
const DAM_BASE    = (process.env.DAM_BASE_URL || '').replace(/\/$/, '');

// ── Known poster types (used for ordering + icon lookup in client) ─────────────
const KNOWN_TYPES  = ['map', 'satellite', 'layers', 'skymap', 'lunar', 'vintage'];
const SKIP_DIRS    = new Set(['mock', 'cache', '.cache', 'tmp']);

// ── Publish state reader ───────────────────────────────────────────────────────
async function readState() {
  if (!STATE_FILE) return {};
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// ── Directory scanner ──────────────────────────────────────────────────────────
let _cache     = null;
let _cacheTime = 0;

async function safeReaddir(dir) {
  try { return await fs.readdir(dir, { withFileTypes: true }); }
  catch { return []; }
}

async function safeStat(p) {
  try { return await fs.stat(p); }
  catch { return null; }
}

async function scan(force = false) {
  if (!force && _cache && (Date.now() - _cacheTime) < CACHE_TTL) return _cache;

  const state = await readState();
  const flat  = [];
  const tree  = {};          // tree[type][cc][city] = count

  const typeEntries = await safeReaddir(POSTERS_DIR);

  for (const typeEntry of typeEntries) {
    if (!typeEntry.isDirectory())         continue;
    const type = typeEntry.name;
    if (SKIP_DIRS.has(type.toLowerCase())) continue;

    const typeDir   = path.join(POSTERS_DIR, type);
    const ccEntries = await safeReaddir(typeDir);

    for (const ccEntry of ccEntries) {
      if (!ccEntry.isDirectory()) continue;
      const cc     = ccEntry.name.toUpperCase();
      const ccDir  = path.join(typeDir, ccEntry.name);
      const cities = await safeReaddir(ccDir);

      for (const cityEntry of cities) {
        if (!cityEntry.isDirectory()) continue;
        const city    = cityEntry.name;
        const cityDir = path.join(ccDir, city);
        const entries = await safeReaddir(cityDir);
        const names   = entries.filter(e => !e.isDirectory()).map(e => e.name);

        // Source PNGs: ends with .png but NOT -thumb.png
        const sources = names.filter(n => n.endsWith('.png') && !n.endsWith('-thumb.png'));

        for (const png of sources) {
          const relPath = `${type}/${ccEntry.name}/${city}/${png}`;
          const absPath = path.join(cityDir, png);
          const stat    = await safeStat(absPath);
          if (!stat) continue;

          const thumbName = png.replace(/\.png$/, '-thumb.png');
          const hasThumb  = names.includes(thumbName);

          // Match any PDF that starts with the same base name
          const base    = png.replace(/\.png$/, '');
          const pdfFile = names.find(n => n.endsWith('.pdf') && n.startsWith(base));

          // Match state — try key by dir or by full relative path
          const keyDir  = `${type}/${ccEntry.name}/${city}`;
          const keyFile = relPath;
          const se      = state[keyFile]
                       || (state[keyDir]?.source?.endsWith(png) ? state[keyDir] : null)
                       || null;

          const thumbRel = hasThumb ? `${type}/${ccEntry.name}/${city}/${thumbName}` : null;
          const pdfRel   = pdfFile  ? `${type}/${ccEntry.name}/${city}/${pdfFile}`   : null;

          flat.push({
            id:          relPath,
            type,
            cc,                                   // normalised uppercase
            city,
            filename:    png,
            path:        relPath,
            size:        stat.size,
            mtime:       stat.mtime.toISOString(),
            thumb:       thumbRel,
            pdf:         pdfRel,
            status:      se ? 'published' : 'pending',
            publishedAt: se?.publishedAt || null,
            damSource:   se?.source      ? (DAM_BASE ? `${DAM_BASE}/${se.source}` : se.source) : null,
            damThumb:    se?.thumb       ? (DAM_BASE ? `${DAM_BASE}/${se.thumb}`  : se.thumb)  : null,
            damPdf:      se?.pdf         ? (DAM_BASE ? `${DAM_BASE}/${se.pdf}`    : se.pdf)    : null,
          });

          if (!tree[type])             tree[type]          = {};
          if (!tree[type][cc])         tree[type][cc]       = {};
          if (!tree[type][cc][city])   tree[type][cc][city] = 0;
          tree[type][cc][city]++;
        }
      }
    }
  }

  // Sort flat: most recent first
  flat.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));

  // Sort tree keys by known order then alphabetically
  const sortedTree = {};
  const orderedTypes = [
    ...KNOWN_TYPES.filter(t => tree[t]),
    ...Object.keys(tree).filter(t => !KNOWN_TYPES.includes(t)).sort(),
  ];
  for (const t of orderedTypes) {
    sortedTree[t] = {};
    for (const cc of Object.keys(tree[t]).sort()) {
      sortedTree[t][cc] = {};
      for (const city of Object.keys(tree[t][cc]).sort()) {
        sortedTree[t][cc][city] = tree[t][cc][city];
      }
    }
  }

  const stats = {
    total:     flat.length,
    published: flat.filter(p => p.status === 'published').length,
    pending:   flat.filter(p => p.status === 'pending').length,
    withThumb: flat.filter(p => p.thumb).length,
    withPdf:   flat.filter(p => p.pdf).length,
    types:     [...new Set(flat.map(p => p.type))],
    countries: [...new Set(flat.map(p => p.cc))].length,
    cities:    [...new Set(flat.map(p => `${p.cc}/${p.city}`))].length,
    lastScan:  new Date().toISOString(),
  };

  _cache     = { tree: sortedTree, flat, stats };
  _cacheTime = Date.now();
  return _cache;
}

// ── Express app ────────────────────────────────────────────────────────────────
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Serve a poster file (PNG, thumb, PDF) with path-traversal protection.
 * Route: GET /serve/:relpath(*)
 */
app.get('/serve/:relpath(*)', async (req, res) => {
  const raw  = req.params.relpath || '';
  // Normalise separators, strip leading traversals
  const safe = path.posix.normalize(raw).replace(/^(\.\.[\\/])+/, '');
  const abs  = path.join(POSTERS_DIR, safe);

  // Ensure the resolved path stays inside POSTERS_DIR
  const root = POSTERS_DIR.endsWith(path.sep) ? POSTERS_DIR : POSTERS_DIR + path.sep;
  if (!abs.startsWith(root) && abs !== POSTERS_DIR) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    await fs.access(abs);
    res.sendFile(abs);
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

/**
 * Full scan: returns { tree, flat, stats }
 * Query param ?refresh=1 forces a cache bust.
 */
app.get('/api/scan', async (req, res) => {
  try {
    const data = await scan(!!req.query.refresh);
    res.json(data);
  } catch (e) {
    console.error('Scan error:', e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * Stats only (lightweight, still uses the same cache).
 */
app.get('/api/stats', async (req, res) => {
  try {
    const data = await scan();
    res.json(data.stats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  const pad = s => s.padEnd(41);
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log(`║  ${pad('GRAVURA VIEWER')}║`);
  console.log(`║  ${pad(`→ http://localhost:${PORT}`)}║`);
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  ${pad(`Posters : ${POSTERS_DIR}`)}║`);
  console.log(`║  ${pad(`State   : ${STATE_FILE || '(not configured)'}`)}║`);
  console.log(`║  ${pad(`Cache   : ${CACHE_TTL / 1000}s TTL`)}║`);
  console.log('╚══════════════════════════════════════════════╝\n');
});
