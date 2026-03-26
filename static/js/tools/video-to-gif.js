import { videoToGif } from '/static/js/ffmpeg-bridge.js';

(function () {
  let videoFile = null;

  // ─── Upload ─────────────────────────────────────────────────────────────
  // Use raw file input since TC.initFileUploader works for images — wire manually
  const zone  = document.getElementById('upload-zone');
  const input = document.getElementById('file-input');

  zone.addEventListener('click', e => { if (e.target !== input) input.click(); });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over');
    handleFile(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', () => { handleFile(input.files[0]); input.value = ''; });

  function handleFile(file) {
    if (!file || !file.type.startsWith('video/')) {
      TC.showToast('Please drop a video file.', 'error'); return;
    }
    if (file.size > 200 * 1024 * 1024) {
      TC.showToast('File exceeds 200 MB limit.', 'error'); return;
    }
    videoFile = file;
    const url = URL.createObjectURL(file);
    const vid = document.getElementById('video-preview');
    vid.src = url;
    vid.onloadedmetadata = () => {
      const dur = vid.duration;
      document.getElementById('video-meta').textContent =
        `${file.name} · ${TC.formatFileSize(file.size)} · ${dur.toFixed(1)}s`;
      document.getElementById('end-time').value = Math.min(30, dur).toFixed(1);
      document.getElementById('end-time').max   = dur;
      document.getElementById('start-time').max = dur;
    };
    document.getElementById('tool-controls').classList.remove('hidden');
    document.getElementById('output-section').classList.add('hidden');
  }

  // ─── Convert ─────────────────────────────────────────────────────────────
  document.getElementById('btn-convert').addEventListener('click', async () => {
    if (!videoFile) return;
    if (window.trackToolUse) trackToolUse('video-to-gif');
    const btn = document.getElementById('btn-convert');
    btn.disabled = true;

    showProgress('Loading FFmpeg (first time ~30s)…', 0);

    try {
      const blob = await videoToGif(videoFile, {
        startTime: parseFloat(document.getElementById('start-time').value) || 0,
        endTime:   parseFloat(document.getElementById('end-time').value)   || null,
        width:     parseInt(document.getElementById('out-width').value)    || 480,
        fps:       parseInt(document.getElementById('fps').value)          || 10,
        colors:    parseInt(document.getElementById('colors').value)       || 256,
      }, ({ stage, ratio }) => showProgress(stage, ratio));

      hideProgress();
      const url = URL.createObjectURL(blob);
      document.getElementById('result-gif').src = url;
      document.getElementById('stats-bar').innerHTML =
        `<span>Input: ${TC.formatFileSize(videoFile.size)}</span>` +
        `<span>→ GIF: ${TC.formatFileSize(blob.size)}</span>`;
      document.getElementById('output-section').classList.remove('hidden');
      document.getElementById('btn-download').onclick = () =>
        TC.downloadBlob(blob, `imgpact-gif-${Date.now()}.gif`);
      TC.showToast('Converted to GIF!', 'success');
    } catch (err) {
      hideProgress();
      TC.showToast('Conversion failed: ' + err.message, 'error');
      console.error(err);
    } finally {
      btn.disabled = false;
    }
  });

  function showProgress(label, ratio) {
    const wrap = document.getElementById('progress-wrap');
    wrap.style.display = '';
    document.getElementById('progress-label').textContent = label;
    document.getElementById('progress-fill').style.width  = Math.round(ratio * 100) + '%';
  }
  function hideProgress() {
    document.getElementById('progress-wrap').style.display = 'none';
  }
})();
