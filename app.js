'use strict';

/* ==================== Base de données ==================== */

const DB_NAME = 'journal';
const DB_VERSION = 1;
let dbPromise = null;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('moments')) {
          const store = db.createObjectStore('moments', { keyPath: 'id' });
          store.createIndex('day', 'day');
        }
        if (!db.objectStoreNames.contains('images')) {
          db.createObjectStore('images', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function prom(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbGetMomentsByDay(day) {
  const db = await openDB();
  const tx = db.transaction('moments');
  return prom(tx.objectStore('moments').index('day').getAll(day));
}

async function dbGetAllMoments() {
  const db = await openDB();
  return prom(db.transaction('moments').objectStore('moments').getAll());
}

async function dbGetMoment(id) {
  const db = await openDB();
  return prom(db.transaction('moments').objectStore('moments').get(id));
}

async function dbPutMoment(moment) {
  const db = await openDB();
  return prom(db.transaction('moments', 'readwrite').objectStore('moments').put(moment));
}

async function dbDeleteMoment(id) {
  const db = await openDB();
  return prom(db.transaction('moments', 'readwrite').objectStore('moments').delete(id));
}

async function dbGetImage(id) {
  const db = await openDB();
  return prom(db.transaction('images').objectStore('images').get(id));
}

async function dbGetAllImages() {
  const db = await openDB();
  return prom(db.transaction('images').objectStore('images').getAll());
}

async function dbPutImage(record) {
  const db = await openDB();
  return prom(db.transaction('images', 'readwrite').objectStore('images').put(record));
}

async function dbDeleteImage(id) {
  const db = await openDB();
  return prom(db.transaction('images', 'readwrite').objectStore('images').delete(id));
}

/* ==================== Utilitaires ==================== */

function newId() {
  return (crypto.randomUUID) ? crypto.randomUUID()
    : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function dayKey(date) {
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0');
}

function dateFromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function shiftDay(key, delta) {
  const d = dateFromKey(key);
  d.setDate(d.getDate() + delta);
  return dayKey(d);
}

function capFirst(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDayLong(key) {
  return capFirst(dateFromKey(key).toLocaleDateString('fr-CA',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
}

function formatTime(iso) {
  const d = new Date(iso);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function normalizeWithMap(s) {
  const chars = [];
  const map = [];
  for (let i = 0; i < s.length; i++) {
    const n = s[i].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    for (const c of n) { chars.push(c); map.push(i); }
  }
  return { norm: chars.join(''), map };
}

function normalize(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* Cache des URL d'affichage des images */
const imageUrls = new Map();

async function imageUrl(id) {
  if (imageUrls.has(id)) return imageUrls.get(id);
  const record = await dbGetImage(id);
  if (!record) return null;
  const url = URL.createObjectURL(record.blob);
  imageUrls.set(id, url);
  return url;
}

function forgetImageUrl(id) {
  const url = imageUrls.get(id);
  if (url) { URL.revokeObjectURL(url); imageUrls.delete(id); }
}

/* Réduction des photos avant enregistrement */
const MAX_IMAGE_SIZE = 1600;

function processImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      const scale = Math.min(1, MAX_IMAGE_SIZE / Math.max(width, height));
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('conversion impossible'));
      }, 'image/jpeg', 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image illisible')); };
    img.src = url;
  });
}

/* ==================== État ==================== */

const state = {
  day: dayKey(new Date()),   // journée affichée
  todayKey: dayKey(new Date()),
  tab: 'day'
};

const $ = id => document.getElementById(id);

/* ==================== Vue : journée ==================== */

async function renderDay() {
  state.todayKey = dayKey(new Date());
  const isToday = state.day === state.todayKey;

  $('day-title').textContent = isToday
    ? 'Aujourd’hui'
    : formatDayLong(state.day);
  $('btn-today').classList.toggle('hidden', isToday);
  $('btn-next-day').disabled = state.day >= state.todayKey;

  const moments = await dbGetMomentsByDay(state.day);
  moments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const list = $('moments-list');
  list.textContent = '';

  if (isToday && moments.length === 0) {
    list.appendChild(el('p', 'settings-note center', formatDayLong(state.day)));
  }

  for (const moment of moments) {
    list.appendChild(await buildMomentCard(moment));
  }
}

async function buildMomentCard(moment) {
  const card = el('article', 'moment-card');
  card.appendChild(el('span', 'time-badge', formatTime(moment.createdAt)));
  if (moment.text) card.appendChild(el('p', 'moment-text', moment.text));

  if (moment.imageIds && moment.imageIds.length) {
    const photos = el('div', 'moment-photos');
    for (const id of moment.imageIds) {
      const url = await imageUrl(id);
      if (!url) continue;
      const img = el('img');
      img.src = url;
      img.addEventListener('click', e => { e.stopPropagation(); openViewer(url); });
      photos.appendChild(img);
    }
    card.appendChild(photos);
  }

  card.addEventListener('click', () => openEditor(moment));
  return card;
}

function gotoDay(key) {
  state.day = key > dayKey(new Date()) ? dayKey(new Date()) : key;
  switchTab('day');
  renderDay();
}

/* ==================== Vue : liste des journées ==================== */

async function renderDays() {
  const moments = await dbGetAllMoments();
  const byDay = new Map();
  for (const m of moments) {
    if (!byDay.has(m.day)) byDay.set(m.day, []);
    byDay.get(m.day).push(m);
  }
  const days = [...byDay.keys()].sort().reverse();

  const list = $('days-list');
  list.textContent = '';
  let currentMonth = '';

  for (const day of days) {
    const date = dateFromKey(day);
    const month = date.toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' });
    if (month !== currentMonth) {
      currentMonth = month;
      list.appendChild(el('h2', 'month-header', month));
    }

    const dayMoments = byDay.get(day);
    dayMoments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const firstText = dayMoments.map(m => m.text).find(t => t) || '';
    const photoCount = dayMoments.reduce((n, m) => n + (m.imageIds ? m.imageIds.length : 0), 0);

    const item = el('div', 'day-item');
    const dateBox = el('div', 'day-item-date');
    dateBox.appendChild(el('span', 'd', String(date.getDate())));
    dateBox.appendChild(el('span', 'w', date.toLocaleDateString('fr-CA', { weekday: 'short' })));
    item.appendChild(dateBox);

    const body = el('div', 'day-item-body');
    const parts = [];
    parts.push(dayMoments.length === 1 ? '1 moment' : dayMoments.length + ' moments');
    if (photoCount) parts.push(photoCount === 1 ? '1 photo' : photoCount + ' photos');
    body.appendChild(el('div', 'day-item-count', parts.join(' · ')));
    if (firstText) body.appendChild(el('div', 'day-item-snippet', firstText));
    item.appendChild(body);

    item.addEventListener('click', () => gotoDay(day));
    list.appendChild(item);
  }
}

/* ==================== Vue : recherche ==================== */

let searchTimer = null;

async function renderSearch() {
  const query = normalize($('search-input').value.trim());
  const results = $('search-results');
  results.textContent = '';
  if (query.length < 2) return;

  const moments = await dbGetAllMoments();
  moments.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  for (const m of moments) {
    if (!m.text) continue;
    const { norm, map } = normalizeWithMap(m.text);
    const idx = norm.indexOf(query);
    if (idx < 0) continue;

    const start = map[idx];
    const end = map[idx + query.length - 1] + 1;

    const card = el('div', 'result-card');
    card.appendChild(el('div', 'result-date',
      formatDayLong(m.day) + ' · ' + formatTime(m.createdAt)));

    const textDiv = el('div', 'result-text');
    const from = Math.max(0, start - 60);
    if (from > 0) textDiv.appendChild(document.createTextNode('… '));
    textDiv.appendChild(document.createTextNode(m.text.slice(from, start)));
    textDiv.appendChild(el('mark', null, m.text.slice(start, end)));
    textDiv.appendChild(document.createTextNode(m.text.slice(end)));
    card.appendChild(textDiv);

    card.addEventListener('click', () => gotoDay(m.day));
    results.appendChild(card);
  }
}

/* ==================== Éditeur de moment ==================== */

/* editorState.photos : [{ id, url }] pour les photos déjà enregistrées,
   [{ blob, url }] pour les nouvelles */
let editorState = null;

async function openEditor(moment) {
  editorState = {
    id: moment ? moment.id : null,
    createdAt: moment ? moment.createdAt : new Date().toISOString(),
    day: moment ? moment.day : state.day,
    photos: [],
    removedIds: []
  };

  if (moment && moment.imageIds) {
    for (const id of moment.imageIds) {
      const url = await imageUrl(id);
      if (url) editorState.photos.push({ id, url });
    }
  }

  $('editor-text').value = moment ? moment.text : '';
  const dateInput = $('editor-date');
  dateInput.value = editorState.day;
  dateInput.max = dayKey(new Date());
  $('editor-time').textContent = formatTime(editorState.createdAt);
  $('editor-delete').classList.toggle('hidden', !moment);
  renderEditorPhotos();
  $('editor').classList.remove('hidden');
  if (!moment) $('editor-text').focus();
}

function renderEditorPhotos() {
  const zone = $('editor-photos');
  zone.textContent = '';
  editorState.photos.forEach((photo, i) => {
    const wrap = el('div', 'editor-photo');
    const img = el('img');
    img.src = photo.url;
    wrap.appendChild(img);
    const remove = el('button', 'remove', '✕');
    remove.setAttribute('aria-label', 'Retirer cette photo');
    remove.addEventListener('click', () => {
      if (photo.id) editorState.removedIds.push(photo.id);
      editorState.photos.splice(i, 1);
      renderEditorPhotos();
    });
    wrap.appendChild(remove);
    zone.appendChild(wrap);
  });
}

function closeEditor() {
  $('editor').classList.add('hidden');
  editorState = null;
}

async function saveEditor() {
  const text = $('editor-text').value.trim();
  const isNew = !editorState.id;

  if (isNew && !text && editorState.photos.length === 0) {
    closeEditor();
    return;
  }
  if (!isNew && !text && editorState.photos.length === 0) {
    return deleteFromEditor();
  }

  const imageIds = [];
  for (const photo of editorState.photos) {
    if (photo.id) {
      imageIds.push(photo.id);
    } else {
      const id = newId();
      await dbPutImage({ id, blob: photo.blob });
      imageUrls.set(id, photo.url);
      imageIds.push(id);
    }
  }
  for (const id of editorState.removedIds) {
    await dbDeleteImage(id);
    forgetImageUrl(id);
  }

  let day = $('editor-date').value;
  if (!day || day > dayKey(new Date())) day = editorState.day;

  await dbPutMoment({
    id: editorState.id || newId(),
    day,
    createdAt: editorState.createdAt,
    updatedAt: new Date().toISOString(),
    text,
    imageIds
  });

  closeEditor();
  // On affiche la page du jour où le moment a été rangé
  if (day !== state.day) state.day = day;
  renderDay();
}

async function deleteFromEditor() {
  if (!confirm('Supprimer ce moment ?')) return;
  const moment = await dbGetMoment(editorState.id);
  if (moment && moment.imageIds) {
    for (const id of moment.imageIds) {
      await dbDeleteImage(id);
      forgetImageUrl(id);
    }
  }
  await dbDeleteMoment(editorState.id);
  closeEditor();
  renderDay();
}

async function addPhotos(fileList) {
  for (const file of fileList) {
    try {
      const blob = await processImageFile(file);
      editorState.photos.push({ blob, url: URL.createObjectURL(blob) });
    } catch (err) {
      alert('Cette image n’a pas pu être ajoutée.');
    }
  }
  renderEditorPhotos();
}

/* ==================== Visionneuse ==================== */

function openViewer(url) {
  $('photo-viewer-img').src = url;
  $('photo-viewer').classList.remove('hidden');
}

/* ==================== Export / import ==================== */

const IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

function updateLastExportNote() {
  const iso = localStorage.getItem('lastExport');
  $('last-export').textContent = iso
    ? 'Dernier export : ' + new Date(iso).toLocaleDateString('fr-CA',
        { day: 'numeric', month: 'long', year: 'numeric' })
    : 'Aucun export pour l’instant.';
}

async function buildExportFile() {
  const moments = await dbGetAllMoments();
  moments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const images = await dbGetAllImages();

  const files = [];
  const imagesManifest = [];
  for (const record of images) {
    const type = record.blob.type || 'image/jpeg';
    const ext = IMAGE_EXT[type] || 'bin';
    const name = 'images/' + record.id + '.' + ext;
    files.push({ name, data: new Uint8Array(await record.blob.arrayBuffer()) });
    imagesManifest.push({ id: record.id, file: name, type });
  }

  const meta = {
    format: 'journal-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    moments,
    images: imagesManifest
  };
  files.unshift({ name: 'journal.json', data: new TextEncoder().encode(JSON.stringify(meta, null, 1)) });

  const zipBytes = Zip.create(files);
  const filename = 'journal-' + dayKey(new Date()) + '.zip';
  return new File([zipBytes], filename, { type: 'application/zip' });
}

async function exportJournal() {
  const btn = $('btn-export');
  btn.disabled = true;
  try {
    const file = await buildExportFile();

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
      } catch (err) {
        if (err.name === 'AbortError') return;   // partage annulé : pas d'export
        throw err;
      }
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    }

    localStorage.setItem('lastExport', new Date().toISOString());
    updateLastExportNote();
  } catch (err) {
    alert('L’export a échoué : ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

async function importJournal(file) {
  try {
    const entries = await Zip.read(await file.arrayBuffer());
    const metaBytes = entries.get('journal.json');
    if (!metaBytes) throw new Error('ce fichier n’est pas une sauvegarde du journal');
    const meta = JSON.parse(new TextDecoder().decode(metaBytes));
    if (meta.format !== 'journal-backup') throw new Error('ce fichier n’est pas une sauvegarde du journal');

    for (const imageMeta of meta.images || []) {
      const data = entries.get(imageMeta.file);
      if (!data) continue;
      const existing = await dbGetImage(imageMeta.id);
      if (!existing) {
        await dbPutImage({ id: imageMeta.id, blob: new Blob([data], { type: imageMeta.type }) });
      }
    }

    let added = 0, updated = 0;
    for (const moment of meta.moments || []) {
      if (!moment.id || !moment.day || !moment.createdAt) continue;
      const existing = await dbGetMoment(moment.id);
      if (!existing) {
        await dbPutMoment(moment);
        added++;
      } else if ((moment.updatedAt || '') > (existing.updatedAt || '')) {
        await dbPutMoment(moment);
        updated++;
      }
    }

    let message = 'Import terminé : ' + (added === 1 ? '1 moment ajouté' : added + ' moments ajoutés');
    if (updated) message += ', ' + (updated === 1 ? '1 mis à jour' : updated + ' mis à jour');
    alert(message + '.');
    renderDay();
    renderDays();
  } catch (err) {
    alert('L’import a échoué : ' + err.message);
  }
}

async function updateStorageInfo() {
  if (!navigator.storage || !navigator.storage.estimate) return;
  try {
    const { usage } = await navigator.storage.estimate();
    if (usage) {
      $('storage-info').textContent =
        'Espace utilisé : ' + (usage / 1048576).toFixed(1).replace('.', ',') + ' Mo';
    }
  } catch (err) { /* estimation indisponible */ }
}

/* ==================== Onglets et navigation ==================== */

function switchTab(tab) {
  state.tab = tab;
  $('view-day').classList.toggle('hidden', tab !== 'day');
  $('view-days').classList.toggle('hidden', tab !== 'days');
  $('view-search').classList.toggle('hidden', tab !== 'search');
  $('view-settings').classList.toggle('hidden', tab !== 'settings');
  $('btn-add').classList.toggle('hidden', tab !== 'day');
  document.querySelectorAll('#tabbar .tab').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));

  if (tab === 'day') renderDay();
  if (tab === 'days') renderDays();
  if (tab === 'search') { renderSearch(); $('search-input').focus(); }
  if (tab === 'settings') { updateLastExportNote(); updateStorageInfo(); }
  window.scrollTo(0, 0);
}

/* ==================== Initialisation ==================== */

function init() {
  document.querySelectorAll('#tabbar .tab').forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  $('btn-prev-day').addEventListener('click', () => { state.day = shiftDay(state.day, -1); renderDay(); });
  $('btn-next-day').addEventListener('click', () => { state.day = shiftDay(state.day, 1); renderDay(); });
  $('btn-today').addEventListener('click', () => { state.day = dayKey(new Date()); renderDay(); });

  $('btn-add').addEventListener('click', () => openEditor(null));
  $('editor-cancel').addEventListener('click', closeEditor);
  $('editor-save').addEventListener('click', saveEditor);
  $('editor-delete').addEventListener('click', deleteFromEditor);
  $('editor-add-photo').addEventListener('click', () => $('photo-input').click());
  $('photo-input').addEventListener('change', e => {
    if (e.target.files.length) addPhotos(e.target.files);
    e.target.value = '';
  });

  $('photo-viewer').addEventListener('click', () => $('photo-viewer').classList.add('hidden'));

  $('jump-date').addEventListener('change', e => { if (e.target.value) gotoDay(e.target.value); });
  $('jump-date').max = dayKey(new Date());

  $('search-input').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderSearch, 200);
  });

  $('btn-export').addEventListener('click', exportJournal);
  $('btn-import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', e => {
    if (e.target.files.length) importJournal(e.target.files[0]);
    e.target.value = '';
  });

  // Au retour dans l'app : si on suivait « aujourd'hui » et que la date a changé, on suit la nouvelle journée
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const today = dayKey(new Date());
      if (state.day === state.todayKey && today !== state.todayKey) {
        state.day = today;
      }
      if (state.tab === 'day') renderDay();
    }
  });

  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist();
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
  }

  renderDay();
}

init();
