/**
 * imgpact ffmpeg-bridge.js
 * Lazy-loads FFmpeg.wasm and wraps video conversion operations.
 *
 * Requires COOP/COEP headers (served by Axum for SharedArrayBuffer support).
 */

const FFMPEG_BASE = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd';
const UTIL_BASE   = 'https://unpkg.com/@ffmpeg/util@0.12.1/dist/umd';
const CORE_BASE   = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';

let _ffmpeg   = null;
let _loading  = null;   // in-flight promise

// ─── Script loader ────────────────────────────────────────────────────────────

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ─── FFmpeg loader ────────────────────────────────────────────────────────────

/**
 * @param {function} onProgress - called with { stage: string, ratio: number 0-1 }
 * @returns {FFmpeg instance}
 */
export async function loadFFmpeg(onProgress = () => {}) {
  if (_ffmpeg) return _ffmpeg;
  if (_loading) return _loading;

  _loading = (async () => {
    onProgress({ stage: 'Loading FFmpeg scripts…', ratio: 0.05 });

    await loadScript(`${FFMPEG_BASE}/ffmpeg.js`);
    await loadScript(`${UTIL_BASE}/util.js`);

    const { FFmpeg }    = window.FFmpegWASM  || {};
    const { toBlobURL } = window.FFmpegUtil  || {};

    if (!FFmpeg || !toBlobURL) {
      throw new Error('FFmpeg UMD globals not found. Check CDN URLs.');
    }

    onProgress({ stage: 'Downloading FFmpeg core (~30 MB)…', ratio: 0.1 });

    const ffmpeg = new FFmpeg();

    // Pipe FFmpeg log to console for debugging
    ffmpeg.on('log', ({ message }) => console.debug('[ffmpeg]', message));

    // Map FFmpeg progress events
    ffmpeg.on('progress', ({ progress }) => {
      onProgress({ stage: 'Converting…', ratio: 0.4 + progress * 0.6 });
    });

    onProgress({ stage: 'Fetching core WASM…', ratio: 0.15 });

    await ffmpeg.load({
      coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`,   'text/javascript'),
      wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    _ffmpeg  = ffmpeg;
    _loading = null;
    return ffmpeg;
  })();

  return _loading;
}

// ─── videoToGif ───────────────────────────────────────────────────────────────

/**
 * Convert a video file segment to an animated GIF.
 * @param {File} videoFile
 * @param {{ startTime: number, endTime: number, width: number, fps: number, colors: number }} options
 * @param {function} onProgress
 * @returns {Promise<Blob>} GIF blob
 */
export async function videoToGif(videoFile, options = {}, onProgress = () => {}) {
  const {
    startTime = 0,
    endTime   = null,
    width     = 480,
    fps       = 10,
    colors    = 256,
  } = options;

  const ffmpeg = await loadFFmpeg(onProgress);
  const ext    = videoFile.name.split('.').pop().toLowerCase() || 'mp4';
  const inName = `input.${ext}`;

  onProgress({ stage: 'Writing input…', ratio: 0.35 });
  await ffmpeg.writeFile(inName, new Uint8Array(await videoFile.arrayBuffer()));

  const duration = endTime !== null ? endTime - startTime : null;

  const vf = [
    `fps=${fps}`,
    `scale=${width}:-1:flags=lanczos`,
    `split[s0][s1]`,
    `[s0]palettegen=max_colors=${colors}[p]`,
    `[s1][p]paletteuse`,
  ].join(',');

  const args = ['-i', inName];
  if (startTime > 0)      args.push('-ss', String(startTime));
  if (duration !== null)  args.push('-t',  String(duration));
  args.push('-vf', vf, '-loop', '0', 'output.gif');

  onProgress({ stage: 'Converting to GIF…', ratio: 0.4 });
  await ffmpeg.exec(args);

  onProgress({ stage: 'Reading output…', ratio: 0.95 });
  const data = await ffmpeg.readFile('output.gif');
  await ffmpeg.deleteFile(inName).catch(() => {});
  await ffmpeg.deleteFile('output.gif').catch(() => {});

  onProgress({ stage: 'Done', ratio: 1 });
  return new Blob([data.buffer], { type: 'image/gif' });
}

// ─── gifToVideo ───────────────────────────────────────────────────────────────

/**
 * Convert an animated GIF to a video format.
 * @param {File} gifFile
 * @param {'mp4'|'webm'|'mov'} format
 * @param {number} crf  - quality (lower = better)
 * @param {function} onProgress
 * @returns {Promise<Blob>}
 */
export async function gifToVideo(gifFile, format, crf = 23, onProgress = () => {}) {
  const ffmpeg = await loadFFmpeg(onProgress);

  onProgress({ stage: 'Writing input…', ratio: 0.35 });
  await ffmpeg.writeFile('input.gif', new Uint8Array(await gifFile.arrayBuffer()));

  let args, outName, mimeType;

  if (format === 'mp4') {
    outName  = 'output.mp4';
    mimeType = 'video/mp4';
    args = [
      '-i', 'input.gif',
      '-c:v', 'libx264',
      '-movflags', 'faststart',
      '-pix_fmt', 'yuv420p',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-crf', String(crf),
      outName,
    ];
  } else if (format === 'webm') {
    outName  = 'output.webm';
    mimeType = 'video/webm';
    args = [
      '-i', 'input.gif',
      '-c:v', 'libvpx-vp9',
      '-crf', String(crf),
      '-b:v', '0',
      outName,
    ];
  } else { // mov
    outName  = 'output.mov';
    mimeType = 'video/quicktime';
    args = [
      '-i', 'input.gif',
      '-pix_fmt', 'yuv420p',
      outName,
    ];
  }

  onProgress({ stage: `Converting to ${format.toUpperCase()}…`, ratio: 0.4 });
  await ffmpeg.exec(args);

  onProgress({ stage: 'Reading output…', ratio: 0.95 });
  const data = await ffmpeg.readFile(outName);
  await ffmpeg.deleteFile('input.gif').catch(() => {});
  await ffmpeg.deleteFile(outName).catch(() => {});

  onProgress({ stage: 'Done', ratio: 1 });
  return new Blob([data.buffer], { type: mimeType });
}
