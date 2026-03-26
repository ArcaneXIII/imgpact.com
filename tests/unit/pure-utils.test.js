/**
 * Tests for pure utility functions extracted from tool source files.
 * Each function is annotated with its origin file and line.
 * Tests both correct behavior and known bugs.
 */

import { describe, test, expect } from 'vitest';

// ─── getMimeType — wasm-bridge.js ──────────────────────────────────────────
function getMimeType(format) {
  const map = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp',
    ico: 'image/x-icon', tiff: 'image/tiff', tif: 'image/tiff',
    avif: 'image/avif', svg: 'image/svg+xml',
  };
  return map[(format || 'png').toLowerCase()] || 'application/octet-stream';
}

describe('getMimeType', () => {
  test('png → image/png',           () => expect(getMimeType('png')).toBe('image/png'));
  test('jpg → image/jpeg',          () => expect(getMimeType('jpg')).toBe('image/jpeg'));
  test('jpeg → image/jpeg',         () => expect(getMimeType('jpeg')).toBe('image/jpeg'));
  test('webp → image/webp',         () => expect(getMimeType('webp')).toBe('image/webp'));
  test('gif → image/gif',           () => expect(getMimeType('gif')).toBe('image/gif'));
  test('bmp → image/bmp',           () => expect(getMimeType('bmp')).toBe('image/bmp'));
  test('svg → image/svg+xml',       () => expect(getMimeType('svg')).toBe('image/svg+xml'));
  test('ico → image/x-icon',        () => expect(getMimeType('ico')).toBe('image/x-icon'));
  test('avif → image/avif',         () => expect(getMimeType('avif')).toBe('image/avif'));
  test('tiff → image/tiff',         () => expect(getMimeType('tiff')).toBe('image/tiff'));
  test('case-insensitive (PNG)',     () => expect(getMimeType('PNG')).toBe('image/png'));
  test('case-insensitive (WEBP)',    () => expect(getMimeType('WEBP')).toBe('image/webp'));
  test('undefined → default png',   () => expect(getMimeType(undefined)).toBe('image/png'));
  test('null → default png',        () => expect(getMimeType(null)).toBe('image/png'));
  test('unknown → octet-stream',    () => expect(getMimeType('xyz')).toBe('application/octet-stream'));
  test('"same" → octet-stream',     () => expect(getMimeType('same')).toBe('application/octet-stream'));
});

// ─── toU8 — wasm-bridge.js ────────────────────────────────────────────────
function toU8(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (input instanceof Blob) throw new Error('Pass an ArrayBuffer, not a Blob. Use blob.arrayBuffer() first.');
  throw new Error('Expected Uint8Array or ArrayBuffer');
}

describe('toU8', () => {
  test('Uint8Array passthrough — returns same reference', () => {
    const arr = new Uint8Array([1, 2, 3]);
    expect(toU8(arr)).toBe(arr);
  });
  test('ArrayBuffer → Uint8Array with correct bytes', () => {
    const buf = new Uint8Array([10, 20, 30]).buffer;
    const result = toU8(buf);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Array.from(result)).toEqual([10, 20, 30]);
  });
  test('Empty ArrayBuffer → empty Uint8Array', () => {
    expect(toU8(new ArrayBuffer(0))).toHaveLength(0);
  });
  test('Blob throws with helpful message', () => {
    expect(() => toU8(new Blob(['x']))).toThrow('Pass an ArrayBuffer, not a Blob');
  });
  test('string throws', () => {
    expect(() => toU8('hello')).toThrow('Expected Uint8Array or ArrayBuffer');
  });
  test('null throws', () => {
    expect(() => toU8(null)).toThrow('Expected Uint8Array or ArrayBuffer');
  });
  test('number throws', () => {
    expect(() => toU8(42)).toThrow('Expected Uint8Array or ArrayBuffer');
  });
});

// ─── resolveFormat — crop.js / resize.js / transform.js (correct) ─────────
function resolveFormat(sel, mimeType) {
  if (sel !== 'same') return sel;
  const map = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp' };
  return map[mimeType] || 'png';
}

// BUG version — optimize.js is missing 'image/gif' (line 177)
function resolveFormatOptimizeBug(sel, mimeType) {
  if (sel !== 'same') return sel;
  const map = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/bmp': 'bmp' };
  return map[mimeType] || 'png';
}

describe('resolveFormat', () => {
  test('"same" + image/jpeg → jpg',    () => expect(resolveFormat('same', 'image/jpeg')).toBe('jpg'));
  test('"same" + image/png → png',     () => expect(resolveFormat('same', 'image/png')).toBe('png'));
  test('"same" + image/webp → webp',   () => expect(resolveFormat('same', 'image/webp')).toBe('webp'));
  test('"same" + image/gif → gif',     () => expect(resolveFormat('same', 'image/gif')).toBe('gif'));
  test('"same" + image/bmp → bmp',     () => expect(resolveFormat('same', 'image/bmp')).toBe('bmp'));
  test('"same" + unknown → png (fallback)', () => expect(resolveFormat('same', 'image/tiff')).toBe('png'));
  test('explicit "jpg" ignores mime',  () => expect(resolveFormat('jpg', 'image/png')).toBe('jpg'));
  test('explicit "png" ignores mime',  () => expect(resolveFormat('png', 'image/jpeg')).toBe('png'));
  test('explicit "webp" ignores mime', () => expect(resolveFormat('webp', 'image/gif')).toBe('webp'));
});

describe('BUG: optimize.js resolveFormat — GIF silently falls back to PNG', () => {
  test('resolveFormatOptimizeBug("same", "image/gif") returns "png" instead of "gif"', () => {
    // Documents the bug: uploading a GIF + selecting "Same as input" outputs PNG
    expect(resolveFormatOptimizeBug('same', 'image/gif')).toBe('png'); // wrong — should be 'gif'
  });
});

// ─── replaceExt — optimize.js ─────────────────────────────────────────────
function replaceExt(filename, fmt) {
  const extMap = { jpg: 'jpg', jpeg: 'jpg', png: 'png', webp: 'webp', bmp: 'bmp' };
  const base = filename.replace(/\.[^.]+$/, '');
  return `${base}-optimized.${extMap[fmt] || fmt}`;
}

describe('replaceExt', () => {
  test('photo.jpg + jpg → photo-optimized.jpg',   () => expect(replaceExt('photo.jpg', 'jpg')).toBe('photo-optimized.jpg'));
  test('photo.jpeg + jpg → photo-optimized.jpg',  () => expect(replaceExt('photo.jpeg', 'jpg')).toBe('photo-optimized.jpg'));
  test('photo.png + png → photo-optimized.png',   () => expect(replaceExt('photo.png', 'png')).toBe('photo-optimized.png'));
  test('photo.webp + webp → photo-optimized.webp',() => expect(replaceExt('photo.webp', 'webp')).toBe('photo-optimized.webp'));
  test('anim.gif + gif → anim-optimized.gif (via fallback)', () => expect(replaceExt('anim.gif', 'gif')).toBe('anim-optimized.gif'));
  test('no extension → appends -optimized.ext',   () => expect(replaceExt('photo', 'png')).toBe('photo-optimized.png'));
  test('multiple dots → replaces only last ext',  () => expect(replaceExt('my.photo.jpg', 'png')).toBe('my.photo-optimized.png'));
  test('jpeg format key → jpg extension (normalized)', () => expect(replaceExt('f.jpeg', 'jpeg')).toBe('f-optimized.jpg'));
});

// ─── bufToBase64 — converters.js ──────────────────────────────────────────
// Current implementation (O(n²) string concat — slow for large frames)
function bufToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// Fixed implementation (chunked)
function bufToBase64Chunked(buffer) {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 8192;
  const parts = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
  }
  return btoa(parts.join(''));
}

describe('bufToBase64', () => {
  test('empty buffer → ""',          () => expect(bufToBase64(new ArrayBuffer(0))).toBe(''));
  test('"Hello" → "SGVsbG8="',       () => {
    const buf = new Uint8Array([72, 101, 108, 108, 111]).buffer;
    expect(bufToBase64(buf)).toBe('SGVsbG8=');
  });
  test('single null byte → "AA=="',  () => expect(bufToBase64(new Uint8Array([0]).buffer)).toBe('AA=='));
  test('[255,255,255] → "////"',      () => expect(bufToBase64(new Uint8Array([255, 255, 255]).buffer)).toBe('////'));
});

describe('bufToBase64Chunked — identical output to original', () => {
  test('empty buffer',  () => expect(bufToBase64Chunked(new ArrayBuffer(0))).toBe(bufToBase64(new ArrayBuffer(0))));
  test('"Hello"',       () => {
    const buf = new Uint8Array([72, 101, 108, 108, 111]).buffer;
    expect(bufToBase64Chunked(buf)).toBe(bufToBase64(buf));
  });
  test('large buffer (20 KB)',  () => {
    const big = new Uint8Array(20480).fill(42);
    expect(bufToBase64Chunked(big.buffer)).toBe(bufToBase64(big.buffer));
  });
  test('[0..255] all byte values', () => {
    const buf = new Uint8Array(Array.from({ length: 256 }, (_, i) => i)).buffer;
    expect(bufToBase64Chunked(buf)).toBe(bufToBase64(buf));
  });
});
