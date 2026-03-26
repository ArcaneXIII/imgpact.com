(function () {
  'use strict';

  let frames  = [];   // { blob, delay_ms, index }
  let frameUrls = [];
  let currentFrame = 0;
  let playing = true;
  let playTimer = null;

  TC.initFileUploader('upload-zone', async (ab, file) => {
    TC.showSpinner('upload-zone');
    stopPlayback();
    if (window.trackToolUse) trackToolUse('gif-analyzer');
    try {
      const { getGifInfo, splitGif } = await import('/static/js/wasm-bridge.js');
      const [info, splitResult] = await Promise.all([getGifInfo(ab), splitGif(ab)]);
      frames     = splitResult;
      frameUrls  = frames.map(f => URL.createObjectURL(f.blob));

      renderInfoPanel(info, file.size);
      renderFrameTable(frames);
      setupPreviewPlayer(file, ab);

      document.getElementById('tool-controls').classList.remove('hidden');
    } catch (err) {
      TC.showToast('Analysis failed: ' + err.message, 'error');
    } finally {
      TC.hideSpinner('upload-zone');
    }
  });

  // ─── Info panel ───────────────────────────────────────────────────────────
  function renderInfoPanel(info, fileSize) {
    const loopStr = info.loop_count === 0 ? 'Infinite' : `${info.loop_count} time${info.loop_count > 1 ? 's' : ''}`;
    document.getElementById('info-panel').innerHTML = `
      <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);margin-bottom:0.75rem">GIF Info</div>
      <div class="info-kv-list">
        <div class="info-kv"><span class="info-key">Dimensions</span><span class="info-val">${info.width} × ${info.height} px</span></div>
        <div class="info-kv"><span class="info-key">File size</span><span class="info-val">${TC.formatFileSize(fileSize)}</span></div>
        <div class="info-kv"><span class="info-key">Frames</span><span class="info-val">${info.frame_count}</span></div>
        <div class="info-kv"><span class="info-key">Duration</span><span class="info-val">${(info.total_duration_ms / 1000).toFixed(2)}s</span></div>
        <div class="info-kv"><span class="info-key">Loop</span><span class="info-val">${loopStr}</span></div>
        <div class="info-kv"><span class="info-key">Avg delay</span><span class="info-val">${info.frame_count > 0 ? Math.round(info.total_duration_ms / info.frame_count) : 0}ms / frame</span></div>
      </div>
    `;
  }

  // ─── Frame table ──────────────────────────────────────────────────────────
  function renderFrameTable(frames) {
    const tbody = document.getElementById('frame-tbody');
    tbody.innerHTML = '';
    frames.forEach(({ blob, delay_ms, index }) => {
      const url = URL.createObjectURL(blob);
      const tr  = document.createElement('tr');
      tr.id = `frame-row-${index}`;
      tr.innerHTML = `
        <td style="font-family:var(--font-mono);font-size:0.82rem">${index + 1}</td>
        <td><img src="${url}" style="width:40px;height:40px;object-fit:cover;border-radius:3px;border:1px solid var(--border)" onload="URL.revokeObjectURL(this.src)"></td>
        <td style="font-family:var(--font-mono);font-size:0.82rem">${delay_ms}ms</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // ─── Preview player ───────────────────────────────────────────────────────
  function setupPreviewPlayer(file, ab) {
    // Show the original GIF playing
    const gifBlob = new Blob([ab], { type: 'image/gif' });
    const gifUrl  = URL.createObjectURL(gifBlob);
    const preview = document.getElementById('gif-preview');
    preview.src   = gifUrl;

    // Frame-by-frame canvas overlay when paused
    currentFrame  = 0;
    playing       = true;
    updatePlayBtn();
    startPlayback();
  }

  function startPlayback() {
    if (!frames.length) return;
    stopPlayback();
    function tick() {
      const delay = frames[currentFrame]?.delay_ms || 100;
      playTimer = setTimeout(() => {
        currentFrame = (currentFrame + 1) % frames.length;
        highlightRow(currentFrame);
        updateIndicator();
        if (playing) tick();
      }, delay);
    }
    tick();
  }

  function stopPlayback() {
    clearTimeout(playTimer);
    playTimer = null;
  }

  function updatePlayBtn() {
    const btn = document.getElementById('btn-play');
    btn.innerHTML = playing ? '<i data-lucide="pause"></i>' : '<i data-lucide="play"></i>';
    if (window.lucide) lucide.createIcons({ nodes: [btn] });
  }

  function highlightRow(idx) {
    document.querySelectorAll('#frame-tbody tr').forEach(r => r.classList.remove('frame-row-active'));
    const row = document.getElementById(`frame-row-${idx}`);
    if (row) { row.classList.add('frame-row-active'); row.scrollIntoView({ block: 'nearest' }); }
  }

  function updateIndicator() {
    document.getElementById('frame-indicator').textContent =
      `Frame ${currentFrame + 1} / ${frames.length}`;
  }

  document.getElementById('btn-play').addEventListener('click', () => {
    playing = !playing;
    updatePlayBtn();
    if (playing) {
      // Restore live GIF preview
      document.getElementById('gif-preview').style.display = '';
      startPlayback();
    } else {
      stopPlayback();
      showStaticFrame(currentFrame);
    }
  });

  document.getElementById('btn-prev').addEventListener('click', () => {
    playing = false; updatePlayBtn(); stopPlayback();
    currentFrame = (currentFrame - 1 + frames.length) % frames.length;
    showStaticFrame(currentFrame);
    highlightRow(currentFrame);
    updateIndicator();
  });

  document.getElementById('btn-next').addEventListener('click', () => {
    playing = false; updatePlayBtn(); stopPlayback();
    currentFrame = (currentFrame + 1) % frames.length;
    showStaticFrame(currentFrame);
    highlightRow(currentFrame);
    updateIndicator();
  });

  function showStaticFrame(idx) {
    if (!frameUrls[idx]) return;
    const preview = document.getElementById('gif-preview');
    const old = preview.src;
    preview.src = frameUrls[idx];
    if (old && old.startsWith('blob:') && old !== frameUrls[idx]) {
      // Don't revoke shared frameUrls
    }
  }
})();
