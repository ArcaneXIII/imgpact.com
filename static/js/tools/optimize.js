(function () {
  'use strict';

  // ─── State ────────────────────────────────────────────────────────────────
  let fileList = [];          // Array of { file, arrayBuffer }
  let optimizedBlobs = [];    // Array of { blob, filename } after processing

  // ─── Upload ───────────────────────────────────────────────────────────────
  TC.initFileUploader('upload-zone', onFilesLoaded, { multiple: true });

  // Override: we need all files, not just the first
  // Re-wire the file input's change event to collect multiple files
  (function rewireInput() {
    const input = document.getElementById('file-input');
    if (input) input.multiple = true;
  })();

  function onFilesLoaded(ab, file) {
    fileList.push({ file, arrayBuffer: ab });
    renderQueue();
    document.getElementById('tool-controls').classList.remove('hidden');
    document.getElementById('output-section').classList.add('hidden');
    optimizedBlobs = [];
  }

  // ─── Queue display ────────────────────────────────────────────────────────
  function renderQueue() {
    const el = document.getElementById('file-queue');
    if (!fileList.length) { el.innerHTML = ''; return; }
    el.innerHTML = `
      <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:0.5rem;font-family:var(--font-mono)">
        ${fileList.length} file${fileList.length > 1 ? 's' : ''} queued
        &nbsp;·&nbsp; ${TC.formatFileSize(fileList.reduce((s, f) => s + f.file.size, 0))} total
        &nbsp;<button id="btn-clear-queue" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:0.8rem;text-decoration:underline">Clear</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:0.4rem;max-height:200px;overflow-y:auto">
        ${fileList.map((f, i) => `
          <div style="display:flex;align-items:center;gap:0.75rem;font-size:0.82rem;padding:0.35rem 0.5rem;background:var(--bg-secondary);border-radius:4px">
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.file.name}</span>
            <span style="color:var(--text-secondary);font-family:var(--font-mono);white-space:nowrap">${TC.formatFileSize(f.file.size)}</span>
            <button data-idx="${i}" class="remove-file-btn" style="background:none;border:none;cursor:pointer;color:#dc2626;font-size:1rem;padding:0;line-height:1">×</button>
          </div>
        `).join('')}
      </div>
    `;
    document.getElementById('btn-clear-queue').onclick = () => { fileList = []; renderQueue(); document.getElementById('tool-controls').classList.add('hidden'); };
    el.querySelectorAll('.remove-file-btn').forEach(btn => {
      btn.onclick = () => { fileList.splice(parseInt(btn.dataset.idx), 1); renderQueue(); if (!fileList.length) document.getElementById('tool-controls').classList.add('hidden'); };
    });
  }

  // ─── Quality label ────────────────────────────────────────────────────────
  document.getElementById('quality').addEventListener('input', e => {
    document.getElementById('quality-label').textContent = e.target.value;
  });

  // ─── Optimize All ─────────────────────────────────────────────────────────
  document.getElementById('btn-optimize').addEventListener('click', async () => {
    if (!fileList.length) return;
    if (window.trackToolUse) trackToolUse('optimize');

    const quality     = parseInt(document.getElementById('quality').value);
    const stripMeta   = document.getElementById('strip-meta').checked;
    const formatSel   = document.getElementById('out-format').value;
    const btn         = document.getElementById('btn-optimize');

    btn.disabled = true;
    optimizedBlobs = [];

    const { optimizeImage, optimizeImageStats } = await import('/static/js/wasm-bridge.js');

    const resultsEl = document.getElementById('batch-results');
    resultsEl.innerHTML = '';
    document.getElementById('output-section').classList.remove('hidden');
    document.getElementById('summary-stats').textContent = '';

    let totalOrig = 0, totalNew = 0;

    for (let i = 0; i < fileList.length; i++) {
      btn.innerHTML = `<i data-lucide="loader"></i> Processing ${i + 1}/${fileList.length}…`; if(window.lucide) lucide.createIcons();
      const { file, arrayBuffer } = fileList[i];
      const fmt = resolveFormat(formatSel, file.type);

      let blob, stats;
      try {
        [blob, stats] = await Promise.all([
          optimizeImage(arrayBuffer, fmt, quality, stripMeta),
          optimizeImageStats(arrayBuffer, fmt, quality),
        ]);
      } catch (err) {
        TC.showToast(`Failed: ${file.name}`, 'error');
        continue;
      }

      // If WASM output is larger than the original, keep the original bytes
      if (blob.size >= file.size) {
        blob = new Blob([arrayBuffer], { type: file.type });
      }

      const outName = replaceExt(file.name, fmt);
      optimizedBlobs.push({ blob, filename: outName });
      totalOrig += file.size;
      totalNew  += blob.size;

      const saved = file.size - blob.size;
      const pct   = file.size > 0 ? ((saved / file.size) * 100).toFixed(1) : 0;
      const savingsColor = saved >= 0 ? '#16a34a' : '#dc2626';
      const sign  = saved >= 0 ? '-' : '+';

      // Thumbnail
      const thumbUrl = URL.createObjectURL(blob);
      const row = document.createElement('div');
      row.className = 'batch-item';
      row.innerHTML = `
        <img class="batch-thumb" src="${thumbUrl}" alt="">
        <div class="batch-info">
          <div style="font-weight:600;font-size:0.875rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:260px">${file.name}</div>
          <div style="font-family:var(--font-mono);font-size:0.8rem;color:var(--text-secondary);margin-top:0.2rem">
            ${TC.formatFileSize(file.size)} → ${TC.formatFileSize(blob.size)}
            <span style="color:${savingsColor};font-weight:600;margin-left:0.5rem">${sign}${Math.abs(pct)}%</span>
          </div>
        </div>
        <button class="dl-btn" data-idx="${optimizedBlobs.length - 1}"
          style="padding:0.4rem 0.8rem;background:var(--accent);color:#fff;border:none;border-radius:var(--radius);cursor:pointer;font-size:0.82rem;white-space:nowrap">
          ↓ Download
        </button>
      `;
      row.querySelector('.dl-btn').onclick = () => {
        const entry = optimizedBlobs[parseInt(row.querySelector('.dl-btn').dataset.idx)];
        TC.downloadBlob(entry.blob, entry.filename);
      };
      resultsEl.appendChild(row);

      // Revoke thumb after render
      setTimeout(() => URL.revokeObjectURL(thumbUrl), 5000);
    }

    // Summary
    const totalSaved = totalOrig - totalNew;
    const totalPct   = totalOrig > 0 ? ((totalSaved / totalOrig) * 100).toFixed(1) : 0;
    const summaryEl  = document.getElementById('summary-stats');
    summaryEl.innerHTML = `
      <span>Total: ${TC.formatFileSize(totalOrig)} → ${TC.formatFileSize(totalNew)}</span>
      <span style="color:#16a34a;font-weight:700">Saved ${TC.formatFileSize(Math.max(0, totalSaved))} (${totalPct}%)</span>
    `;

    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="gauge"></i> ${btn.dataset.label || 'Optimize All'}`; if(window.lucide) lucide.createIcons();
    TC.showToast(`Optimized ${optimizedBlobs.length} file${optimizedBlobs.length > 1 ? 's' : ''}`, 'success');
  });

  // ─── Download ZIP ─────────────────────────────────────────────────────────
  document.getElementById('btn-zip').addEventListener('click', async () => {
    if (!optimizedBlobs.length) { TC.showToast('Optimize files first.', 'error'); return; }
    if (typeof JSZip === 'undefined') { TC.showToast('JSZip not loaded.', 'error'); return; }

    const btn = document.getElementById('btn-zip');
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2"></i> Creating ZIP…';
    if (window.lucide) lucide.createIcons({ nodes: [btn] });

    const zip = new JSZip();
    for (const { blob, filename } of optimizedBlobs) {
      const ab = await blob.arrayBuffer();
      zip.file(filename, ab);
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    TC.downloadBlob(zipBlob, `imgpact-optimized-${Date.now()}.zip`);

    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="archive"></i> Download All as ZIP';
    if (window.lucide) lucide.createIcons({ nodes: [btn] });
  });

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function resolveFormat(sel, mimeType) {
    if (sel !== 'same') return sel;
    const map = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp' };
    return map[mimeType] || 'png';
  }

  function replaceExt(filename, fmt) {
    const extMap = { jpg: 'jpg', jpeg: 'jpg', png: 'png', webp: 'webp', bmp: 'bmp' };
    const base = filename.replace(/\.[^.]+$/, '');
    return `${base}-optimized.${extMap[fmt] || fmt}`;
  }
})();
