(function () {
  'use strict';

  // ─── State ────────────────────────────────────────────────────────────────
  let originalAB = null;   // original ArrayBuffer
  let originalFile = null;
  let resultBlob = null;
  let naturalW = 0, naturalH = 0;   // real image pixel dimensions
  let scale = 1;                     // canvas px per image px

  // Crop rect in IMAGE pixel coords
  let crop = { x: 0, y: 0, w: 0, h: 0 };

  // Drag state
  let drag = null; // { type: 'handle'|'move', handle: idx, startX, startY, startCrop }

  const HANDLE_SIZE = 8;
  const MIN_CROP = 10;

  const canvas  = document.getElementById('crop-canvas');
  const ctx     = canvas.getContext('2d');
  let img = null; // HTMLImageElement

  // ─── Upload ───────────────────────────────────────────────────────────────
  TC.initFileUploader('upload-zone', (ab, file) => {
    originalAB   = ab;
    originalFile = file;
    resultBlob   = null;

    const url = URL.createObjectURL(new Blob([ab], { type: file.type }));
    img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      naturalW = img.naturalWidth;
      naturalH = img.naturalHeight;
      setupCanvas();
      crop = { x: 0, y: 0, w: naturalW, h: naturalH };
      syncInputsFromCrop();
      draw();
      document.getElementById('tool-controls').classList.remove('hidden');
      document.getElementById('output-section').classList.add('hidden');

      const infoBar = document.getElementById('file-info-bar');
      infoBar.style.display = 'flex';
      infoBar.innerHTML = `
        <span class="fi-name">${file.name}</span>
        <span class="fi-meta">${TC.formatFileSize(file.size)}</span>
        <span class="fi-meta">${naturalW} × ${naturalH} px</span>
      `;
    };
    img.src = url;
  });

  // ─── Canvas sizing ────────────────────────────────────────────────────────
  function setupCanvas() {
    const maxW = canvas.parentElement.clientWidth || 700;
    scale = Math.min(1, maxW / naturalW);
    canvas.width  = Math.round(naturalW * scale);
    canvas.height = Math.round(naturalH * scale);
  }

  // ─── Draw ─────────────────────────────────────────────────────────────────
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const cx = crop.x * scale, cy = crop.y * scale;
    const cw = crop.w * scale, ch = crop.h * scale;

    // Dark overlay outside crop
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, canvas.width, cy);
    ctx.fillRect(0, cy, cx, ch);
    ctx.fillRect(cx + cw, cy, canvas.width - cx - cw, ch);
    ctx.fillRect(0, cy + ch, canvas.width, canvas.height - cy - ch);

    // Crop border
    ctx.strokeStyle = '#4f46e5';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx, cy, cw, ch);

    // Rule-of-thirds lines
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 0.5;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(cx + cw * i / 3, cy); ctx.lineTo(cx + cw * i / 3, cy + ch); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy + ch * i / 3); ctx.lineTo(cx + cw, cy + ch * i / 3); ctx.stroke();
    }

    // 8 handles
    handles().forEach(h => {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#4f46e5';
      ctx.lineWidth = 1.5;
      ctx.fillRect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      ctx.strokeRect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    });
  }

  // ─── Handle positions (canvas coords) ────────────────────────────────────
  function handles() {
    const cx = crop.x * scale, cy = crop.y * scale;
    const cw = crop.w * scale, ch = crop.h * scale;
    const mx = cx + cw / 2, my = cy + ch / 2;
    return [
      { x: cx,       y: cy       }, // 0 TL
      { x: mx,       y: cy       }, // 1 TM
      { x: cx + cw,  y: cy       }, // 2 TR
      { x: cx + cw,  y: my       }, // 3 MR
      { x: cx + cw,  y: cy + ch  }, // 4 BR
      { x: mx,       y: cy + ch  }, // 5 BM
      { x: cx,       y: cy + ch  }, // 6 BL
      { x: cx,       y: my       }, // 7 ML
    ];
  }

  function hitHandle(px, py) {
    return handles().findIndex(h =>
      Math.abs(px - h.x) <= HANDLE_SIZE && Math.abs(py - h.y) <= HANDLE_SIZE
    );
  }

  function insideCrop(px, py) {
    const cx = crop.x * scale, cy = crop.y * scale;
    return px > cx && px < cx + crop.w * scale &&
           py > cy && py < cy + crop.h * scale;
  }

  // ─── Mouse ────────────────────────────────────────────────────────────────
  function canvasPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener('mousedown', e => {
    const { x, y } = canvasPos(e);
    const hi = hitHandle(x, y);
    if (hi >= 0) {
      drag = { type: 'handle', handle: hi, startX: x, startY: y, startCrop: { ...crop } };
    } else if (insideCrop(x, y)) {
      drag = { type: 'move', startX: x, startY: y, startCrop: { ...crop } };
    }
  });

  canvas.addEventListener('mousemove', e => {
    if (!drag) {
      const { x, y } = canvasPos(e);
      const hi = hitHandle(x, y);
      canvas.style.cursor = hi >= 0 ? 'crosshair' : insideCrop(x, y) ? 'move' : 'default';
      return;
    }
    const { x, y } = canvasPos(e);
    const dx = (x - drag.startX) / scale;
    const dy = (y - drag.startY) / scale;
    const sc = drag.startCrop;

    if (drag.type === 'move') {
      crop.x = Math.max(0, Math.min(naturalW - crop.w, sc.x + dx));
      crop.y = Math.max(0, Math.min(naturalH - crop.h, sc.y + dy));
    } else {
      let { x: nx, y: ny, w: nw, h: nh } = sc;
      const h = drag.handle;
      if ([0,6,7].includes(h)) { nx = sc.x + dx; nw = sc.w - dx; }
      if ([2,3,4].includes(h)) { nw = sc.w + dx; }
      if ([0,1,2].includes(h)) { ny = sc.y + dy; nh = sc.h - dy; }
      if ([4,5,6].includes(h)) { nh = sc.h + dy; }

      // Aspect ratio lock
      const asp = getAspect();
      if (asp && [0,2,4,6].includes(h)) nh = nw / asp;

      if (nw < MIN_CROP) { if ([0,6,7].includes(h)) nx = sc.x + sc.w - MIN_CROP; nw = MIN_CROP; }
      if (nh < MIN_CROP) { if ([0,1,2].includes(h)) ny = sc.y + sc.h - MIN_CROP; nh = MIN_CROP; }
      nx = Math.max(0, nx); ny = Math.max(0, ny);
      nw = Math.min(naturalW - nx, nw); nh = Math.min(naturalH - ny, nh);
      crop = { x: Math.round(nx), y: Math.round(ny), w: Math.round(nw), h: Math.round(nh) };
    }
    syncInputsFromCrop();
    draw();
  });

  canvas.addEventListener('mouseup',    () => drag = null);
  canvas.addEventListener('mouseleave', () => drag = null);

  // ─── Aspect ratio ─────────────────────────────────────────────────────────
  function getAspect() {
    const val = document.getElementById('aspect-select').value;
    if (val === 'free') return null;
    if (val === 'custom') {
      const rw = parseFloat(document.getElementById('ratio-w').value) || 1;
      const rh = parseFloat(document.getElementById('ratio-h').value) || 1;
      return rw / rh;
    }
    const [a, b] = val.split(':').map(Number);
    return a / b;
  }

  document.getElementById('aspect-select').addEventListener('change', e => {
    const isCustom = e.target.value === 'custom';
    document.getElementById('custom-ratio-wrap').style.display = isCustom ? '' : 'none';
    applyAspectToCrop();
  });
  document.getElementById('ratio-w').addEventListener('input', applyAspectToCrop);
  document.getElementById('ratio-h').addEventListener('input', applyAspectToCrop);

  function applyAspectToCrop() {
    const asp = getAspect();
    if (!asp) return;
    crop.h = Math.round(crop.w / asp);
    crop.h = Math.max(MIN_CROP, Math.min(naturalH - crop.y, crop.h));
    syncInputsFromCrop();
    draw();
  }

  // ─── Manual inputs ────────────────────────────────────────────────────────
  function syncInputsFromCrop() {
    document.getElementById('crop-x').value = crop.x;
    document.getElementById('crop-y').value = crop.y;
    document.getElementById('crop-w').value = crop.w;
    document.getElementById('crop-h').value = crop.h;
  }

  ['crop-x','crop-y','crop-w','crop-h'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      crop.x = Math.max(0, parseInt(document.getElementById('crop-x').value) || 0);
      crop.y = Math.max(0, parseInt(document.getElementById('crop-y').value) || 0);
      crop.w = Math.max(MIN_CROP, parseInt(document.getElementById('crop-w').value) || MIN_CROP);
      crop.h = Math.max(MIN_CROP, parseInt(document.getElementById('crop-h').value) || MIN_CROP);
      crop.w = Math.min(crop.w, naturalW - crop.x);
      crop.h = Math.min(crop.h, naturalH - crop.y);
      draw();
    });
  });

  // ─── Crop action ──────────────────────────────────────────────────────────
  document.getElementById('btn-crop').addEventListener('click', async () => {
    if (!originalAB) return;
    if (window.trackToolUse) trackToolUse('crop');
    TC.showSpinner('canvas-wrap');
    try {
      const fmt = resolveFormat(document.getElementById('out-format').value, originalFile.type);
      const { cropImage } = await import('/static/js/wasm-bridge.js');
      resultBlob = await cropImage(originalAB, crop.x, crop.y, crop.w, crop.h, fmt);
      showOutput(fmt);
    } catch (err) {
      TC.showToast('Crop failed: ' + err.message, 'error');
    } finally {
      TC.hideSpinner('canvas-wrap');
    }
  });

  // ─── Output ───────────────────────────────────────────────────────────────
  function showOutput(fmt) {
    const origBlob = new Blob([originalAB], { type: originalFile.type });
    TC.showBeforeAfter('before-after', origBlob, resultBlob);
    TC.showStats('stats-bar', originalFile.size, resultBlob.size);
    document.getElementById('output-section').classList.remove('hidden');

    document.getElementById('btn-download').onclick = () => {
      TC.downloadBlob(resultBlob, `imgpact-cropped-${Date.now()}.${fmt}`);
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function resolveFormat(sel, mimeType) {
    if (sel !== 'same') return sel;
    const map = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp' };
    return map[mimeType] || 'png';
  }

  window.addEventListener('resize', () => {
    if (!img) return;
    setupCanvas();
    draw();
  });
})();
