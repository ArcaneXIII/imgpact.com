(function () {
  'use strict';

  // ─── State ────────────────────────────────────────────────────────────────
  let frames     = [];        // { blob, objectUrl, delay_ms }
  let origSize   = 0;
  let selected   = new Set(); // frame indices
  let dragSrcIdx = null;

  // Preview player state
  let previewIdx   = 0;
  let previewTimer = null;
  let previewPlaying = true;

  // Crop state
  const HANDLE = 8, MIN_CROP = 10;
  let cropImg = null, cropScale = 1;
  let cropRect = { x: 0, y: 0, w: 0, h: 0 };
  let cropDrag = null;

  const cropCanvas = document.getElementById('crop-canvas');
  const cropCtx    = cropCanvas.getContext('2d');

  // ─── Upload ───────────────────────────────────────────────────────────────
  TC.initFileUploader('upload-zone', async (ab, file) => {
    origSize = file.size;
    TC.showSpinner('upload-zone');
    stopPreview();
    try {
      const { splitGif, getGifInfo } = await import('/static/js/wasm-bridge.js');
      const [rawFrames, info] = await Promise.all([splitGif(ab), getGifInfo(ab)]);
      frames = rawFrames.map(f => ({ blob: f.blob, objectUrl: URL.createObjectURL(f.blob), delay_ms: f.delay_ms }));
      renderInfoBar(info, file);
      renderTimeline();
      refreshPreview();
      document.getElementById('tool-controls').classList.remove('hidden');
      TC.showToast(`Loaded ${frames.length} frames`, 'success');
    } catch (err) {
      TC.showToast('Failed to load GIF: ' + err.message, 'error');
    } finally {
      TC.hideSpinner('upload-zone');
    }
  });

  function renderInfoBar(info, file) {
    document.getElementById('gif-info-bar').style.display = 'flex';
    document.getElementById('gif-info-bar').innerHTML = `
      <span class="fi-name">${file.name}</span>
      <span class="fi-meta">${TC.formatFileSize(file.size)}</span>
      <span class="fi-meta">${info.width} × ${info.height} px</span>
      <span class="fi-meta">${info.frame_count} frames</span>
      <span class="fi-meta">${(info.total_duration_ms / 1000).toFixed(2)}s</span>
    `;
  }

  // ─── Timeline ─────────────────────────────────────────────────────────────
  function renderTimeline() {
    const tl = document.getElementById('frame-timeline');
    document.getElementById('frame-count').textContent = frames.length;
    tl.innerHTML = '';

    frames.forEach((f, i) => {
      const card = document.createElement('div');
      card.className = 'frame-card editor-frame' + (selected.has(i) ? ' selected' : '');
      card.draggable = true;
      card.dataset.idx = i;
      card.innerHTML = `
        <img src="${f.objectUrl}" class="frame-thumb" draggable="false">
        <div class="frame-num">#${i + 1}</div>
        <div class="frame-delay-label">${f.delay_ms}ms</div>
      `;

      // Selection
      card.addEventListener('click', e => {
        if (e.ctrlKey || e.metaKey) {
          selected.has(i) ? selected.delete(i) : selected.add(i);
        } else if (e.shiftKey && selected.size > 0) {
          const last = Math.max(...selected);
          const min  = Math.min(last, i), max = Math.max(last, i);
          for (let j = min; j <= max; j++) selected.add(j);
        } else {
          selected.clear();
          selected.add(i);
        }
        renderTimeline();
      });

      // Drag-and-drop
      card.addEventListener('dragstart', () => { dragSrcIdx = i; card.classList.add('dragging'); });
      card.addEventListener('dragend',   () => card.classList.remove('dragging'));
      card.addEventListener('dragover',  e => { e.preventDefault(); card.classList.add('drag-over'); });
      card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
      card.addEventListener('drop', e => {
        e.preventDefault(); card.classList.remove('drag-over');
        if (dragSrcIdx === null || dragSrcIdx === i) return;
        const moved = frames.splice(dragSrcIdx, 1)[0];
        const wasSelected = selected.has(dragSrcIdx);
        selected.clear();
        frames.splice(i, 0, moved);
        if (wasSelected) selected.add(i);
        dragSrcIdx = null;
        renderTimeline();
        refreshPreview();
      });

      tl.appendChild(card);
    });
  }

  // ─── Frame operations ─────────────────────────────────────────────────────
  document.getElementById('btn-select-all').addEventListener('click', () => {
    frames.forEach((_, i) => selected.add(i));
    renderTimeline();
  });
  document.getElementById('btn-deselect').addEventListener('click', () => {
    selected.clear(); renderTimeline();
  });

  document.getElementById('btn-delete-sel').addEventListener('click', () => {
    if (!selected.size) { TC.showToast('Select frames first.', 'error'); return; }
    const idxs = [...selected].sort((a, b) => b - a);
    idxs.forEach(i => { URL.revokeObjectURL(frames[i].objectUrl); frames.splice(i, 1); });
    selected.clear();
    renderTimeline();
    refreshPreview();
  });

  document.getElementById('btn-dup-sel').addEventListener('click', () => {
    if (!selected.size) { TC.showToast('Select frames first.', 'error'); return; }
    const sorted = [...selected].sort((a, b) => a - b);
    let offset = 0;
    sorted.forEach(i => {
      const f = frames[i + offset];
      const newUrl = URL.createObjectURL(f.blob);
      frames.splice(i + offset + 1, 0, { ...f, objectUrl: newUrl });
      offset++;
    });
    selected.clear();
    renderTimeline();
    refreshPreview();
  });

  // ─── Delay controls ───────────────────────────────────────────────────────
  document.getElementById('btn-set-delay').addEventListener('click', () => {
    if (!selected.size) { TC.showToast('Select frames first.', 'error'); return; }
    const d = parseInt(document.getElementById('delay-input').value) || 100;
    selected.forEach(i => frames[i].delay_ms = d);
    renderTimeline();
    refreshPreview();
  });

  document.getElementById('btn-set-all-delay').addEventListener('click', () => {
    const d = parseInt(document.getElementById('delay-input').value) || 100;
    frames.forEach(f => f.delay_ms = d);
    renderTimeline();
    refreshPreview();
  });

  // ─── Speed ────────────────────────────────────────────────────────────────
  // Track current speed factor so we can reverse it before applying the new one
  let currentSpeedFactor = 1.0;

  document.querySelectorAll('.speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const factor = parseFloat(btn.dataset.speed);
      // Undo current factor, apply new one: newDelay = delay * currentFactor / factor
      frames.forEach(f => {
        f.delay_ms = Math.max(20, Math.round(f.delay_ms * currentSpeedFactor / factor));
      });
      currentSpeedFactor = factor;

      document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderTimeline();
      refreshPreview();
    });
  });

  // ─── Reverse ──────────────────────────────────────────────────────────────
  document.getElementById('btn-reverse').addEventListener('click', () => {
    frames.reverse();
    selected.clear();
    renderTimeline();
    refreshPreview();
    TC.showToast('Frames reversed.', 'success');
  });

  // ─── Transform all ────────────────────────────────────────────────────────
  async function transformAllFrames(action, ...args) {
    const btn = document.getElementById('btn-' + action) || document.getElementById('btn-rot90'); // fallback
    TC.showSpinner('frame-timeline');
    const { rotateImage, flipHorizontal, flipVertical, cropImage } = await import('/static/js/wasm-bridge.js');
    try {
      const newFrames = [];
      for (const f of frames) {
        const ab = await f.blob.arrayBuffer();
        let blob;
        if (action === 'rot90')  blob = await rotateImage(ab, 90, 'png');
        else if (action === 'rot270') blob = await rotateImage(ab, 270, 'png');
        else if (action === 'rot180') blob = await rotateImage(ab, 180, 'png');
        else if (action === 'fliph')  blob = await flipHorizontal(ab, 'png');
        else if (action === 'flipv')  blob = await flipVertical(ab, 'png');
        else if (action === 'crop')   blob = await cropImage(ab, ...args, 'png');
        URL.revokeObjectURL(f.objectUrl);
        newFrames.push({ blob, objectUrl: URL.createObjectURL(blob), delay_ms: f.delay_ms });
      }
      frames = newFrames;
      selected.clear();
      renderTimeline();
      refreshPreview();
      TC.showToast('Transform applied to all frames.', 'success');
    } catch (err) {
      TC.showToast('Transform failed: ' + err.message, 'error');
    } finally {
      TC.hideSpinner('frame-timeline');
    }
  }

  document.getElementById('btn-rot90').addEventListener('click',  () => transformAllFrames('rot90'));
  document.getElementById('btn-rot270').addEventListener('click', () => transformAllFrames('rot270'));
  document.getElementById('btn-rot180').addEventListener('click', () => transformAllFrames('rot180'));
  document.getElementById('btn-fliph').addEventListener('click',  () => transformAllFrames('fliph'));
  document.getElementById('btn-flipv').addEventListener('click',  () => transformAllFrames('flipv'));

  // ─── Crop overlay ─────────────────────────────────────────────────────────
  document.getElementById('btn-crop-all').addEventListener('click', async () => {
    if (!frames.length) return;
    const panel = document.getElementById('crop-overlay-panel');
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    const url = frames[0].objectUrl;
    cropImg = await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = url;
    });
    const maxW = cropCanvas.parentElement.clientWidth || 700;
    cropScale  = Math.min(1, maxW / cropImg.naturalWidth);
    cropCanvas.width  = Math.round(cropImg.naturalWidth  * cropScale);
    cropCanvas.height = Math.round(cropImg.naturalHeight * cropScale);
    cropRect = { x: 0, y: 0, w: cropImg.naturalWidth, h: cropImg.naturalHeight };
    syncCropInputs();
    drawCropCanvas();
  });

  document.getElementById('btn-cancel-crop').addEventListener('click', () => {
    document.getElementById('crop-overlay-panel').classList.add('hidden');
  });

  document.getElementById('btn-apply-crop').addEventListener('click', async () => {
    document.getElementById('crop-overlay-panel').classList.add('hidden');
    await transformAllFrames('crop', cropRect.x, cropRect.y, cropRect.w, cropRect.h);
  });

  // Crop canvas draw
  function drawCropCanvas() {
    cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
    cropCtx.drawImage(cropImg, 0, 0, cropCanvas.width, cropCanvas.height);
    const { x, y, w, h } = cropRect;
    const cx = x * cropScale, cy = y * cropScale, cw = w * cropScale, ch = h * cropScale;
    cropCtx.fillStyle = 'rgba(0,0,0,0.45)';
    cropCtx.fillRect(0, 0, cropCanvas.width, cy);
    cropCtx.fillRect(0, cy, cx, ch);
    cropCtx.fillRect(cx + cw, cy, cropCanvas.width - cx - cw, ch);
    cropCtx.fillRect(0, cy + ch, cropCanvas.width, cropCanvas.height - cy - ch);
    cropCtx.strokeStyle = '#4f46e5'; cropCtx.lineWidth = 1.5;
    cropCtx.strokeRect(cx, cy, cw, ch);
    cropHandles().forEach(h => {
      cropCtx.fillStyle = '#fff'; cropCtx.strokeStyle = '#4f46e5'; cropCtx.lineWidth = 1.5;
      cropCtx.fillRect(h.x - HANDLE / 2, h.y - HANDLE / 2, HANDLE, HANDLE);
      cropCtx.strokeRect(h.x - HANDLE / 2, h.y - HANDLE / 2, HANDLE, HANDLE);
    });
  }

  function cropHandles() {
    const { x, y, w, h } = cropRect;
    const cx = x * cropScale, cy = y * cropScale, cw = w * cropScale, ch = h * cropScale;
    const mx = cx + cw / 2, my = cy + ch / 2;
    return [
      { x: cx, y: cy }, { x: mx, y: cy }, { x: cx + cw, y: cy },
      { x: cx + cw, y: my }, { x: cx + cw, y: cy + ch },
      { x: mx, y: cy + ch }, { x: cx, y: cy + ch }, { x: cx, y: my },
    ];
  }

  function hitCropHandle(px, py) {
    return cropHandles().findIndex(h => Math.abs(px - h.x) <= HANDLE && Math.abs(py - h.y) <= HANDLE);
  }

  function cropCanvasPos(e) {
    const r = cropCanvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  cropCanvas.addEventListener('mousedown', e => {
    const { x, y } = cropCanvasPos(e);
    const hi = hitCropHandle(x, y);
    const insideX = x > cropRect.x * cropScale && x < (cropRect.x + cropRect.w) * cropScale;
    const insideY = y > cropRect.y * cropScale && y < (cropRect.y + cropRect.h) * cropScale;
    if (hi >= 0) cropDrag = { type: 'handle', handle: hi, startX: x, startY: y, startRect: { ...cropRect } };
    else if (insideX && insideY) cropDrag = { type: 'move', startX: x, startY: y, startRect: { ...cropRect } };
  });

  cropCanvas.addEventListener('mousemove', e => {
    if (!cropDrag) return;
    const { x, y } = cropCanvasPos(e);
    const dx = (x - cropDrag.startX) / cropScale, dy = (y - cropDrag.startY) / cropScale;
    const s = cropDrag.startRect;
    const natW = cropImg.naturalWidth, natH = cropImg.naturalHeight;
    if (cropDrag.type === 'move') {
      cropRect.x = Math.max(0, Math.min(natW - cropRect.w, s.x + dx));
      cropRect.y = Math.max(0, Math.min(natH - cropRect.h, s.y + dy));
    } else {
      let { x: nx, y: ny, w: nw, h: nh } = s;
      const h = cropDrag.handle;
      if ([0,6,7].includes(h)) { nx = s.x + dx; nw = s.w - dx; }
      if ([2,3,4].includes(h)) { nw = s.w + dx; }
      if ([0,1,2].includes(h)) { ny = s.y + dy; nh = s.h - dy; }
      if ([4,5,6].includes(h)) { nh = s.h + dy; }
      if (nw < MIN_CROP) { if ([0,6,7].includes(h)) nx = s.x + s.w - MIN_CROP; nw = MIN_CROP; }
      if (nh < MIN_CROP) { if ([0,1,2].includes(h)) ny = s.y + s.h - MIN_CROP; nh = MIN_CROP; }
      nx = Math.max(0, nx); ny = Math.max(0, ny);
      nw = Math.min(natW - nx, nw); nh = Math.min(natH - ny, nh);
      cropRect = { x: Math.round(nx), y: Math.round(ny), w: Math.round(nw), h: Math.round(nh) };
    }
    syncCropInputs();
    drawCropCanvas();
  });

  cropCanvas.addEventListener('mouseup',    () => cropDrag = null);
  cropCanvas.addEventListener('mouseleave', () => cropDrag = null);

  function syncCropInputs() {
    document.getElementById('ce-x').value = cropRect.x;
    document.getElementById('ce-y').value = cropRect.y;
    document.getElementById('ce-w').value = cropRect.w;
    document.getElementById('ce-h').value = cropRect.h;
  }

  ['ce-x','ce-y','ce-w','ce-h'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      cropRect.x = parseInt(document.getElementById('ce-x').value) || 0;
      cropRect.y = parseInt(document.getElementById('ce-y').value) || 0;
      cropRect.w = Math.max(MIN_CROP, parseInt(document.getElementById('ce-w').value) || MIN_CROP);
      cropRect.h = Math.max(MIN_CROP, parseInt(document.getElementById('ce-h').value) || MIN_CROP);
      drawCropCanvas();
    });
  });

  // ─── Preview player ───────────────────────────────────────────────────────
  async function refreshPreview() {
    if (!frames.length) return;
    stopPreview();
    // Build a quick GIF for the preview
    try {
      const previewGif = await assembleGif(0);
      const url = URL.createObjectURL(previewGif);
      const img = document.getElementById('preview-img');
      const old = img.src;
      img.src = url;
      if (old && old.startsWith('blob:')) URL.revokeObjectURL(old);
    } catch { /* preview failure is non-fatal */ }
    previewIdx = 0;
    updatePreviewIndicator();
    if (previewPlaying) startPreviewTick();
  }

  function startPreviewTick() {
    stopPreview();
    function tick() {
      const delay = frames[previewIdx]?.delay_ms || 100;
      previewTimer = setTimeout(() => {
        previewIdx = (previewIdx + 1) % frames.length;
        updatePreviewIndicator();
        if (previewPlaying) tick();
      }, delay);
    }
    tick();
  }

  function stopPreview() {
    clearTimeout(previewTimer);
    previewTimer = null;
  }

  function updatePreviewIndicator() {
    document.getElementById('frame-indicator').textContent =
      `${previewIdx + 1} / ${frames.length}`;
  }

  function setPlayPauseIcon(playing) {
    const btn = document.getElementById('btn-play-pause');
    btn.innerHTML = playing ? '<i data-lucide="pause"></i>' : '<i data-lucide="play"></i>';
    if (window.lucide) lucide.createIcons({ nodes: [btn] });
  }

  document.getElementById('btn-play-pause').addEventListener('click', () => {
    previewPlaying = !previewPlaying;
    setPlayPauseIcon(previewPlaying);
    if (previewPlaying) startPreviewTick();
    else stopPreview();
  });

  document.getElementById('btn-prev-frame').addEventListener('click', () => {
    previewPlaying = false; stopPreview();
    setPlayPauseIcon(false);
    previewIdx = (previewIdx - 1 + frames.length) % frames.length;
    updatePreviewIndicator();
  });

  document.getElementById('btn-next-frame').addEventListener('click', () => {
    previewPlaying = false; stopPreview();
    setPlayPauseIcon(false);
    previewIdx = (previewIdx + 1) % frames.length;
    updatePreviewIndicator();
  });

  // ─── Assemble GIF ─────────────────────────────────────────────────────────
  async function assembleGif(loopCount) {
    const { createGif } = await import('/static/js/wasm-bridge.js');
    if (!frames.length) throw new Error('No frames');

    // Determine dimensions from first frame
    const firstBlob = frames[0].blob;
    const firstAB   = await firstBlob.arrayBuffer();
    const dims = await new Promise(res => {
      const img = new Image();
      const url = URL.createObjectURL(new Blob([firstAB]));
      img.onload = () => { URL.revokeObjectURL(url); res({ w: img.naturalWidth, h: img.naturalHeight }); };
      img.src = url;
    });

    const offscreen = document.createElement('canvas');
    offscreen.width = dims.w; offscreen.height = dims.h;
    const octx = offscreen.getContext('2d');
    const rgbaFrames = [];
    const delays = [];

    for (const f of frames) {
      const ab  = await f.blob.arrayBuffer();
      const url = URL.createObjectURL(new Blob([ab]));
      await new Promise(res => {
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          octx.clearRect(0, 0, dims.w, dims.h);
          octx.drawImage(img, 0, 0, dims.w, dims.h);
          rgbaFrames.push(octx.getImageData(0, 0, dims.w, dims.h).data.buffer);
          delays.push(f.delay_ms);
          res();
        };
        img.src = url;
      });
    }

    return createGif(rgbaFrames, delays, dims.w, dims.h, loopCount);
  }

  // ─── Save GIF ─────────────────────────────────────────────────────────────
  document.getElementById('btn-save').addEventListener('click', async () => {
    if (!frames.length) return;
    if (window.trackToolUse) trackToolUse('gif-editor');
    const btn = document.getElementById('btn-save');
    btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2"></i> Building GIF…';
    if (window.lucide) lucide.createIcons({ nodes: [btn] });
    TC.showSpinner('preview-wrap');
    try {
      const loopCount = parseInt(document.getElementById('export-loop').value) || 0;
      const resultBlob = await assembleGif(loopCount);

      const url = URL.createObjectURL(resultBlob);
      const img = document.getElementById('preview-img');
      const old = img.src;
      img.src = url;
      if (old && old.startsWith('blob:')) URL.revokeObjectURL(old);

      const saved = origSize - resultBlob.size;
      const pct   = origSize > 0 ? ((saved / origSize) * 100).toFixed(1) : 0;
      const sign  = saved >= 0 ? '-' : '+';
      document.getElementById('export-stats').innerHTML =
        `${TC.formatFileSize(origSize)} → ${TC.formatFileSize(resultBlob.size)} <span style="color:${saved >= 0 ? '#16a34a' : '#dc2626'};font-weight:600">(${sign}${Math.abs(pct)}%)</span>`;

      const dlBtn = document.getElementById('btn-download');
      dlBtn.classList.remove('hidden');
      dlBtn.onclick = () => TC.downloadBlob(resultBlob, `imgpact-edited-${Date.now()}.gif`);
      TC.showToast('GIF saved!', 'success');
    } catch (err) {
      TC.showToast('Save failed: ' + err.message, 'error');
    } finally {
      btn.disabled = false; btn.innerHTML = '<i data-lucide="save"></i> Save GIF';
      if (window.lucide) lucide.createIcons({ nodes: [btn] });
      TC.hideSpinner('preview-wrap');
    }
  });

})();
