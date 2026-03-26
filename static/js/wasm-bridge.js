/**
 * imgpact wasm-bridge.js
 * Lazy-loads the WASM module and wraps every exported function with:
 *  - Uint8Array conversion from ArrayBuffer
 *  - Blob output (for preview/download)
 *  - console.time/timeEnd performance logging
 */

let wasmModule = null;

async function loadWasm() {
  if (wasmModule) return wasmModule;
  const mod = await import('/static/wasm/wasm_engine.js');
  await mod.default(); // runs wasm-bindgen init + our #[wasm_bindgen(start)] init()
  wasmModule = mod;
  return mod;
}

function getMimeType(format) {
  const map = {
    png:  'image/png',
    jpg:  'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif:  'image/gif',
    bmp:  'image/bmp',
    ico:  'image/x-icon',
    tiff: 'image/tiff',
    tif:  'image/tiff',
    avif: 'image/avif',
    svg:  'image/svg+xml',
  };
  return map[(format || 'png').toLowerCase()] || 'application/octet-stream';
}

function toU8(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (input instanceof Blob) throw new Error('Pass an ArrayBuffer, not a Blob. Use blob.arrayBuffer() first.');
  throw new Error('Expected Uint8Array or ArrayBuffer');
}

// ─── Crop ────────────────────────────────────────────────────────────────────

export async function cropImage(fileArrayBuffer, x, y, w, h, format = 'png') {
  const label = `cropImage ${w}×${h}`;
  console.time(label);
  const wasm = await loadWasm();
  const result = wasm.crop_image(toU8(fileArrayBuffer), x, y, w, h, format);
  console.timeEnd(label);
  return new Blob([result], { type: getMimeType(format) });
}

// ─── Resize ──────────────────────────────────────────────────────────────────

export async function resizeImage(fileArrayBuffer, width, height, maintainAspect = true, filter = 'lanczos3', format = 'png') {
  const label = `resizeImage ${width}×${height}`;
  console.time(label);
  const wasm = await loadWasm();
  const result = wasm.resize_image(toU8(fileArrayBuffer), width, height, maintainAspect, filter, format);
  console.timeEnd(label);
  return new Blob([result], { type: getMimeType(format) });
}

export async function getDimensions(fileArrayBuffer) {
  console.time('getDimensions');
  const wasm = await loadWasm();
  const result = wasm.get_dimensions(toU8(fileArrayBuffer));
  console.timeEnd('getDimensions');
  return result; // { width, height }
}

// ─── Transform ───────────────────────────────────────────────────────────────

export async function rotateImage(fileArrayBuffer, degrees, format = 'png') {
  const label = `rotateImage ${degrees}°`;
  console.time(label);
  const wasm = await loadWasm();
  const result = wasm.rotate_image(toU8(fileArrayBuffer), degrees, format);
  console.timeEnd(label);
  return new Blob([result], { type: getMimeType(format) });
}

export async function flipHorizontal(fileArrayBuffer, format = 'png') {
  console.time('flipHorizontal');
  const wasm = await loadWasm();
  const result = wasm.flip_horizontal(toU8(fileArrayBuffer), format);
  console.timeEnd('flipHorizontal');
  return new Blob([result], { type: getMimeType(format) });
}

export async function flipVertical(fileArrayBuffer, format = 'png') {
  console.time('flipVertical');
  const wasm = await loadWasm();
  const result = wasm.flip_vertical(toU8(fileArrayBuffer), format);
  console.timeEnd('flipVertical');
  return new Blob([result], { type: getMimeType(format) });
}

// ─── Canvas fallback decoder ──────────────────────────────────────────────────
// Used for formats the WASM engine cannot decode (AVIF, HEIC, TIFF in some cases).
// The browser decodes the image natively via an <img> element + Canvas,
// then we export PNG bytes which WASM can decode and re-encode to any target.

async function decodeViaCanvas(fileArrayBuffer) {
  return new Promise((resolve) => {
    const blob = new Blob([fileArrayBuffer]);
    const url  = URL.createObjectURL(blob);
    const img  = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob(b => {
        if (!b) { resolve(null); return; }
        b.arrayBuffer().then(resolve).catch(() => resolve(null));
      }, 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

// ─── Convert ─────────────────────────────────────────────────────────────────

export async function convertImage(fileArrayBuffer, toFormat, quality = 85) {
  const label = `convertImage → ${toFormat}`;
  console.time(label);
  const wasm = await loadWasm();
  let result = wasm.convert_image(toU8(fileArrayBuffer), toFormat, quality);

  // WASM can't decode AVIF/HEIC/some TIFF — fall back to browser Canvas decoder
  if (result.length === 0) {
    const pngBuffer = await decodeViaCanvas(fileArrayBuffer);
    if (pngBuffer) {
      result = wasm.convert_image(toU8(pngBuffer), toFormat, quality);
    }
  }

  console.timeEnd(label);
  if (result.length === 0) throw new Error('Conversion failed');
  return new Blob([result], { type: getMimeType(toFormat) });
}

export async function getImageInfo(fileArrayBuffer) {
  console.time('getImageInfo');
  const wasm = await loadWasm();
  let result = wasm.get_image_info(toU8(fileArrayBuffer));
  // Fallback: if WASM can't read the format, use Canvas to get dimensions
  if (!result || result.width === 0) {
    const pngBuffer = await decodeViaCanvas(fileArrayBuffer);
    if (pngBuffer) result = wasm.get_image_info(toU8(pngBuffer));
  }
  console.timeEnd('getImageInfo');
  return result; // { width, height, format, file_size }
}

// ─── Optimize ────────────────────────────────────────────────────────────────

export async function optimizeImage(fileArrayBuffer, format, quality = 80, stripMetadata = true) {
  const label = `optimizeImage q=${quality}`;
  console.time(label);
  const wasm = await loadWasm();
  const result = wasm.optimize_image(toU8(fileArrayBuffer), format, quality, stripMetadata);
  console.timeEnd(label);
  return new Blob([result], { type: getMimeType(format) });
}

export async function optimizeImageStats(fileArrayBuffer, format, quality = 80) {
  console.time('optimizeImageStats');
  const wasm = await loadWasm();
  const result = wasm.optimize_image_stats(toU8(fileArrayBuffer), format, quality);
  console.timeEnd('optimizeImageStats');
  return result; // { original_size, optimized_size, ratio }
}

// ─── Effects ─────────────────────────────────────────────────────────────────

export async function applyEffect(fileArrayBuffer, effect, intensity = 0.5, format = 'png') {
  const label = `applyEffect ${effect}`;
  console.time(label);
  const wasm = await loadWasm();
  const result = wasm.apply_effect(toU8(fileArrayBuffer), effect, intensity, format);
  console.timeEnd(label);
  return new Blob([result], { type: getMimeType(format) });
}

// ─── Text (Canvas API) ───────────────────────────────────────────────────────

/**
 * Add text overlay using the browser's Canvas 2D API.
 * This gives full system-font support without embedding a TTF in WASM.
 *
 * @param {ArrayBuffer} fileArrayBuffer - Source image bytes
 * @param {string} text
 * @param {number} x - Left position in pixels
 * @param {number} y - Top position in pixels (baseline)
 * @param {number} fontSize - In pixels
 * @param {string} colorHex - e.g. "#ff0000"
 * @param {string} format - Output format: "png" | "jpg" | "webp"
 * @returns {Promise<Blob>}
 */
export async function addText(fileArrayBuffer, text, x, y, fontSize = 32, colorHex = '#ffffff', format = 'png') {
  console.time('addText');
  return new Promise((resolve, reject) => {
    const blob = new Blob([fileArrayBuffer]);
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      ctx.font = `${fontSize}px system-ui, sans-serif`;
      ctx.fillStyle = colorHex;
      ctx.fillText(text, x, y);
      URL.revokeObjectURL(url);
      const mimeType = getMimeType(format);
      canvas.toBlob(resultBlob => {
        console.timeEnd('addText');
        if (!resultBlob) { reject(new Error('Canvas export failed')); return; }
        resolve(resultBlob);
      }, mimeType, 0.92);
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

// ─── GIF Engine ──────────────────────────────────────────────────────────────

export async function getGifInfo(fileArrayBuffer) {
  console.time('getGifInfo');
  const wasm = await loadWasm();
  const result = wasm.get_gif_info(toU8(fileArrayBuffer));
  console.timeEnd('getGifInfo');
  return result; // { width, height, frame_count, total_duration_ms, loop_count, file_size }
}

export async function splitGif(fileArrayBuffer) {
  console.time('splitGif');
  const wasm = await loadWasm();
  const result = wasm.split_gif(toU8(fileArrayBuffer));
  console.timeEnd('splitGif');
  // result: Array of { frame_png_bytes: Uint8Array | number[], delay_ms, index }
  // serde_wasm_bindgen may return Vec<u8> as a plain Array — ensure Uint8Array for Blob
  return result.map(frame => ({
    blob: new Blob([frame.frame_png_bytes instanceof Uint8Array
      ? frame.frame_png_bytes
      : new Uint8Array(frame.frame_png_bytes)], { type: 'image/png' }),
    delay_ms: frame.delay_ms,
    index: frame.index,
  }));
}

/**
 * @param {Uint8Array[]} framesRgbaArray - Array of RGBA pixel buffers (each width*height*4 bytes)
 * @param {number[]} delaysMs - Per-frame delay in milliseconds
 * @param {number} width
 * @param {number} height
 * @param {number} loopCount - 0 = infinite
 */
export async function createGif(framesRgbaArray, delaysMs, width, height, loopCount = 0) {
  console.time('createGif');
  const wasm = await loadWasm();
  // Concatenate all RGBA frame buffers into one flat Uint8Array
  const frameSize = width * height * 4;
  const combined = new Uint8Array(frameSize * framesRgbaArray.length);
  framesRgbaArray.forEach((frame, i) => combined.set(new Uint8Array(frame), i * frameSize));
  const delays = new Uint16Array(delaysMs);
  const result = wasm.create_gif(combined, delays, width, height, loopCount);
  console.timeEnd('createGif');
  return new Blob([result], { type: 'image/gif' });
}

export async function reverseGif(fileArrayBuffer) {
  console.time('reverseGif');
  const wasm = await loadWasm();
  const result = wasm.reverse_gif(toU8(fileArrayBuffer));
  console.timeEnd('reverseGif');
  return new Blob([result], { type: 'image/gif' });
}

export async function changeGifSpeed(fileArrayBuffer, speedFactor) {
  const label = `changeGifSpeed ×${speedFactor}`;
  console.time(label);
  const wasm = await loadWasm();
  const result = wasm.change_gif_speed(toU8(fileArrayBuffer), speedFactor);
  console.timeEnd(label);
  return new Blob([result], { type: 'image/gif' });
}

export async function removeGifFrames(fileArrayBuffer, indicesToRemove) {
  console.time('removeGifFrames');
  const wasm = await loadWasm();
  const indices = new Uint32Array(indicesToRemove);
  const result = wasm.remove_gif_frames(toU8(fileArrayBuffer), indices);
  console.timeEnd('removeGifFrames');
  return new Blob([result], { type: 'image/gif' });
}
