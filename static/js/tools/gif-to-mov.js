import { gifToVideo } from '/static/js/ffmpeg-bridge.js';

(function () {
  let gifFile = null;

  TC.initFileUploader('upload-zone', (ab, file) => {
    gifFile = file;
    const infoBar = document.getElementById('file-info-bar');
    infoBar.style.display = 'flex';
    infoBar.innerHTML = `<span class="fi-name">${file.name}</span><span class="fi-meta">${TC.formatFileSize(file.size)}</span>`;
    document.getElementById('tool-controls').classList.remove('hidden');
    document.getElementById('output-section').classList.add('hidden');
  }, { accept: 'image/gif' });

  document.getElementById('btn-convert').addEventListener('click', async () => {
    if (!gifFile) return;
    if (window.trackToolUse) trackToolUse('gif-to-mov');
    const btn = document.getElementById('btn-convert');
    btn.disabled = true;
    showProgress('Loading FFmpeg (first time ~30s)…', 0);

    try {
      const blob = await gifToVideo(gifFile, 'mov', 0, ({ stage, ratio }) => showProgress(stage, ratio));

      hideProgress();
      document.getElementById('stats-bar').innerHTML =
        `<span>GIF: ${TC.formatFileSize(gifFile.size)}</span><span>→ MOV: ${TC.formatFileSize(blob.size)}</span>`;
      document.getElementById('output-section').classList.remove('hidden');
      document.getElementById('btn-download').onclick = () =>
        TC.downloadBlob(blob, `imgpact-video-${Date.now()}.mov`);
      TC.showToast('Converted to MOV! Click download.', 'success');
    } catch (err) {
      hideProgress();
      TC.showToast('Conversion failed: ' + (err?.message || String(err)), 'error');
      console.error(err);
    } finally {
      btn.disabled = false;
    }
  });

  function showProgress(label, ratio) {
    const w = document.getElementById('progress-wrap');
    w.style.display = '';
    document.getElementById('progress-label').textContent = label;
    document.getElementById('progress-fill').style.width = Math.round(ratio * 100) + '%';
  }
  function hideProgress() { document.getElementById('progress-wrap').style.display = 'none'; }
})();
