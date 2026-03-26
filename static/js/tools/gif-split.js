(function () {
  'use strict';

  let splitFrames = []; // Array of { blob, delay_ms, index }

  TC.initFileUploader('upload-zone', async (ab, file) => {
    TC.showSpinner('upload-zone');
    if (window.trackToolUse) trackToolUse('gif-split');
    try {
      const { splitGif, getGifInfo } = await import('/static/js/wasm-bridge.js');
      const [frames, info] = await Promise.all([splitGif(ab), getGifInfo(ab)]);
      splitFrames = frames;
      renderSummary(info, file.size);
      renderGrid(frames);
      document.getElementById('tool-controls').classList.remove('hidden');
      TC.showToast(`Split into ${frames.length} frames`, 'success');
    } catch (err) {
      TC.showToast('Failed to split GIF: ' + err.message, 'error');
    } finally {
      TC.hideSpinner('upload-zone');
    }
  });

  function renderSummary(info, fileSize) {
    const el = document.getElementById('gif-summary');
    el.innerHTML = `
      <div class="info-kv-list">
        <div class="info-kv"><span class="info-key">Dimensions</span><span class="info-val">${info.width} × ${info.height} px</span></div>
        <div class="info-kv"><span class="info-key">File size</span><span class="info-val">${TC.formatFileSize(fileSize)}</span></div>
        <div class="info-kv"><span class="info-key">Frames</span><span class="info-val">${info.frame_count}</span></div>
        <div class="info-kv"><span class="info-key">Duration</span><span class="info-val">${(info.total_duration_ms / 1000).toFixed(2)}s</span></div>
      </div>
    `;
  }

  function renderGrid(frames) {
    const grid = document.getElementById('frame-grid');
    grid.innerHTML = '';
    frames.forEach(({ blob, delay_ms, index }) => {
      const url  = URL.createObjectURL(blob);
      const card = document.createElement('div');
      card.className = 'split-frame-card';
      card.innerHTML = `
        <img src="${url}" class="split-frame-img" onload="URL.revokeObjectURL(this.src)">
        <div class="split-frame-meta">
          <span class="split-frame-num">#${index + 1}</span>
          <span class="split-frame-delay">${delay_ms}ms</span>
        </div>
        <button class="split-dl-btn" data-idx="${index}">↓ Download</button>
      `;
      card.querySelector('.split-dl-btn').addEventListener('click', () => {
        TC.downloadBlob(blob, `imgpact-frame-${String(index + 1).padStart(3, '0')}.png`);
      });
      grid.appendChild(card);
    });
  }

  // ─── ZIP download ─────────────────────────────────────────────────────────
  document.getElementById('btn-zip').addEventListener('click', async () => {
    if (!splitFrames.length) { TC.showToast('No frames to download.', 'error'); return; }
    if (typeof JSZip === 'undefined') { TC.showToast('JSZip not loaded.', 'error'); return; }

    const btn = document.getElementById('btn-zip');
    btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2"></i> Creating ZIP…';
    if (window.lucide) lucide.createIcons({ nodes: [btn] });

    const zip = new JSZip();
    for (const { blob, index } of splitFrames) {
      const ab = await blob.arrayBuffer();
      zip.file(`frame-${String(index + 1).padStart(3, '0')}.png`, ab);
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    TC.downloadBlob(zipBlob, `imgpact-frames-${Date.now()}.zip`);

    btn.disabled = false; btn.innerHTML = '<i data-lucide="archive"></i> Download All as ZIP';
    if (window.lucide) lucide.createIcons({ nodes: [btn] });
  });
})();
