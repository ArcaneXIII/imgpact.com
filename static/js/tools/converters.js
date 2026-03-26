/**
 * imgpact converters.js
 * Single ES module for all format conversion tool pages.
 * Reads data-from-format / data-to-format from #converter-root.
 */

import { convertImage } from '/static/js/wasm-bridge.js';

const root       = document.getElementById('converter-root');
const fromFormat = root.dataset.fromFormat;
const toFormat   = root.dataset.toFormat;

let originalAB   = null;
let originalFile = null;
let resultBlob   = null;

// ─── JXL / SVG notices ────────────────────────────────────────────────────
if (fromFormat === 'jxl' || toFormat === 'jxl') {
  document.getElementById('jxl-notice').style.display = '';
}
if (toFormat === 'svg') {
  document.getElementById('svg-out-notice').style.display = '';
}

// ─── Quality slider label ─────────────────────────────────────────────────
const qualityEl = document.getElementById('quality');
const qualLabelEl = document.getElementById('quality-label');
if (qualityEl) {
  qualityEl.addEventListener('input', () => {
    qualLabelEl.textContent = qualityEl.value;
  });
}

// ─── Upload ───────────────────────────────────────────────────────────────
TC.initFileUploader('upload-zone', (ab, file) => {
  originalAB   = ab;
  originalFile = file;
  resultBlob   = null;

  const infoBar = document.getElementById('file-info-bar');
  infoBar.style.display = 'flex';
  infoBar.innerHTML = `
    <span class="fi-name">${file.name}</span>
    <span class="fi-meta">${TC.formatFileSize(file.size)}</span>
  `;
  document.getElementById('tool-controls').classList.remove('hidden');
  document.getElementById('output-section').classList.add('hidden');
});

// ─── Convert ──────────────────────────────────────────────────────────────
document.getElementById('btn-convert').addEventListener('click', async () => {
  if (!originalAB) return;
  if (window.trackToolUse) trackToolUse('convert-' + (fromFormat || 'png'));
  const btn = document.getElementById('btn-convert');
  btn.disabled = true;

  TC.showSpinner('tool-controls');
  try {
    const quality = qualityEl ? parseInt(qualityEl.value) : 85;
    resultBlob = await doConvert(originalAB, originalFile, fromFormat, toFormat, quality);
    showOutput();
    TC.showToast(`Converted to ${toFormat.toUpperCase()}!`, 'success');
  } catch (err) {
    TC.showToast('Conversion failed: ' + err.message, 'error');
    console.error(err);
  } finally {
    TC.hideSpinner('tool-controls');
    btn.disabled = false;
  }
});

// ─── Conversion dispatch ──────────────────────────────────────────────────
async function doConvert(ab, file, from, to, quality) {

  // SVG → GIF: render SVG via canvas → RGBA → WASM GIF encoder
  if (from === 'svg' && to === 'gif') {
    return svgToGif(ab, file);
  }

  // GIF → SVG: embed frames as PNG data URIs in an SVG
  if (to === 'svg') {
    return gifToSvgEmbed(ab);
  }

  // JXL: try WASM first, fall back to browser canvas decode
  if (from === 'jxl' || to === 'jxl') {
    try {
      return await convertImage(ab, to, quality);
    } catch {
      TC.showToast('WASM JXL failed — trying browser decode…', 'info');
      return canvasDecode(ab, file, to, quality);
    }
  }

  // Standard WASM path
  return convertImage(ab, to, quality);
}

// ─── SVG → GIF via canvas ─────────────────────────────────────────────────
async function svgToGif(ab, file) {
  const { createGif } = await import('/static/js/wasm-bridge.js');
  const svgBlob = new Blob([ab], { type: 'image/svg+xml' });
  const url     = URL.createObjectURL(svgBlob);

  const img = await loadImage(url);
  URL.revokeObjectURL(url);

  const w = img.naturalWidth  || 400;
  const h = img.naturalHeight || 300;

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data.buffer;

  // Single frame GIF, 100ms delay
  return createGif([rgba], [100], w, h, 0);
}

// ─── GIF → SVG (embedded PNG frames) ─────────────────────────────────────
async function gifToSvgEmbed(ab) {
  const { splitGif, getGifInfo } = await import('/static/js/wasm-bridge.js');
  const [frames, info] = await Promise.all([splitGif(ab), getGifInfo(ab)]);

  const { width: w, height: h } = info;
  const totalDurMs = frames.reduce((s, f) => s + f.delay_ms, 0);

  // Build SVG with <image> elements per frame using SMIL animation
  let svgFrames = '';
  let timeMs = 0;
  for (const { blob, delay_ms, index } of frames) {
    const buf     = await blob.arrayBuffer();
    const b64     = bufToBase64(buf);
    const begin   = (timeMs / 1000).toFixed(3);
    const dur     = (delay_ms / 1000).toFixed(3);
    const visible = (delay_ms / totalDurMs);
    svgFrames += `
  <image href="data:image/png;base64,${b64}" width="${w}" height="${h}" x="0" y="0">
    <animate attributeName="opacity"
      values="1;1;0;0"
      keyTimes="0;${visible.toFixed(4)};${visible.toFixed(4)};1"
      dur="${(totalDurMs / 1000).toFixed(3)}s"
      begin="${begin}s"
      repeatCount="indefinite"/>
  </image>`;
    timeMs += delay_ms;
  }

  const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${svgFrames}\n</svg>`;
  return new Blob([svgStr], { type: 'image/svg+xml' });
}

function bufToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 8192;
  const parts = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
  }
  return btoa(parts.join(''));
}

// ─── Canvas decode fallback (for unsupported formats browser can decode) ──
async function canvasDecode(ab, file, toFormat, quality) {
  const blob = new Blob([ab], { type: file.type });
  const url  = URL.createObjectURL(blob);
  const img  = await loadImage(url);
  URL.revokeObjectURL(url);

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);

  const mimeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
  const mime    = mimeMap[toFormat] || 'image/png';

  return new Promise((res, rej) =>
    canvas.toBlob(b => b ? res(b) : rej(new Error('Canvas export failed')), mime, quality / 100)
  );
}

// ─── Show output ──────────────────────────────────────────────────────────
function showOutput() {
  const origBlob = new Blob([originalAB], { type: originalFile.type });
  TC.showBeforeAfter('before-after', origBlob, resultBlob);
  TC.showStats('stats-bar', originalFile.size, resultBlob.size);
  document.getElementById('output-section').classList.remove('hidden');

  const ext = toFormat === 'jpeg' ? 'jpg' : toFormat;
  document.getElementById('btn-download').onclick = () => {
    TC.downloadBlob(resultBlob, `imgpact-${fromFormat}-to-${toFormat}-${Date.now()}.${ext}`);
  };
}

// ─── Util ─────────────────────────────────────────────────────────────────
function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = src;
  });
}
