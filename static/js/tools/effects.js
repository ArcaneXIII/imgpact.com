(function () {
  'use strict';

  // ─── State ────────────────────────────────────────────────────────────────
  let originalAB  = null;   // never mutated — for reset
  let originalFile = null;
  let workingAB   = null;   // current working image (after applied effects)
  let previewBlob = null;   // last WASM result (may be uncommitted)
  let resultBlob  = null;   // committed result for download

  let selectedEffect = null;
  let appliedEffects = [];

  const NO_INTENSITY = new Set(['grayscale', 'invert']);

  function updateEffectsStack() {
    const wrap   = document.getElementById('effects-stack');
    const badges = document.getElementById('effects-stack-badges');
    if (!appliedEffects.length) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    badges.innerHTML = appliedEffects.map(e =>
      `<span style="padding:0.2rem 0.6rem;background:var(--accent);color:#fff;border-radius:20px;font-size:0.75rem;font-weight:600">${e}</span>`
    ).join('');
  }

  // ─── Upload ───────────────────────────────────────────────────────────────
  TC.initFileUploader('upload-zone', (ab, file) => {
    originalAB   = ab;
    originalFile = file;
    workingAB    = ab;
    previewBlob  = null;
    resultBlob   = null;
    selectedEffect = null;

    // Show working image in preview
    const blob = new Blob([ab], { type: file.type });
    showPreviewImg(blob);

    document.querySelectorAll('.effect-card').forEach(c => c.classList.remove('active'));
    document.getElementById('intensity-row').style.display = 'none';
    document.getElementById('btn-apply').disabled = true;
    document.getElementById('btn-reset').disabled = false;
    document.getElementById('tool-controls').classList.remove('hidden');
    document.getElementById('output-section').classList.add('hidden');
    document.getElementById('preview-container').style.display = '';

    const infoBar = document.getElementById('file-info-bar');
    infoBar.style.display = 'flex';
    infoBar.innerHTML = `<span class="fi-name">${file.name}</span><span class="fi-meta">${TC.formatFileSize(file.size)}</span>`;
  });

  // ─── Effect card clicks ───────────────────────────────────────────────────
  document.getElementById('effect-grid').addEventListener('click', async e => {
    const card = e.target.closest('.effect-card');
    if (!card || !workingAB) return;

    document.querySelectorAll('.effect-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    selectedEffect = card.dataset.effect;

    const noIntensity = card.dataset.noIntensity === 'true';
    document.getElementById('intensity-row').style.display = noIntensity ? 'none' : '';
    document.getElementById('btn-apply').disabled = false;

    // Auto-preview on card click
    await runPreview();
  });

  // ─── Intensity slider ─────────────────────────────────────────────────────
  let previewDebounce = null;
  document.getElementById('intensity').addEventListener('input', e => {
    document.getElementById('intensity-label').textContent = e.target.value + '%';
    clearTimeout(previewDebounce);
    previewDebounce = setTimeout(runPreview, 280);
  });

  // ─── Preview ──────────────────────────────────────────────────────────────
  async function runPreview() {
    if (!selectedEffect || !workingAB) return;
    TC.showSpinner('preview-wrap');
    try {
      const intensity = parseInt(document.getElementById('intensity').value) / 100;
      const fmt = document.getElementById('out-format').value;
      const { applyEffect } = await import('/static/js/wasm-bridge.js');
      previewBlob = await applyEffect(workingAB, selectedEffect, intensity, fmt);
      showPreviewImg(previewBlob);
    } catch (err) {
      TC.showToast('Preview failed: ' + err.message, 'error');
    } finally {
      TC.hideSpinner('preview-wrap');
    }
  }

  function showPreviewImg(blob) {
    const img = document.getElementById('preview-img');
    const old = img.src;
    img.src = URL.createObjectURL(blob);
    img.onload = () => { if (old && old.startsWith('blob:')) URL.revokeObjectURL(old); };
  }

  // ─── Apply (commit effect) ────────────────────────────────────────────────
  document.getElementById('btn-apply').addEventListener('click', async () => {
    if (!selectedEffect || !workingAB) return;
    if (window.trackToolUse) trackToolUse('effects');
    TC.showSpinner('preview-wrap');
    try {
      const intensity = parseInt(document.getElementById('intensity').value) / 100;
      const fmt = document.getElementById('out-format').value;
      const { applyEffect } = await import('/static/js/wasm-bridge.js');
      const blob = await applyEffect(workingAB, selectedEffect, intensity, fmt);
      // Commit: new working image = result
      workingAB  = await blob.arrayBuffer();
      resultBlob = blob;
      showPreviewImg(blob);
      appliedEffects.push(selectedEffect);
      updateEffectsStack();

      TC.showToast(`${selectedEffect} applied.`, 'success');

      // Reset selection UI
      document.querySelectorAll('.effect-card').forEach(c => c.classList.remove('active'));
      selectedEffect = null;
      document.getElementById('intensity-row').style.display = 'none';
      document.getElementById('btn-apply').disabled = true;

      // Show output section
      const origBlob = new Blob([originalAB], { type: originalFile.type });
      TC.showBeforeAfter('before-after', origBlob, resultBlob);
      document.getElementById('output-section').classList.remove('hidden');
    } catch (err) {
      TC.showToast('Apply failed: ' + err.message, 'error');
    } finally {
      TC.hideSpinner('preview-wrap');
    }
  });

  // ─── Reset ────────────────────────────────────────────────────────────────
  document.getElementById('btn-reset').addEventListener('click', () => {
    clearTimeout(previewDebounce);
    workingAB  = originalAB;
    resultBlob = null;
    previewBlob = null;
    selectedEffect = null;
    appliedEffects = [];
    updateEffectsStack();
    document.querySelectorAll('.effect-card').forEach(c => c.classList.remove('active'));
    document.getElementById('intensity-row').style.display = 'none';
    document.getElementById('btn-apply').disabled = true;
    document.getElementById('output-section').classList.add('hidden');
    showPreviewImg(new Blob([originalAB], { type: originalFile.type }));
    TC.showToast('Reset to original.', 'info');
  });

  // ─── Download ─────────────────────────────────────────────────────────────
  document.getElementById('btn-download').addEventListener('click', () => {
    if (!resultBlob) return;
    const fmt = document.getElementById('out-format').value;
    TC.downloadBlob(resultBlob, `imgpact-effect-${Date.now()}.${fmt}`);
  });
})();
