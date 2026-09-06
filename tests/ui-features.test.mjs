import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [html, js, css, serviceWorker] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('app.js', root), 'utf8'),
  readFile(new URL('styles.css', root), 'utf8'),
  readFile(new URL('sw.js', root), 'utf8')
]);

test('the photo picker clearly supports selecting several images', () => {
  assert.match(html, /id="photo-input"[^>]*\bmultiple\b/);
  assert.match(html, /Ajouter une ou plusieurs photos/);
  assert.match(js, /for \(const file of fileList\)/);
});

test('saved photos open in an accessible zoomable viewer', () => {
  assert.match(html, /id="photo-viewer"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /id="photo-viewer-zoom-in"/);
  assert.match(html, /id="photo-viewer-zoom-out"/);
  assert.match(js, /openViewer\(url\)/);
  assert.match(js, /pointerDistance\(\)/);
  assert.match(css, /#photo-viewer-stage[\s\S]*touch-action: none/);
});

test('the offline cache version is refreshed for the PWA update', () => {
  assert.match(serviceWorker, /journal-v7/);
});

test('day cards use full weekday names instead of ambiguous abbreviations', () => {
  assert.match(js, /weekday: 'long'/);
  assert.doesNotMatch(js, /weekday: 'short'/);
  assert.match(css, /\.day-item-date[\s\S]*width: 72px/);
});

test('the date picker is initialized and remains legible on iPhone', () => {
  assert.match(js, /\$\('jump-date'\)\.value = state\.day/);
  assert.match(css, /#jump-date[\s\S]*-webkit-text-fill-color: var\(--text\)/);
});
