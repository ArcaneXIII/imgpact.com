(function () {
  'use strict';

  let originalAB   = null;
  let originalFile = null;
  let workingAB    = null;
  let resultBlob   = null;
  let historyLog   = [];   // human-readable action labels

  const actionLabels = {
    rotate270: 'Rotated 90° Left',
    rotate90:  'Rotated 90° Right',
    rotate180: 'Rotated 180°',
    fliph:     'Flipped Horizontal',
    flipv:     'Flipped Vertical',
  };

  // ─── Upload ───────────────────────────────────────────────────────────────
  TC.initFileUploader('upload-zone', (ab, file) => {
    originalAB   = ab;
    originalFile = file;
    workingAB    = ab;
    resultBlob   = null;
    historyLog   = [];

    updatePreviewFromAB(new Blob([ab], { type: file.type }));
    updateHistory();

    document.getElementById('btn-reset').disabled = false;
    document.getElementById('tool-controls').classList.remove('hidden');
    document.getElementById('output-section').classList.add('hidden');
    document.getElementById('preview-container').style.display = '';

    const infoBar = document.getElementById('file-info-bar');
    infoBar.style.display = 'flex';
    infoBar.innerHTML = `<span class="fi-name">${file.name}</span><span class="fi-meta">${TC.formatFileSize(file.size)}</span>`;
  });

  // ─── Transform buttons ────────────────────────────────────────────────────
  document.querySelectorAll('.btn-transform').forEach(btn => {
    btn.addEventListener('click', () => applyTransform(btn.dataset.action));
  });

  async function applyTransform(action) {
    if (!workingAB) return;
    if (window.trackToolUse) trackToolUse('transform');

    const fmt = resolveFormat(document.getElementById('out-format').value, originalFile.type);
    TC.showSpinner('preview-wrap');
    try {
      const bridge = await import('/static/js/wasm-bridge.js');
      let blob;
      if (action === 'fliph')       blob = await bridge.flipHorizontal(workingAB, fmt);
      else if (action === 'flipv')  blob = await bridge.flipVertical(workingAB, fmt);
      else {
        const deg = action === 'rotate90' ? 90 : action === 'rotate270' ? 270 : 180;
        blob = await bridge.rotateImage(workingAB, deg, fmt);
      }

      workingAB  = await blob.arrayBuffer();
      resultBlob = blob;
      historyLog.push(actionLabels[action]);
      updateHistory();
      updatePreviewFromAB(blob);
      showOutput(fmt);
    } catch (err) {
      TC.showToast('Transform failed: ' + err.message, 'error');
    } finally {
      TC.hideSpinner('preview-wrap');
    }
  }

  // ─── Reset ────────────────────────────────────────────────────────────────
  document.getElementById('btn-reset').addEventListener('click', () => {
    workingAB  = originalAB;
    resultBlob = null;
    historyLog = [];
    updateHistory();
    updatePreviewFromAB(new Blob([originalAB], { type: originalFile.type }));
    document.getElementById('output-section').classList.add('hidden');
    TC.showToast('Reset to original.', 'info');
  });

  // ─── Output ───────────────────────────────────────────────────────────────
  function showOutput(fmt) {
    const origBlob = new Blob([originalAB], { type: originalFile.type });
    TC.showBeforeAfter('before-after', origBlob, resultBlob);
    document.getElementById('output-section').classList.remove('hidden');
    document.getElementById('btn-download').onclick = () => {
      TC.downloadBlob(resultBlob, `imgpact-transformed-${Date.now()}.${fmt}`);
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function updatePreviewFromAB(blobOrBlob) {
    const img = document.getElementById('preview-img');
    const old = img.src;
    img.src = URL.createObjectURL(blobOrBlob);
    img.onload = () => { if (old && old.startsWith('blob:')) URL.revokeObjectURL(old); };
  }

  function updateHistory() {
    const el = document.getElementById('transform-history');
    el.textContent = historyLog.length ? historyLog.join(' → ') : '';
  }

  function resolveFormat(sel, mimeType) {
    if (sel !== 'same') return sel;
    const map = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/gif': 'gif' };
    return map[mimeType] || 'png';
  }
})();
