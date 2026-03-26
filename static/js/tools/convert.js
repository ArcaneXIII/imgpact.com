/**
 * imgpact — Unified format converter (PNG / JPG / WebP / GIF / SVG source)
 * Reads data-source-format from #convert-root to configure behaviour.
 */
import { convertImage, getImageInfo, resizeImage } from '/static/js/wasm-bridge.js';

const root          = document.getElementById('convert-root');
const sourceFormat  = root.dataset.sourceFormat;

// ── Elements ─────────────────────────────────────────────────────────────────
const uploadZone      = document.getElementById('upload-zone');
const fileInput       = document.getElementById('file-input');
const fileList        = document.getElementById('file-list');
const controls        = document.getElementById('controls');
const targetFormatSel = document.getElementById('target-format');
const qualityGroup    = document.getElementById('quality-group');
const qualitySlider   = document.getElementById('quality-slider');
const qualityValue    = document.getElementById('quality-value');
const icoGroup        = document.getElementById('ico-group');
const convertBtn      = document.getElementById('convert-btn');
const convertAllBtn   = document.getElementById('convert-all-btn');
const progressWrap    = document.getElementById('convert-progress');
const progressBar     = document.getElementById('convert-progress-bar');
const progressLabel   = document.getElementById('convert-progress-label');
const resultsSection  = document.getElementById('results-section');
const resultsList     = document.getElementById('results-list');
const batchActions    = document.getElementById('batch-actions');
const batchSummary    = document.getElementById('batch-summary');
const downloadZipBtn  = document.getElementById('download-zip-btn');

// SVG-specific
const svgWidthInput  = document.getElementById('svg-width');
const svgHeightInput = document.getElementById('svg-height');
const svgLockAspect  = document.getElementById('svg-lock-aspect');
const svgSizeNote    = document.getElementById('svg-size-note');

// Resize-during-conversion
const resizeWidthInput  = document.getElementById('resize-width');
const resizeHeightInput = document.getElementById('resize-height');
const resizeLockAspect  = document.getElementById('resize-lock-aspect');

let uploadedFiles = []; // [{ file, ab, info }]
let convertedResults = []; // [{ file, origAb, resultBlob, target }]

// ── Upload ────────────────────────────────────────────────────────────────────
uploadZone.addEventListener('click', () => fileInput.click());
uploadZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
fileInput.addEventListener('change', e => handleFiles(Array.from(e.target.files)));

uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  handleFiles(Array.from(e.dataTransfer.files));
});

async function handleFiles(files) {
  const list = Array.from(files);
  if (!list.length) return;

  uploadedFiles = [];
  fileList.innerHTML = '';
  fileList.classList.remove('hidden');
  controls.classList.remove('hidden');
  resultsSection.classList.add('hidden');
  resultsList.innerHTML = '';

  for (const file of list) {
    const ab = await file.arrayBuffer();
    let info = { width: 0, height: 0, format: sourceFormat, file_size: file.size };
    try { info = await getImageInfo(ab); } catch (_) {}
    uploadedFiles.push({ file, ab, info });
    renderFileRow(file, info);

    // Seed SVG/resize aspect ratio from first file
    if (uploadedFiles.length === 1 && info.width && info.height) {
      const aspect = info.width / info.height;
      if (sourceFormat === 'svg') {
        if (svgWidthInput && !svgWidthInput.value) svgWidthInput.value = info.width;
        if (svgHeightInput && !svgHeightInput.value) svgHeightInput.value = info.height;
        if (svgSizeNote) svgSizeNote.textContent = `SVG will be rasterized at ${info.width}×${info.height}px`;
        svgWidthInput?._setAspect?.(aspect);
      }
    }
  }

  if (uploadedFiles.length === 1) {
    convertBtn.classList.remove('hidden');
    convertAllBtn.classList.add('hidden');
  } else {
    convertBtn.classList.add('hidden');
    convertAllBtn.classList.remove('hidden');
  }

  updateControlVisibility();
}

function renderFileRow(file, info) {
  const row = document.createElement('div');
  row.className = 'file-list-row';
  const thumb = document.createElement('img');
  thumb.className = 'file-thumb';
  const objUrl = URL.createObjectURL(file);
  thumb.src = objUrl;
  thumb.onload = () => URL.revokeObjectURL(objUrl);
  const dims = info.width && info.height ? `${info.width}×${info.height}` : '';
  const badge = document.createElement('span');
  badge.className = 'file-format-badge';
  badge.textContent = (info.format || sourceFormat).toUpperCase();
  const nameSpan = document.createElement('span');
  nameSpan.className = 'file-name';
  nameSpan.textContent = file.name;
  const dimsSpan = document.createElement('span');
  dimsSpan.className = 'file-dims';
  dimsSpan.textContent = dims;
  const sizeSpan = document.createElement('span');
  sizeSpan.className = 'file-size';
  sizeSpan.textContent = formatSize(file.size);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'file-remove-btn';
  removeBtn.innerHTML = '&times;';
  removeBtn.title = 'Remove';
  removeBtn.addEventListener('click', () => {
    const idx = Array.from(fileList.children).indexOf(row);
    if (idx !== -1) uploadedFiles.splice(idx, 1);
    row.remove();
    if (uploadedFiles.length === 0) {
      fileList.classList.add('hidden');
      controls.classList.add('hidden');
    } else if (uploadedFiles.length === 1) {
      convertBtn.classList.remove('hidden');
      convertAllBtn.classList.add('hidden');
    } else {
      convertBtn.classList.add('hidden');
      convertAllBtn.classList.remove('hidden');
    }
  });

  row.append(thumb, badge, nameSpan, dimsSpan, sizeSpan, removeBtn);
  fileList.appendChild(row);
}

// ── Controls ──────────────────────────────────────────────────────────────────
const QUALITY_FORMATS = new Set(['jpg', 'jpeg', 'webp', 'avif']);

// SVG note element (injected once)
let svgNoteEl = null;
function getSvgNote() {
  if (!svgNoteEl) {
    svgNoteEl = document.createElement('p');
    svgNoteEl.className = 'control-hint';
    svgNoteEl.style.color = 'var(--text-secondary)';
    svgNoteEl.textContent = 'SVG output embeds the raster image inside an SVG container — it is not vectorization.';
    document.getElementById('controls')?.appendChild(svgNoteEl);
  }
  return svgNoteEl;
}

targetFormatSel.addEventListener('change', updateControlVisibility);
qualitySlider.addEventListener('input', () => { qualityValue.textContent = qualitySlider.value; });

function updateControlVisibility() {
  const target = targetFormatSel.value;
  qualityGroup.classList.toggle('hidden', !QUALITY_FORMATS.has(target));
  icoGroup.classList.toggle('hidden', target !== 'ico');
  const note = getSvgNote();
  note.hidden = (target !== 'svg');
}

// SVG aspect lock
if (svgWidthInput && svgHeightInput) {
  let svgAspect = null;
  svgWidthInput.addEventListener('input', () => {
    if (!svgAspect && svgWidthInput.value && svgHeightInput.value) {
      svgAspect = svgWidthInput.value / svgHeightInput.value;
    }
    if (svgLockAspect?.checked && svgAspect) {
      svgHeightInput.value = Math.round(+svgWidthInput.value / svgAspect);
    }
    updateSvgNote();
  });
  svgHeightInput.addEventListener('input', () => {
    if (!svgAspect && svgWidthInput.value && svgHeightInput.value) {
      svgAspect = svgWidthInput.value / svgHeightInput.value;
    }
    if (svgLockAspect?.checked && svgAspect) {
      svgWidthInput.value = Math.round(+svgHeightInput.value * svgAspect);
    }
    updateSvgNote();
  });
  function updateSvgNote() {
    const w = svgWidthInput.value, h = svgHeightInput.value;
    if (svgSizeNote && w && h) svgSizeNote.textContent = `SVG will be rasterized at ${w}×${h}px`;
  }
}

// Resize aspect lock
if (resizeWidthInput && resizeHeightInput) {
  let resizeAspect = null;
  resizeWidthInput.addEventListener('input', () => {
    if (!resizeAspect && resizeWidthInput.value && resizeHeightInput.value) {
      resizeAspect = resizeWidthInput.value / resizeHeightInput.value;
    }
    if (resizeLockAspect?.checked && resizeAspect) {
      resizeHeightInput.value = Math.round(+resizeWidthInput.value / resizeAspect);
    }
  });
  resizeHeightInput.addEventListener('input', () => {
    if (!resizeAspect && resizeWidthInput.value && resizeHeightInput.value) {
      resizeAspect = resizeWidthInput.value / resizeHeightInput.value;
    }
    if (resizeLockAspect?.checked && resizeAspect) {
      resizeWidthInput.value = Math.round(+resizeHeightInput.value * resizeAspect);
    }
  });
}

// ── Conversion ────────────────────────────────────────────────────────────────
convertBtn.addEventListener('click', convertBatch);
convertAllBtn.addEventListener('click', convertBatch);

async function convertBatch() {
  if (!uploadedFiles.length) return;
  if (window.trackToolUse) trackToolUse('convert-' + (root.dataset.sourceFormat || 'png'));

  const target  = targetFormatSel.value;
  const quality = parseInt(qualitySlider.value, 10);

  convertedResults = [];
  resultsList.innerHTML = '';
  resultsSection.classList.remove('hidden');
  batchActions.classList.add('hidden');
  progressWrap.classList.remove('hidden');
  progressBar.style.width = '0%';

  for (let i = 0; i < uploadedFiles.length; i++) {
    progressLabel.textContent = `Converting ${i + 1}/${uploadedFiles.length}…`;
    progressBar.style.width = `${(i / uploadedFiles.length) * 100}%`;

    const { file, ab, info } = uploadedFiles[i];
    try {
      const resultBlob = await convertSingle(ab, target, quality, info);
      convertedResults.push({ file, origAb: ab, resultBlob, target });
      renderResult(file, ab, resultBlob, target);
    } catch (e) {
      console.error(`Failed to convert ${file.name}:`, e);
      TC.showToast(`Failed to convert ${file.name}: ${e.message}`, 'error');
    }
  }

  progressBar.style.width = '100%';
  const n = convertedResults.length;
  progressLabel.textContent = `Done — ${n} file${n !== 1 ? 's' : ''} converted`;

  if (n > 1) {
    const origTotal = convertedResults.reduce((s, r) => s + r.origAb.byteLength, 0);
    const newTotal  = convertedResults.reduce((s, r) => s + r.resultBlob.size, 0);
    batchSummary.textContent = `Converted ${n} files. Total size: ${formatSize(origTotal)} → ${formatSize(newTotal)}`;
    batchActions.classList.remove('hidden');
  }
}

async function convertSingle(ab, target, quality, info) {
  let buf = ab;

  // Optional resize before conversion
  const rw = parseInt(resizeWidthInput?.value, 10) || 0;
  const rh = parseInt(resizeHeightInput?.value, 10) || 0;
  if (rw > 0 || rh > 0) {
    const lock = resizeLockAspect?.checked !== false;
    const blob = await resizeImage(buf, rw || 0, rh || 0, lock, 'lanczos3', 'png');
    buf = await blob.arrayBuffer();
  }

  // ICO: resize to the selected size first
  if (target === 'ico') {
    const checked = document.querySelector('input[name="ico-size"]:checked');
    const size = checked ? parseInt(checked.value, 10) : 32;
    const blob = await resizeImage(buf, size, size, false, 'lanczos3', 'png');
    buf = await blob.arrayBuffer();
  }

  // SVG: rasterize via canvas → PNG ArrayBuffer
  if (sourceFormat === 'svg') {
    buf = await rasterizeSvg(buf, info);
  }

  // SVG output: wrap raster image in an SVG container
  // Note: this is not vectorization — it embeds the raster image inside an SVG file.
  if (target === 'svg') {
    return wrapRasterInSvg(buf, info);
  }

  return convertImage(buf, target, quality);
}

/**
 * Wraps a raster image (as ArrayBuffer) in an SVG <image> element.
 * The result is a valid SVG file containing the raster as a base64 data-URI.
 * This is NOT vectorization — it is an SVG container around a raster image.
 */
async function wrapRasterInSvg(ab, info) {
  // Convert to PNG first for a clean, well-defined embed
  const pngBlob = await convertImage(ab, 'png', 100);
  const w = info.width  || 0;
  const h = info.height || 0;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result; // data:image/png;base64,…
      const svgContent = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`,
        `     width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
        `  <image x="0" y="0" width="${w}" height="${h}" xlink:href="${dataUrl}"/>`,
        '</svg>',
      ].join('\n');
      resolve(new Blob([svgContent], { type: 'image/svg+xml' }));
    };
    reader.onerror = reject;
    reader.readAsDataURL(pngBlob);
  });
}

function rasterizeSvg(ab, info) {
  const svgBlob = new Blob([ab], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(svgBlob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = parseInt(svgWidthInput?.value, 10) || img.naturalWidth || 800;
      const h = parseInt(svgHeightInput?.value, 10) || img.naturalHeight || 600;
      if (svgSizeNote) svgSizeNote.textContent = `SVG rasterized at ${w}×${h}px`;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob(b => b.arrayBuffer().then(resolve).catch(reject), 'image/png');
    };
    img.onerror = e => { URL.revokeObjectURL(url); reject(new Error('SVG rasterization failed')); };
    img.src = url;
  });
}

function renderResult(file, origAb, resultBlob, target) {
  const origSize = origAb.byteLength;
  const newSize  = resultBlob.size;
  const pct      = ((newSize - origSize) / origSize * 100).toFixed(1);
  const sign     = pct > 0 ? '+' : '';
  const ext      = target === 'jpeg' ? 'jpg' : target;
  const baseName = file.name.replace(/\.[^.]+$/, '');
  const outName  = `imgpact-${baseName}.${ext}`;

  const resultUrl = URL.createObjectURL(resultBlob);
  const div = document.createElement('div');
  div.className = 'result-row';

  const thumb = document.createElement('img');
  thumb.className = 'result-thumb';
  thumb.src = resultUrl;

  const meta = document.createElement('div');
  meta.className = 'result-meta';
  meta.innerHTML = `
    <span class="format-badge">${sourceFormat.toUpperCase()}</span>
    <span class="arrow">→</span>
    <span class="format-badge target-badge">${target.toUpperCase()}</span>
    <span class="result-sizes">
      ${formatSize(origSize)} → ${formatSize(newSize)}
      <span class="savings ${pct > 0 ? 'size-increase' : 'size-decrease'}">(${sign}${pct}%)</span>
    </span>`;

  const dlBtn = document.createElement('button');
  dlBtn.className = 'btn-secondary';
  dlBtn.textContent = '⬇ Download';
  dlBtn.addEventListener('click', () => TC.downloadBlob(resultBlob, outName));

  div.append(thumb, meta, dlBtn);
  resultsList.appendChild(div);
}

// ── ZIP Download ──────────────────────────────────────────────────────────────
downloadZipBtn?.addEventListener('click', async () => {
  if (!convertedResults.length) return;
  downloadZipBtn.disabled = true;
  downloadZipBtn.innerHTML = '<i data-lucide="loader-2"></i> Building ZIP…';
  if (window.lucide) lucide.createIcons({ nodes: [downloadZipBtn] });
  try {
    const JSZip = window.JSZip;
    const zip   = new JSZip();
    const target = convertedResults[0].target;
    const ext    = target === 'jpeg' ? 'jpg' : target;
    for (const { file, resultBlob } of convertedResults) {
      const base = file.name.replace(/\.[^.]+$/, '');
      zip.file(`imgpact-${base}.${ext}`, resultBlob);
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    TC.downloadBlob(zipBlob, `imgpact-converted-${target}.zip`);
  } finally {
    downloadZipBtn.disabled = false;
    downloadZipBtn.innerHTML = '<i data-lucide="archive"></i> Download All as ZIP';
    if (window.lucide) lucide.createIcons({ nodes: [downloadZipBtn] });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

// Init
updateControlVisibility();
