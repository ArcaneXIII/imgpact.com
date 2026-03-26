/**
 * Tests for window.TC utilities (tool-common.js).
 * Loads the source file into jsdom via window.eval to test the real implementation.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, test, expect, beforeAll } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(__dirname, '../../static/js/tool-common.js'), 'utf8');

beforeAll(() => {
  // Execute tool-common.js in the jsdom window scope so window.TC is defined
  window.eval(src);
});

// ─── formatFileSize ────────────────────────────────────────────────────────
describe('TC.formatFileSize', () => {
  test('0 → "0 B"',         () => expect(TC.formatFileSize(0)).toBe('0 B'));
  test('1 → "1 B"',         () => expect(TC.formatFileSize(1)).toBe('1 B'));
  test('999 → "999 B"',     () => expect(TC.formatFileSize(999)).toBe('999 B'));
  test('1024 → "1 KB"',     () => expect(TC.formatFileSize(1024)).toBe('1 KB'));
  test('1536 → "1.5 KB"',   () => expect(TC.formatFileSize(1536)).toBe('1.5 KB'));
  test('10240 → "10 KB"',   () => expect(TC.formatFileSize(10240)).toBe('10 KB'));
  test('1 MB',               () => expect(TC.formatFileSize(1048576)).toBe('1 MB'));
  test('1.5 MB',             () => expect(TC.formatFileSize(1572864)).toBe('1.5 MB'));
  test('1 GB',               () => expect(TC.formatFileSize(1073741824)).toBe('1 GB'));
  test('2.5 GB',             () => expect(TC.formatFileSize(2684354560)).toBe('2.5 GB'));
  test('BUG: 1 TB produces "1 undefined" (sizes array capped at GB)', () => {
    // sizes = ['B','KB','MB','GB'] — index 4 (TB) is undefined
    // Expected after fix: '1 TB'
    expect(TC.formatFileSize(1099511627776)).not.toMatch(/undefined/);
  });
});

// ─── showStats ─────────────────────────────────────────────────────────────
describe('TC.showStats', () => {
  function statsHtml(orig, result) {
    const el = document.createElement('div');
    document.body.appendChild(el);
    el.id = `stats-${orig}-${result}`;
    TC.showStats(el.id, orig, result);
    const html = el.innerHTML;
    el.remove();
    return html;
  }

  test('size reduction shows "−" sign', () => {
    // 1000 → 700: saved=300, pct=30.0 → displayed as "-30%"
    expect(statsHtml(1000, 700)).toContain('-30%');
  });

  test('size increase shows "+" sign', () => {
    // 700 → 1000: saved=-300, pct=-42.9 → displayed as "+42.9%"
    expect(statsHtml(700, 1000)).toContain('+42.9%');
  });

  test('no change shows "-0%"', () => {
    expect(statsHtml(1000, 1000)).toContain('-0%');
  });

  test('originalSize=0 does not divide by zero', () => {
    expect(() => statsHtml(0, 500)).not.toThrow();
  });

  test('output contains original and new sizes', () => {
    const html = statsHtml(2048, 1024);
    expect(html).toContain('2 KB');
    expect(html).toContain('1 KB');
  });
});

// ─── showToast ─────────────────────────────────────────────────────────────
describe('TC.showToast', () => {
  test('creates a toast element', () => {
    TC.showToast('Test message', 'info');
    const container = document.getElementById('toast-container');
    expect(container).not.toBeNull();
    expect(container.textContent).toContain('Test message');
  });

  test('applies type class (toast-error)', () => {
    TC.showToast('Error!', 'error');
    const toasts = document.querySelectorAll('.toast-error');
    expect(toasts.length).toBeGreaterThan(0);
  });

  test('applies type class (toast-success)', () => {
    TC.showToast('Done!', 'success');
    const toasts = document.querySelectorAll('.toast-success');
    expect(toasts.length).toBeGreaterThan(0);
  });
});

// ─── initFileUploader — acceptsFile logic ─────────────────────────────────
describe('TC.initFileUploader — file type acceptance', () => {
  function makeDropZone(accept = 'image/*') {
    const zone = document.createElement('div');
    zone.id = `zone-${Math.random().toString(36).slice(2)}`;
    document.body.appendChild(zone);
    const received = [];
    TC.initFileUploader(zone.id, (ab, file) => received.push(file), { accept });
    return { zone, received };
  }

  test('accepts image/png for accept="image/*"', async () => {
    const { zone, received } = makeDropZone('image/*');
    const file = new File(['data'], 'test.png', { type: 'image/png' });
    // Simulate file input change
    const input = zone.querySelector('input[type=file]');
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 50));
    expect(received).toHaveLength(1);
    zone.remove();
  });

  test('accepts .gif extension for accept=".gif"', async () => {
    const { zone, received } = makeDropZone('.gif');
    const file = new File(['data'], 'anim.gif', { type: 'image/gif' });
    const input = zone.querySelector('input[type=file]');
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 50));
    expect(received).toHaveLength(1);
    zone.remove();
  });

  test('rejects video/mp4 for accept="image/*" and shows toast', async () => {
    const { zone, received } = makeDropZone('image/*');
    const file = new File(['data'], 'video.mp4', { type: 'video/mp4' });
    const input = zone.querySelector('input[type=file]');
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 50));
    expect(received).toHaveLength(0);
    // Toast should have appeared
    const container = document.getElementById('toast-container');
    expect(container?.textContent).toContain('video.mp4');
    zone.remove();
  });
});
