/**
 * imgpact tool-common.js
 * Shared utilities for all tool pages. Exposed as window.TC.
 */
(function () {
  'use strict';

  // ─── Toast ───────────────────────────────────────────────────────────────

  function getToastContainer() {
    let c = document.getElementById('toast-container');
    if (!c) {
      c = document.createElement('div');
      c.id = 'toast-container';
      document.body.appendChild(c);
    }
    return c;
  }

  function showToast(message, type = 'info') {
    const c = getToastContainer();
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = message;
    c.appendChild(t);
    setTimeout(() => { t.classList.add('toast-hide'); setTimeout(() => t.remove(), 300); }, 3000);
  }

  // ─── Spinner ─────────────────────────────────────────────────────────────

  function showSpinner(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.classList.add('processing');
    let ov = el.querySelector('.spinner-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.className = 'spinner-overlay';
      ov.innerHTML = '<div class="spinner"></div>';
      el.style.position = 'relative';
      el.appendChild(ov);
    }
    ov.style.display = 'flex';
  }

  function hideSpinner(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.classList.remove('processing');
    const ov = el.querySelector('.spinner-overlay');
    if (ov) ov.style.display = 'none';
  }

  // ─── File size ────────────────────────────────────────────────────────────

  function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // ─── Stats bar ───────────────────────────────────────────────────────────

  function showStats(containerId, originalSize, newSize) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const saved = originalSize - newSize;
    const pct = originalSize > 0 ? ((saved / originalSize) * 100).toFixed(1) : 0;
    const sign = saved >= 0 ? '-' : '+';
    const color = saved >= 0 ? '#16a34a' : '#dc2626';
    el.innerHTML = `
      <span>${formatFileSize(originalSize)}</span>
      <span style="color:var(--text-secondary)">→</span>
      <span>${formatFileSize(newSize)}</span>
      <span style="color:${color};font-weight:600">(${sign}${Math.abs(pct)}%)</span>
    `;
  }

  // ─── Preview helpers ──────────────────────────────────────────────────────

  function showPreview(containerId, blob, label = '') {
    const el = document.getElementById(containerId);
    if (!el) return;
    const url = URL.createObjectURL(blob);
    el.innerHTML = `
      <img src="${url}" style="max-width:100%;border-radius:6px;border:1px solid var(--border);" onload="URL.revokeObjectURL(this.src)">
      ${label ? `<div style="font-size:0.8rem;color:var(--text-secondary);margin-top:0.35rem">${label}</div>` : ''}
    `;
  }

  function showBeforeAfter(containerId, originalBlob, resultBlob) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const origUrl = URL.createObjectURL(originalBlob);
    const resUrl  = URL.createObjectURL(resultBlob);
    el.innerHTML = `
      <div class="ba-box">
        <div class="ba-label">Original · ${formatFileSize(originalBlob.size)}</div>
        <img class="ba-img" src="${origUrl}" onload="URL.revokeObjectURL(this.src)">
      </div>
      <div class="ba-box">
        <div class="ba-label">Result · ${formatFileSize(resultBlob.size)}</div>
        <img class="ba-img" src="${resUrl}" onload="URL.revokeObjectURL(this.src)">
      </div>
    `;
  }

  // ─── Download ─────────────────────────────────────────────────────────────

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ─── File uploader ────────────────────────────────────────────────────────

  /**
   * @param {string} dropZoneId
   * @param {function} onFileLoaded - called with (arrayBuffer, file)
   * @param {object} opts - { multiple: false }
   */
  function initFileUploader(dropZoneId, onFileLoaded, opts = {}) {
    const accept  = opts.accept   || 'image/*';
    const zone    = document.getElementById(dropZoneId);
    if (!zone) return;

    // Returns true if the file's MIME type matches the accept string.
    function acceptsFile(file) {
      const parts = accept.split(',').map(s => s.trim());
      return parts.some(a => {
        if (a.startsWith('.')) return file.name.toLowerCase().endsWith(a);
        if (a.endsWith('/*')) return file.type.startsWith(a.slice(0, -1));
        return file.type === a;
      });
    }

    // find or create hidden input
    let input = zone.querySelector('input[type=file]');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.style.display = 'none';
      zone.appendChild(input);
    } else {
      input.accept = accept;
    }
    if (opts.multiple) input.multiple = true;

    zone.addEventListener('click', (e) => {
      if (e.target !== input) input.click();
    });

    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const files = opts.multiple
        ? Array.from(e.dataTransfer.files)
        : [e.dataTransfer.files[0]].filter(Boolean);
      handleFiles(files);
    });

    input.addEventListener('change', () => {
      const files = opts.multiple ? Array.from(input.files) : [input.files[0]];
      handleFiles(files.filter(Boolean));
      input.value = '';
    });

    async function handleFiles(files) {
      if (!files.length) return;
      for (const file of files) {
        if (!acceptsFile(file)) {
          showToast(`"${file.name}" is not an accepted file type.`, 'error');
          continue;
        }
        const arrayBuffer = await file.arrayBuffer();
        onFileLoaded(arrayBuffer, file);
      }
    }
  }

  // ─── Expose ───────────────────────────────────────────────────────────────

  window.TC = {
    initFileUploader,
    showPreview,
    showBeforeAfter,
    downloadBlob,
    formatFileSize,
    showStats,
    showSpinner,
    hideSpinner,
    showToast,
  };
})();
