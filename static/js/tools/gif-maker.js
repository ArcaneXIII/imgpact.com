(function () {
  'use strict';

  // ─── State ────────────────────────────────────────────────────────────────
  let frames = [];  // Array of { file, objectUrl, delay }
  let resultBlob = null;
  let dragSrcIdx = null;

  // ─── Upload ───────────────────────────────────────────────────────────────
  TC.initFileUploader('upload-zone', addFrame, { multiple: true });

  document.getElementById('btn-add-more').addEventListener('click', () =>
    document.getElementById('add-more-input').click());

  document.getElementById('add-more-input').addEventListener('change', async (e) => {
    for (const file of Array.from(e.target.files)) {
      if (!file.type.startsWith('image/')) continue;
      await addFrame(await file.arrayBuffer(), file);
    }
    e.target.value = '';
  });

  function addFrame(ab, file) {
    const blob = new Blob([ab], { type: file.type });
    const url  = URL.createObjectURL(blob);
    const delay = parseInt(document.getElementById('global-delay').value) || 100;
    frames.push({ file, ab, url, delay });
    renderTimeline();
    document.getElementById('tool-controls').classList.remove('hidden');
  }

  // ─── Timeline ─────────────────────────────────────────────────────────────
  function renderTimeline() {
    const tl = document.getElementById('frame-timeline');
    document.getElementById('frame-count').textContent = frames.length;
    tl.innerHTML = '';

    frames.forEach((f, i) => {
      const card = document.createElement('div');
      card.className = 'frame-card';
      card.draggable = true;
      card.dataset.idx = i;
      card.innerHTML = `
        <img src="${f.url}" class="frame-thumb" draggable="false">
        <div class="frame-num">#${i + 1}</div>
        ${document.getElementById('per-frame-toggle').checked
          ? `<input type="number" class="frame-delay-input" value="${f.delay}" min="20" max="10000">`
          : `<div class="frame-delay-label">${f.delay}ms</div>`}
        <div class="frame-actions">
          <button class="frame-btn dup-btn" title="Duplicate">⧉</button>
          <button class="frame-btn del-btn" title="Remove">×</button>
        </div>
      `;

      // Per-frame delay sync
      const dInput = card.querySelector('.frame-delay-input');
      if (dInput) dInput.addEventListener('change', e => { frames[i].delay = parseInt(e.target.value) || 100; });

      card.querySelector('.del-btn').addEventListener('click', e => { e.stopPropagation(); removeFrame(i); });
      card.querySelector('.dup-btn').addEventListener('click', e => { e.stopPropagation(); duplicateFrame(i); });

      // Drag-and-drop
      card.addEventListener('dragstart', () => { dragSrcIdx = i; card.classList.add('dragging'); });
      card.addEventListener('dragend',   () => card.classList.remove('dragging'));
      card.addEventListener('dragover',  e => { e.preventDefault(); card.classList.add('drag-over'); });
      card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
      card.addEventListener('drop', e => {
        e.preventDefault();
        card.classList.remove('drag-over');
        if (dragSrcIdx === null || dragSrcIdx === i) return;
        const moved = frames.splice(dragSrcIdx, 1)[0];
        frames.splice(i, 0, moved);
        dragSrcIdx = null;
        renderTimeline();
      });

      tl.appendChild(card);
    });
  }

  function removeFrame(i) {
    URL.revokeObjectURL(frames[i].url);
    frames.splice(i, 1);
    renderTimeline();
    if (!frames.length) document.getElementById('tool-controls').classList.add('hidden');
  }

  function duplicateFrame(i) {
    const f = frames[i];
    const newUrl = URL.createObjectURL(new Blob([f.ab], { type: f.file.type }));
    frames.splice(i + 1, 0, { ...f, url: newUrl });
    renderTimeline();
  }

  // ─── Global delay sync ────────────────────────────────────────────────────
  document.getElementById('global-delay').addEventListener('change', e => {
    if (document.getElementById('per-frame-toggle').checked) return;
    const d = parseInt(e.target.value) || 100;
    frames.forEach(f => f.delay = d);
    renderTimeline();
  });

  document.getElementById('per-frame-toggle').addEventListener('change', renderTimeline);

  // ─── Loop radio ───────────────────────────────────────────────────────────
  document.querySelectorAll('input[name="loop"]').forEach(r => {
    r.addEventListener('change', () => {
      document.getElementById('loop-count').disabled = r.value !== 'custom';
    });
  });

  // ─── Size radio ───────────────────────────────────────────────────────────
  document.querySelectorAll('input[name="size"]').forEach(r => {
    r.addEventListener('change', () => {
      const custom = r.value === 'custom';
      document.getElementById('out-width').disabled  = !custom;
      document.getElementById('out-height').disabled = !custom;
    });
  });

  // ─── Create GIF ───────────────────────────────────────────────────────────
  document.getElementById('btn-create').addEventListener('click', async () => {
    if (frames.length < 1) { TC.showToast('Add at least one frame.', 'error'); return; }
    if (window.trackToolUse) trackToolUse('gif-maker');

    const btn = document.getElementById('btn-create');
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2"></i> Processing…';
    if (window.lucide) lucide.createIcons({ nodes: [btn] });

    try {
      // Determine output dimensions from first frame
      const firstImg = await loadImage(frames[0].url);
      let outW, outH;
      const sizeMode = document.querySelector('input[name="size"]:checked').value;
      if (sizeMode === 'custom') {
        outW = parseInt(document.getElementById('out-width').value)  || firstImg.naturalWidth;
        outH = parseInt(document.getElementById('out-height').value) || firstImg.naturalHeight;
      } else {
        outW = firstImg.naturalWidth;
        outH = firstImg.naturalHeight;
      }

      // Extract RGBA from each frame via offscreen canvas
      const offscreen = document.createElement('canvas');
      offscreen.width = outW; offscreen.height = outH;
      const octx = offscreen.getContext('2d');

      const rgbaFrames = [];
      const delays = [];

      for (const f of frames) {
        const img = await loadImage(f.url);
        octx.clearRect(0, 0, outW, outH);
        octx.drawImage(img, 0, 0, outW, outH);
        const id = octx.getImageData(0, 0, outW, outH);
        rgbaFrames.push(id.data.buffer);
        delays.push(f.delay);
      }

      const loopRadio = document.querySelector('input[name="loop"]:checked');
      const loopCount = loopRadio.value === 'custom'
        ? parseInt(document.getElementById('loop-count').value) || 0
        : 0;

      const { createGif } = await import('/static/js/wasm-bridge.js');
      resultBlob = await createGif(rgbaFrames, delays, outW, outH, loopCount);

      // Preview
      const previewUrl = URL.createObjectURL(resultBlob);
      const previewImg = document.getElementById('gif-preview');
      previewImg.src = previewUrl;
      document.getElementById('stats-bar').innerHTML = `
        <span>${frames.length} frames</span>
        <span>${outW} × ${outH} px</span>
        <span>${TC.formatFileSize(resultBlob.size)}</span>
      `;
      document.getElementById('output-section').classList.remove('hidden');

      document.getElementById('btn-download').onclick = () => {
        TC.downloadBlob(resultBlob, `imgpact-animation-${Date.now()}.gif`);
      };
      TC.showToast('GIF created!', 'success');
    } catch (err) {
      TC.showToast('Failed: ' + err.message, 'error');
      console.error(err);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="clapperboard"></i> Create GIF';
      if (window.lucide) lucide.createIcons({ nodes: [btn] });
    }
  });

  // ─── Helper ───────────────────────────────────────────────────────────────
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload  = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }
})();
