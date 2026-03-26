(function () {
  'use strict';

  let originalAB   = null;
  let originalFile = null;
  let resultBlob   = null;
  let origW = 0, origH = 0;
  let aspectLocked = true;

  const wInput  = document.getElementById('out-width');
  const hInput  = document.getElementById('out-height');
  const pctInput = document.getElementById('scale-pct');
  const lockBtn = document.getElementById('lock-btn');
  const dimsEl  = document.getElementById('current-dims');

  // ─── Live preview ─────────────────────────────────────────────────────────
  let previewDebounce = null;

  function schedulePreview() {
    clearTimeout(previewDebounce);
    previewDebounce = setTimeout(runPreview, 420);
  }

  async function runPreview() {
    if (!originalAB) return;
    const w = parseInt(wInput.value) || 1;
    const h = parseInt(hInput.value) || 1;
    const filter = document.getElementById('filter').value;
    const fmt = resolveFormat(document.getElementById('out-format').value, originalFile.type);
    const container = document.getElementById('live-preview-container');
    const previewImg = document.getElementById('live-preview-img');
    const label = document.getElementById('live-preview-label');
    TC.showSpinner('live-preview-wrap');
    try {
      const { resizeImage } = await import('/static/js/wasm-bridge.js');
      const blob = await resizeImage(originalAB, w, h, false, filter, fmt);
      const url = URL.createObjectURL(blob);
      const old = previewImg.src;
      previewImg.src = url;
      previewImg.onload = () => { if (old && old.startsWith('blob:')) URL.revokeObjectURL(old); };
      label.textContent = `${w} × ${h} px · ${TC.formatFileSize(blob.size)}`;
      container.style.display = '';
    } catch (_) {
      // silently skip broken preview
    } finally {
      TC.hideSpinner('live-preview-wrap');
    }
  }

  // ─── Upload ───────────────────────────────────────────────────────────────
  TC.initFileUploader('upload-zone', async (ab, file) => {
    originalAB   = ab;
    originalFile = file;
    resultBlob   = null;

    document.getElementById('output-section').classList.add('hidden');

    const infoBar = document.getElementById('file-info-bar');
    infoBar.style.display = 'flex';
    infoBar.innerHTML = `<span class="fi-name">${file.name}</span><span class="fi-meta">${TC.formatFileSize(file.size)}</span>`;

    // Get dimensions via WASM
    try {
      const { getDimensions } = await import('/static/js/wasm-bridge.js');
      const dims = await getDimensions(ab);
      origW = dims.width;
      origH = dims.height;
    } catch {
      // fallback: read via Image
      await new Promise(resolve => {
        const url = URL.createObjectURL(new Blob([ab], { type: file.type }));
        const img = new Image();
        img.onload = () => { origW = img.naturalWidth; origH = img.naturalHeight; URL.revokeObjectURL(url); resolve(); };
        img.src = url;
      });
    }

    dimsEl.textContent = `Original: ${origW} × ${origH} px`;
    wInput.value = origW;
    hInput.value = origH;
    pctInput.value = 100;

    infoBar.innerHTML += `<span class="fi-meta">${origW} × ${origH} px</span>`;
    document.getElementById('tool-controls').classList.remove('hidden');
    schedulePreview();
  });

  // ─── Aspect lock toggle ───────────────────────────────────────────────────
  lockBtn.addEventListener('click', () => {
    aspectLocked = !aspectLocked;
    lockBtn.textContent = aspectLocked ? '🔒' : '🔓';
    lockBtn.style.opacity = aspectLocked ? '1' : '0.5';
  });

  // ─── Width input ──────────────────────────────────────────────────────────
  wInput.addEventListener('input', () => {
    const w = parseInt(wInput.value) || 1;
    if (aspectLocked && origW) hInput.value = Math.round(w * origH / origW);
    if (origW) pctInput.value = Math.round(w / origW * 100);
    schedulePreview();
  });

  // ─── Height input ─────────────────────────────────────────────────────────
  hInput.addEventListener('input', () => {
    const h = parseInt(hInput.value) || 1;
    if (aspectLocked && origH) wInput.value = Math.round(h * origW / origH);
    if (origH) pctInput.value = Math.round(h / origH * 100);
    schedulePreview();
  });

  // ─── Scale % input ────────────────────────────────────────────────────────
  pctInput.addEventListener('input', () => {
    const pct = parseFloat(pctInput.value) || 1;
    if (origW) { wInput.value = Math.round(origW * pct / 100); hInput.value = Math.round(origH * pct / 100); }
    schedulePreview();
  });

  document.getElementById('filter').addEventListener('change', schedulePreview);
  document.getElementById('out-format').addEventListener('change', schedulePreview);

  // ─── Resize action ────────────────────────────────────────────────────────
  document.getElementById('btn-resize').addEventListener('click', async () => {
    if (!originalAB) return;
    if (window.trackToolUse) trackToolUse('resize');
    const w = parseInt(wInput.value) || 1;
    const h = parseInt(hInput.value) || 1;
    const filter = document.getElementById('filter').value;
    const fmt = resolveFormat(document.getElementById('out-format').value, originalFile.type);

    TC.showSpinner('tool-controls');
    try {
      const { resizeImage } = await import('/static/js/wasm-bridge.js');
      resultBlob = await resizeImage(originalAB, w, h, aspectLocked, filter, fmt);
      showOutput(fmt);
      TC.showToast(`Resized to ${w} × ${h}`, 'success');
    } catch (err) {
      TC.showToast('Resize failed: ' + (err?.message || String(err)), 'error');
    } finally {
      TC.hideSpinner('tool-controls');
    }
  });

  // ─── Output ───────────────────────────────────────────────────────────────
  function showOutput(fmt) {
    const origBlob = new Blob([originalAB], { type: originalFile.type });
    TC.showBeforeAfter('before-after', origBlob, resultBlob);
    TC.showStats('stats-bar', originalFile.size, resultBlob.size);
    document.getElementById('output-section').classList.remove('hidden');

    document.getElementById('btn-download').onclick = () => {
      TC.downloadBlob(resultBlob, `imgpact-resized-${Date.now()}.${fmt}`);
    };
  }

  function resolveFormat(sel, mimeType) {
    if (sel !== 'same') return sel;
    const map = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp' };
    return map[mimeType] || 'png';
  }
})();
