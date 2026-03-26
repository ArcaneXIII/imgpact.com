(function () {
  'use strict';

  let originalFile = null;
  let workingImg   = null;   // HTMLImageElement of current baked state
  let workingBlob  = null;   // Blob of current baked state (for download)
  let origBlob     = null;   // very first upload blob (for reset)

  const canvas  = document.getElementById('text-canvas');
  const ctx     = canvas.getContext('2d');

  // Text position in canvas coords
  let textX = 20, textY = 40;
  let isDragging = false, dragOffX = 0, dragOffY = 0;

  // ─── Upload ───────────────────────────────────────────────────────────────
  TC.initFileUploader('upload-zone', (ab, file) => {
    originalFile = file;
    origBlob = new Blob([ab], { type: file.type });
    workingBlob  = origBlob;

    const url = URL.createObjectURL(origBlob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      workingImg = img;
      setupCanvas(img);
      // Sensible default position
      textX = Math.round(canvas.width * 0.04);
      textY = Math.round(canvas.height * 0.08);
      syncPositionInputs();
      drawCanvas();

      document.getElementById('btn-reset').disabled = false;
      document.getElementById('tool-controls').classList.remove('hidden');
      document.getElementById('output-section').classList.add('hidden');

      const infoBar = document.getElementById('file-info-bar');
      infoBar.style.display = 'flex';
      infoBar.innerHTML = `<span class="fi-name">${file.name}</span><span class="fi-meta">${TC.formatFileSize(file.size)}</span>`;
    };
    img.src = URL.createObjectURL(origBlob);
  });

  // ─── Canvas setup ─────────────────────────────────────────────────────────
  function setupCanvas(img) {
    const maxW = canvas.parentElement.clientWidth || 800;
    const scale = Math.min(1, maxW / img.naturalWidth);
    canvas.width  = Math.round(img.naturalWidth  * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
  }

  // ─── Draw ─────────────────────────────────────────────────────────────────
  function drawCanvas() {
    if (!workingImg) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(workingImg, 0, 0, canvas.width, canvas.height);

    const text     = document.getElementById('text-input').value;
    const fontSize = parseInt(document.getElementById('font-size').value);
    const color    = document.getElementById('text-color').value;
    const bold     = document.getElementById('bold-check').checked;
    const outline  = document.getElementById('outline-check').checked;

    if (!text) return;

    ctx.font = `${bold ? 'bold ' : ''}${fontSize}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';

    if (outline) {
      ctx.strokeStyle = '#000000';
      ctx.lineWidth   = Math.max(2, fontSize * 0.07);
      ctx.lineJoin    = 'round';
      ctx.strokeText(text, textX, textY);
    }
    ctx.fillStyle = color;
    ctx.fillText(text, textX, textY);
  }

  // ─── Live preview on any control change ───────────────────────────────────
  ['text-input','font-size','text-color','bold-check','outline-check'].forEach(id => {
    document.getElementById(id).addEventListener('input', drawCanvas);
  });
  document.getElementById('font-size').addEventListener('input', e => {
    document.getElementById('font-size-label').textContent = e.target.value + 'px';
  });

  // ─── Position inputs ──────────────────────────────────────────────────────
  document.getElementById('text-x').addEventListener('input', e => {
    textX = parseInt(e.target.value) || 0;
    drawCanvas();
  });
  document.getElementById('text-y').addEventListener('input', e => {
    textY = parseInt(e.target.value) || 0;
    drawCanvas();
  });

  function syncPositionInputs() {
    document.getElementById('text-x').value = Math.round(textX);
    document.getElementById('text-y').value = Math.round(textY);
  }

  // ─── Canvas click/drag to position ───────────────────────────────────────
  function canvasXY(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener('mousedown', e => {
    const { x, y } = canvasXY(e);
    // Check if click is near current text position
    const text = document.getElementById('text-input').value;
    const fontSize = parseInt(document.getElementById('font-size').value);
    ctx.font = `${document.getElementById('bold-check').checked ? 'bold ' : ''}${fontSize}px system-ui, sans-serif`;
    const tw = ctx.measureText(text).width;
    if (x >= textX - 5 && x <= textX + tw + 5 && y >= textY - 5 && y <= textY + fontSize + 5) {
      isDragging = true;
      dragOffX = x - textX;
      dragOffY = y - textY;
    } else {
      // Click elsewhere sets new position
      textX = x; textY = y;
      syncPositionInputs();
      drawCanvas();
    }
  });

  canvas.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const { x, y } = canvasXY(e);
    textX = x - dragOffX;
    textY = y - dragOffY;
    syncPositionInputs();
    drawCanvas();
  });

  canvas.addEventListener('mouseup',    () => isDragging = false);
  canvas.addEventListener('mouseleave', () => isDragging = false);

  // ─── Bake text into image ─────────────────────────────────────────────────
  document.getElementById('btn-bake').addEventListener('click', () => {
    if (!workingImg) return;
    if (window.trackToolUse) trackToolUse('add-text');
    drawCanvas(); // ensure latest state is on canvas

    const fmt = document.getElementById('out-format').value;
    const mimeMap = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
    const mime = mimeMap[fmt] || 'image/png';

    canvas.toBlob(blob => {
      if (!blob) { TC.showToast('Export failed.', 'error'); return; }
      workingBlob = blob;

      // Update workingImg so next layer bakes on top of this one
      const url = URL.createObjectURL(blob);
      const next = new Image();
      next.onload = () => {
        URL.revokeObjectURL(url);
        workingImg = next;
        setupCanvas(next);
        drawCanvas(); // redraw with new base
      };
      next.src = URL.createObjectURL(blob);

      // Show output
      TC.showBeforeAfter('before-after', origBlob, blob);
      document.getElementById('output-section').classList.remove('hidden');
      document.getElementById('btn-download').onclick = () => {
        TC.downloadBlob(blob, `imgpact-text-${Date.now()}.${fmt}`);
      };
      TC.showToast('Text baked in.', 'success');
    }, mime, 0.93);
  });

  // ─── Reset ────────────────────────────────────────────────────────────────
  document.getElementById('btn-reset').addEventListener('click', () => {
    const url = URL.createObjectURL(origBlob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      workingImg  = img;
      workingBlob = origBlob;
      setupCanvas(img);
      textX = Math.round(canvas.width * 0.04);
      textY = Math.round(canvas.height * 0.08);
      syncPositionInputs();
      drawCanvas();
      document.getElementById('output-section').classList.add('hidden');
      TC.showToast('Reset to original.', 'info');
    };
    img.src = URL.createObjectURL(origBlob);
  });

  // ─── Download ─────────────────────────────────────────────────────────────
  document.getElementById('btn-download').addEventListener('click', () => {
    if (!workingBlob) return;
    const fmt = document.getElementById('out-format').value;
    TC.downloadBlob(workingBlob, `imgpact-text-${Date.now()}.${fmt}`);
  });

  window.addEventListener('resize', () => {
    if (!workingImg) return;
    setupCanvas(workingImg);
    drawCanvas();
  });
})();
