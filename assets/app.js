/**
 * gravura-viewer/assets/app.js
 * SPA logic — PHP backend version.
 * API:  api.php          (scan)
 * Files: serve.php?f=    (PNG / thumb / PDF)
 */

// Build a URL to serve a poster file via serve.php
function serveUrl(relPath) {
  return 'serve.php?f=' + encodeURIComponent(relPath);
}

// ── Config ────────────────────────────────────────────────────────────────────
const PAGE_SIZE = 24;

const TYPE_ICONS = {
  map:       '🗺',
  satellite: '🛰',
  skymap:    '✨',
  vintage:   '🎨',
};

// ── App state ─────────────────────────────────────────────────────────────────
const state = {
  data:    null,   // { tree, flat, stats }
  filter:  { type: null, cc: null, city: null, status: '', search: '' },
  sort:    'mtime',
  view:    'grid',
  page:    0,
};

// Posters currently displayed (after filter+sort), for modal navigation
let visiblePosters = [];
let modalIndex     = -1;

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  loadData();
});

// ── Data loading ──────────────────────────────────────────────────────────────
async function loadData(refresh = false) {
  showLoader(true);
  try {
    const res  = await fetch(`api.php${refresh ? '?refresh=1' : ''}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
    renderAll();
  } catch (e) {
    showLoader(false);
    showEmptyState(`Error loading data: ${e.message}`);
  }
}

// ── Full render ───────────────────────────────────────────────────────────────
function renderAll() {
  showLoader(false);
  renderStats();
  renderSidebar();
  renderBreadcrumb();
  renderGrid();
}

// ── Stats bar ─────────────────────────────────────────────────────────────────
function renderStats() {
  const s  = state.data.stats;
  const el = document.getElementById('stats-bar');
  el.innerHTML = `
    <span class="stat">${s.total} <em>posters</em></span>
    <span class="sep">·</span>
    <span class="stat pub">${s.published} <em>published</em></span>
    <span class="sep">·</span>
    <span class="stat">${s.pending} <em>pending</em></span>
    <span class="sep">·</span>
    <span class="stat">${s.cities} <em>cities</em></span>
  `;
}

// ── Sidebar tree ──────────────────────────────────────────────────────────────
function renderSidebar() {
  const { tree, flat }         = state.data;
  const { type: fType, cc: fCC, city: fCity } = state.filter;
  let html = '';

  for (const [type, countries] of Object.entries(tree)) {
    const count       = flat.filter(p => p.type === type).length;
    const isTypeActive = fType === type;
    const isExpanded   = isTypeActive;

    html += `
      <div class="tree-section">
        <div class="tree-type-row ${isTypeActive && !fCC ? 'active' : ''}"
             onclick="onTreeType('${type}')">
          <span class="tree-toggle ${isExpanded ? 'open' : ''}" id="tog-${type}">▶</span>
          <span class="tree-type-icon">${TYPE_ICONS[type] || '📁'}</span>
          <span class="tree-dot dot-${type}"></span>
          <span class="tree-label">${type}</span>
          <span class="tree-count">${count}</span>
        </div>
        <div class="tree-cc-children ${isExpanded ? 'open' : ''}" id="cc-${type}">
          ${renderCCNodes(type, countries, fType, fCC, fCity, flat)}
        </div>
      </div>`;
  }

  document.getElementById('sidebar-tree').innerHTML = html;
}

function renderCCNodes(type, countries, fType, fCC, fCity, flat) {
  let html = '';
  for (const [cc, cities] of Object.entries(countries)) {
    const ccCount    = flat.filter(p => p.type === type && p.cc === cc).length;
    const isCCActive = fType === type && fCC === cc;
    const ccExpanded = isCCActive;

    html += `
      <div class="tree-cc-row ${isCCActive && !fCity ? 'active' : ''}"
           onclick="onTreeCC('${type}','${cc}')">
        <span class="tree-flag">${ccFlag(cc)}</span>
        <span class="tree-label">${cc}</span>
        <span class="tree-count">${ccCount}</span>
      </div>
      <div class="tree-city-children ${ccExpanded ? 'open' : ''}" id="city-${type}-${cc}">
        ${renderCityNodes(type, cc, cities, fType, fCC, fCity, flat)}
      </div>`;
  }
  return html;
}

function renderCityNodes(type, cc, cities, fType, fCC, fCity, flat) {
  let html = '';
  for (const [city, _count] of Object.entries(cities)) {
    const cityCount   = flat.filter(p => p.type === type && p.cc === cc && p.city === city).length;
    const isCityActive = fType === type && fCC === cc && fCity === city;

    html += `
      <div class="tree-city-row ${isCityActive ? 'active' : ''}"
           onclick="onTreeCity('${type}','${cc}','${city}')">
        <span class="tree-label">${capitalize(city)}</span>
        <span class="tree-count">${cityCount}</span>
      </div>`;
  }
  return html;
}

// ── Breadcrumb ────────────────────────────────────────────────────────────────
function renderBreadcrumb() {
  const { type, cc, city } = state.filter;
  const el = document.getElementById('breadcrumb');

  const parts = [{ label: 'All', action: clearFilter }];
  if (type) {
    parts.push({
      label: `<span class="bc-dot dot-${type}"></span> ${type}`,
      action: () => { state.filter = { ...state.filter, cc: null, city: null }; resetPage(); renderAll(); },
    });
  }
  if (cc) {
    parts.push({
      label: `${ccFlag(cc)} ${cc}`,
      action: () => { state.filter = { ...state.filter, city: null }; resetPage(); renderAll(); },
    });
  }
  if (city) {
    parts.push({ label: capitalize(city), action: null });
  }

  el.innerHTML = parts.map((p, i) => {
    const isLast   = i === parts.length - 1;
    const sep      = i > 0 ? `<span class="bc-sep">/</span>` : '';
    const cls      = isLast ? 'bc-item active' : 'bc-item';
    const onclick  = p.action ? `onclick="(${p.action.toString()})()"` : '';
    return `${sep}<span class="${cls}" ${onclick}>${p.label}</span>`;
  }).join('');
}

// ── Filter + sort ─────────────────────────────────────────────────────────────
function getFiltered() {
  const { type, cc, city, status, search } = state.filter;
  const q = search.trim().toLowerCase();

  return state.data.flat.filter(p => {
    if (type   && p.type   !== type)   return false;
    if (cc     && p.cc     !== cc)     return false;
    if (city   && p.city   !== city)   return false;
    if (status && p.status !== status) return false;
    if (q) {
      const hay = `${p.filename} ${p.city} ${p.cc} ${p.type}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function getSorted(arr) {
  const copy = [...arr];
  switch (state.sort) {
    case 'name': return copy.sort((a, b) => a.filename.localeCompare(b.filename));
    case 'size': return copy.sort((a, b) => b.size - a.size);
    default:     return copy.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
  }
}

// ── Grid / list render ────────────────────────────────────────────────────────
function renderGrid() {
  const filtered = getSorted(getFiltered());
  visiblePosters = filtered;

  const total    = filtered.length;
  const pages    = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (state.page >= pages) state.page = 0;

  const slice = filtered.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);

  // Count label
  document.getElementById('count-label').textContent =
    total === state.data.flat.length
      ? `${total} posters`
      : `${total} / ${state.data.flat.length}`;

  const grid = document.getElementById('poster-grid');
  grid.className = state.view === 'list' ? 'list-view' : 'grid-view';

  if (total === 0) {
    grid.innerHTML = '';
    showEmptyState();
    renderPagination(0, 0);
    return;
  }

  document.getElementById('empty-state').classList.add('hidden');
  grid.innerHTML = state.view === 'list'
    ? slice.map((p, i) => listRowHTML(p, state.page * PAGE_SIZE + i)).join('')
    : slice.map((p, i) => gridCardHTML(p, state.page * PAGE_SIZE + i)).join('');

  // Lazy load images
  grid.querySelectorAll('img[data-src]').forEach(img => {
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        img.src = img.dataset.src;
        img.classList.remove('loading');
        observer.disconnect();
      }
    }, { rootMargin: '200px' });
    observer.observe(img);
  });

  renderPagination(total, pages);
}

// ── Grid card HTML ────────────────────────────────────────────────────────────
function gridCardHTML(p, idx) {
  const thumb      = p.thumb ? serveUrl(p.thumb) : null;
  const badgeCls   = `card-type-badge type-${p.type}`;
  const statusCls  = `card-status-dot ${p.status}`;

  const thumbContent = thumb
    ? `<img class="loading" data-src="${esc(thumb)}" alt="${esc(p.city)}" onload="this.classList.remove('loading')">`
    : `<div class="no-thumb"><span class="type-emoji">${TYPE_ICONS[p.type] || '📁'}</span><span>No thumb</span></div>`;

  const pdfBtn = p.pdf
    ? `<button class="card-action-btn pdf" onclick="event.stopPropagation();openPdf('${esc(p.pdf)}','${esc(p.filename)}')">PDF</button>`
    : '';

  const pngBtn = `<a class="card-action-btn" href="${serveUrl(p.path)}" target="_blank" onclick="event.stopPropagation()">PNG</a>`;

  return `
    <div class="poster-card" onclick="openModal(${idx})">
      <div class="card-thumb">
        ${thumbContent}
        <span class="${badgeCls}">${p.type}</span>
        <span class="${statusCls}" title="${p.status}"></span>
        <div class="card-hover-actions">${pdfBtn}${pngBtn}</div>
      </div>
      <div class="card-body">
        <div class="card-city">
          ${ccFlag(p.cc)} ${capitalize(p.city)}
          <span class="card-cc-pill">${p.cc}</span>
        </div>
        <div class="card-meta">${formatBytes(p.size)} · ${formatDate(p.mtime)}</div>
      </div>
    </div>`;
}

// ── List row HTML ─────────────────────────────────────────────────────────────
function listRowHTML(p, idx) {
  const thumb = p.thumb ? serveUrl(p.thumb) : null;

  const thumbEl = thumb
    ? `<img data-src="${esc(thumb)}" alt="" onload="this.classList.remove('loading')" class="loading">`
    : `<span class="row-no-thumb">${TYPE_ICONS[p.type] || '📁'}</span>`;

  const pdfIcon = p.pdf
    ? `<button class="row-icon-btn" title="View PDF" onclick="event.stopPropagation();openPdf('${esc(p.pdf)}','${esc(p.filename)}')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
       </button>`
    : '';

  return `
    <div class="poster-row" onclick="openModal(${idx})">
      <div class="row-thumb">${thumbEl}</div>
      <span class="row-type-badge type-${p.type}">${p.type}</span>
      <span class="row-cc">${p.cc}</span>
      <span class="row-city">${ccFlag(p.cc)} ${capitalize(p.city)}</span>
      <span class="row-filename" title="${esc(p.filename)}">${p.filename}</span>
      <span class="row-size">${formatBytes(p.size)}</span>
      <span class="row-date">${formatDate(p.mtime)}</span>
      <div class="row-status"><span class="row-status-dot ${p.status}" title="${p.status}"></span></div>
      <div class="row-icons">
        <a class="row-icon-btn" href="${serveUrl(p.path)}" target="_blank" title="Open PNG" onclick="event.stopPropagation()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><path d="M10 14 21 3"/><path d="M21 15v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>
        </a>
        ${pdfIcon}
      </div>
    </div>`;
}

// ── Pagination ────────────────────────────────────────────────────────────────
function renderPagination(total, pages) {
  const el = document.getElementById('pagination');
  if (pages <= 1) { el.innerHTML = ''; return; }

  const cur   = state.page;
  const range = buildPageRange(cur, pages);

  el.innerHTML = `
    <button class="page-btn" onclick="goPage(${cur - 1})" ${cur === 0 ? 'disabled' : ''}>‹</button>
    ${range.map(p =>
      p === '…'
        ? `<span class="page-ellipsis">…</span>`
        : `<button class="page-btn ${p === cur ? 'active' : ''}" onclick="goPage(${p})">${p + 1}</button>`
    ).join('')}
    <button class="page-btn" onclick="goPage(${cur + 1})" ${cur >= pages - 1 ? 'disabled' : ''}>›</button>
  `;
}

function buildPageRange(cur, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  const pages = new Set([0, total - 1, cur]);
  for (let i = Math.max(0, cur - 1); i <= Math.min(total - 1, cur + 1); i++) pages.add(i);
  const sorted = [...pages].sort((a, b) => a - b);
  const result = [];
  let prev = -1;
  for (const p of sorted) {
    if (p - prev > 1) result.push('…');
    result.push(p);
    prev = p;
  }
  return result;
}

function goPage(p) {
  state.page = p;
  renderGrid();
  document.getElementById('content-area').scrollTop = 0;
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openModal(idx) {
  modalIndex = idx;
  const p    = visiblePosters[idx];
  if (!p) return;

  const modal = document.getElementById('modal');
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  renderModalContent(p);
}

function renderModalContent(p) {
  // Title
  document.getElementById('modal-title').textContent = p.filename;

  // Preview image
  const img  = document.getElementById('preview-img');
  const ph   = document.getElementById('preview-placeholder');
  const wrap = document.getElementById('preview-img-wrap');

  if (p.thumb) {
    img.src = serveUrl(p.thumb);
    img.classList.remove('hidden');
    ph.classList.add('hidden');
  } else {
    img.src = '';
    img.classList.add('hidden');
    ph.classList.remove('hidden');
  }

  // File metadata
  document.getElementById('meta-file').innerHTML = `
    <tr><td>Type</td>    <td><span class="card-type-badge type-${p.type}" style="position:static;font-size:10px">${p.type}</span></td></tr>
    <tr><td>Country</td> <td>${ccFlag(p.cc)} <strong>${p.cc}</strong></td></tr>
    <tr><td>City</td>    <td>${capitalize(p.city)}</td></tr>
    <tr><td>File</td>    <td class="meta-mono">${p.filename}</td></tr>
    <tr><td>Size</td>    <td>${formatBytes(p.size)}</td></tr>
    <tr><td>Modified</td><td>${formatDateFull(p.mtime)}</td></tr>
    <tr><td>Thumb</td>   <td>${p.thumb ? '✓' : '—'}</td></tr>
    <tr><td>PDF</td>     <td>${p.pdf ? '✓' : '—'}</td></tr>
  `;

  // Publish metadata
  document.getElementById('meta-publish').innerHTML = `
    <tr>
      <td>Status</td>
      <td>
        <span class="status-badge">
          <span class="status-dot ${p.status}"></span>
          ${p.status === 'published' ? 'Published' : 'Pending'}
        </span>
      </td>
    </tr>
    <tr><td>Published</td><td>${p.publishedAt ? formatDateFull(p.publishedAt) : '—'}</td></tr>
  `;

  // DAM URLs
  const damSec = document.getElementById('meta-dam-section');
  const damEl  = document.getElementById('meta-dam');
  if (p.damSource || p.damThumb || p.damPdf) {
    damSec.classList.remove('hidden');
    let links = '';
    if (p.damSource) links += damLinkHTML('PNG',   p.damSource);
    if (p.damThumb)  links += damLinkHTML('Thumb', p.damThumb);
    if (p.damPdf)    links += damLinkHTML('PDF',   p.damPdf);
    damEl.innerHTML = links;
  } else {
    damSec.classList.add('hidden');
  }

  // Footer buttons
  document.getElementById('btn-open-png').onclick   = () => window.open(serveUrl(p.path), '_blank');
  document.getElementById('btn-open-thumb').disabled = !p.thumb;
  document.getElementById('btn-open-thumb').onclick  = () => p.thumb && window.open(serveUrl(p.thumb), '_blank');
  document.getElementById('btn-open-pdf').disabled   = !p.pdf;
  document.getElementById('btn-open-pdf').onclick    = () => p.pdf && openPdf(p.pdf, p.filename);

  // Prev/next arrows
  document.getElementById('modal-prev').disabled = modalIndex <= 0;
  document.getElementById('modal-next').disabled = modalIndex >= visiblePosters.length - 1;
}

function damLinkHTML(label, url) {
  return `
    <a class="dam-link" href="${esc(url)}" target="_blank">
      <span class="dam-label">${label}</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${url}</span>
    </a>`;
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  document.body.style.overflow = '';
}

// ── PDF viewer ────────────────────────────────────────────────────────────────
function openPdf(relPath, filename) {
  const modal = document.getElementById('pdf-modal');
  const iframe = document.getElementById('pdf-iframe');
  const title  = document.getElementById('pdf-modal-title');
  const dlBtn  = document.getElementById('pdf-download-btn');

  iframe.src = serveUrl(relPath);
  title.textContent = filename || relPath;
  dlBtn.href = serveUrl(relPath);
  dlBtn.download = (filename || relPath).replace(/\.png$/, '.pdf');

  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closePdfModal() {
  const modal  = document.getElementById('pdf-modal');
  const iframe = document.getElementById('pdf-iframe');
  modal.classList.add('hidden');
  iframe.src = '';
  // Only restore body scroll if poster modal is also closed
  if (document.getElementById('modal').classList.contains('hidden')) {
    document.body.style.overflow = '';
  }
}

// ── Tree navigation ───────────────────────────────────────────────────────────
function onTreeType(type) {
  const isActive = state.filter.type === type;
  if (isActive) {
    // Second click: collapse / deselect
    state.filter = { type: null, cc: null, city: null, status: state.filter.status, search: state.filter.search };
  } else {
    state.filter = { ...state.filter, type, cc: null, city: null };
    // Toggle expansion
    const ccDiv  = document.getElementById(`cc-${type}`);
    const togEl  = document.getElementById(`tog-${type}`);
    if (ccDiv) {
      const willOpen = !ccDiv.classList.contains('open');
      ccDiv.classList.toggle('open');
      if (togEl) togEl.classList.toggle('open', willOpen);
    }
  }
  resetPage();
  renderAll();
}

function onTreeCC(type, cc) {
  const isActive = state.filter.type === type && state.filter.cc === cc;
  if (isActive) {
    state.filter = { ...state.filter, cc: null, city: null };
  } else {
    state.filter = { ...state.filter, type, cc, city: null };
    const cityDiv = document.getElementById(`city-${type}-${cc}`);
    if (cityDiv) cityDiv.classList.toggle('open', true);
  }
  resetPage();
  renderAll();
}

function onTreeCity(type, cc, city) {
  const isActive = state.filter.type === type && state.filter.cc === cc && state.filter.city === city;
  if (isActive) {
    state.filter = { ...state.filter, city: null };
  } else {
    state.filter = { ...state.filter, type, cc, city };
  }
  resetPage();
  renderAll();
}

function clearFilter() {
  state.filter = { type: null, cc: null, city: null, status: state.filter.status, search: state.filter.search };
  resetPage();
  renderAll();
}

function resetPage() { state.page = 0; }

// ── Events ────────────────────────────────────────────────────────────────────
function bindEvents() {
  // Search
  let searchTimer;
  document.getElementById('search').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.filter.search = e.target.value;
      resetPage();
      if (state.data) renderGrid();
    }, 180);
  });

  // Keyboard shortcut ⌘K / Ctrl+K → focus search
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      document.getElementById('search').focus();
    }
    // Close modals
    if (e.key === 'Escape') {
      if (!document.getElementById('pdf-modal').classList.contains('hidden')) {
        closePdfModal(); return;
      }
      if (!document.getElementById('modal').classList.contains('hidden')) {
        closeModal(); return;
      }
    }
    // Modal navigation
    if (!document.getElementById('modal').classList.contains('hidden')) {
      if (e.key === 'ArrowLeft'  && modalIndex > 0)                    { openModal(modalIndex - 1); }
      if (e.key === 'ArrowRight' && modalIndex < visiblePosters.length - 1) { openModal(modalIndex + 1); }
    }
    // Shortcut R = refresh
    if (e.key === 'r' && !e.metaKey && !e.ctrlKey &&
        document.activeElement.tagName !== 'INPUT') {
      doRefresh();
    }
    // Shortcut G = grid, L = list
    if (e.key === 'g' && document.activeElement.tagName !== 'INPUT') setView('grid');
    if (e.key === 'l' && document.activeElement.tagName !== 'INPUT') setView('list');
  });

  // Status filter
  document.getElementById('status-filter').addEventListener('change', e => {
    state.filter.status = e.target.value;
    resetPage();
    if (state.data) renderGrid();
  });

  // Sort
  document.getElementById('sort-select').addEventListener('change', e => {
    state.sort = e.target.value;
    resetPage();
    if (state.data) renderGrid();
  });

  // View toggle
  document.getElementById('view-toggle').addEventListener('click', e => {
    const btn = e.target.closest('.view-btn');
    if (!btn) return;
    setView(btn.dataset.view);
  });

  // All button
  document.getElementById('all-btn').addEventListener('click', clearFilter);

  // Refresh button
  document.getElementById('refresh-btn').addEventListener('click', doRefresh);

  // Modal close
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-backdrop').addEventListener('click', closeModal);
  document.getElementById('modal-prev').addEventListener('click', () => openModal(modalIndex - 1));
  document.getElementById('modal-next').addEventListener('click', () => openModal(modalIndex + 1));

  // PDF modal close
  document.getElementById('pdf-close').addEventListener('click', closePdfModal);
  document.getElementById('pdf-backdrop').addEventListener('click', closePdfModal);
}

function setView(v) {
  state.view = v;
  document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  if (state.data) renderGrid();
}

async function doRefresh() {
  const btn = document.getElementById('refresh-btn');
  btn.classList.add('refreshing');
  _cache = null;
  await loadData(true);
  btn.classList.remove('refreshing');
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function showLoader(on) {
  document.getElementById('loading-state').classList.toggle('hidden', !on);
  document.getElementById('poster-grid').classList.toggle('hidden', on);
}

function showEmptyState(msg) {
  const el = document.getElementById('empty-state');
  el.classList.remove('hidden');
  if (msg) el.querySelector('p').textContent = msg;
}

// ── Formatting ────────────────────────────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024)      return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateFull(iso) {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ') : s;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
}

function ccFlag(cc) {
  if (!cc || cc.length < 2) return '🏳';
  try {
    const a = cc.toUpperCase().charCodeAt(0) - 65 + 0x1F1E6;
    const b = cc.toUpperCase().charCodeAt(1) - 65 + 0x1F1E6;
    return String.fromCodePoint(a) + String.fromCodePoint(b);
  } catch { return '🏳'; }
}

// Expose globals called from inline HTML onclick handlers
window.openModal  = openModal;
window.openPdf    = openPdf;
window.closeModal = closeModal;
window.goPage     = goPage;
window.onTreeType = onTreeType;
window.onTreeCC   = onTreeCC;
window.onTreeCity = onTreeCity;
window.clearFilter = clearFilter;
