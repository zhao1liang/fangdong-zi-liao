/**
 * 屏幕采集：录制屏幕时只保留画面快照 + OCR 文字，不保存视频文件
 */

let stream = null;
let videoEl = null;
let sessionId = null;
let captureTimer = null;
let lastThumb = null;
let onCapture = null;
let isActive = false;

const CAPTURE_INTERVAL_MS = 2500;
const CHANGE_THRESHOLD = 12;

export function isCapturing() {
  return isActive;
}

export async function startScreenCapture({ onFrame, onStatus, onEnd } = {}) {
  if (isActive) return sessionId;

  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('当前浏览器不支持屏幕共享，请用 Chrome / Edge 桌面版');
  }

  stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 5 },
    audio: false,
  });

  videoEl = document.createElement('video');
  videoEl.srcObject = stream;
  videoEl.muted = true;
  videoEl.playsInline = true;
  await videoEl.play();

  sessionId = crypto.randomUUID();
  onCapture = onFrame;
  isActive = true;
  lastThumb = null;

  stream.getVideoTracks()[0].addEventListener('ended', () => {
    const id = stopScreenCapture();
    onStatus?.('用户停止了屏幕共享');
    onEnd?.(id);
  });

  captureTimer = setInterval(() => {
    tryAutoCapture('auto');
  }, CAPTURE_INTERVAL_MS);

  onStatus?.('采集中… 画面变化会自动保留图片和文字');
  return sessionId;
}

export function stopScreenCapture() {
  if (captureTimer) {
    clearInterval(captureTimer);
    captureTimer = null;
  }
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  if (videoEl) {
    videoEl.srcObject = null;
    videoEl = null;
  }
  isActive = false;
  lastThumb = null;
  const id = sessionId;
  sessionId = null;
  return id;
}

export async function manualCapture(reason = 'manual') {
  if (!isActive || !videoEl) return null;
  return captureFrame(reason);
}

async function tryAutoCapture(reason) {
  if (!videoEl?.videoWidth) return;

  const thumb = grabThumb(videoEl, 64);
  if (lastThumb && !hasVisualChange(lastThumb, thumb, CHANGE_THRESHOLD)) return;

  lastThumb = thumb;
  await captureFrame(reason);
}

async function captureFrame(reason) {
  const blob = await frameToBlob(videoEl);
  if (!blob || blob.size < 8000) return null;

  const item = {
    id: crypto.randomUUID(),
    sessionId,
    blob,
    mimeType: 'image/jpeg',
    reason,
    ocrText: '',
    createdAt: Date.now(),
  };

  onCapture?.({ phase: 'image', item });

  extractText(blob).then((text) => {
    if (text?.trim()) {
      item.ocrText = text.trim();
      onCapture?.({ phase: 'text', item });
    }
  }).catch(() => {});

  return item;
}

function grabThumb(video, size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = Math.round(size * (video.videoHeight / video.videoWidth));
  const ctx = c.getContext('2d');
  ctx.drawImage(video, 0, 0, c.width, c.height);
  return ctx.getImageData(0, 0, c.width, c.height);
}

function hasVisualChange(a, b, threshold) {
  if (a.width !== b.width || a.height !== b.height) return true;
  const d1 = a.data;
  const d2 = b.data;
  let diff = 0;
  const step = 4;
  for (let i = 0; i < d1.length; i += step * 8) {
    diff += Math.abs(d1[i] - d2[i]) + Math.abs(d1[i + 1] - d2[i + 1]) + Math.abs(d1[i + 2] - d2[i + 2]);
  }
  const samples = d1.length / (step * 8);
  return diff / samples > threshold;
}

function frameToBlob(video) {
  return new Promise((resolve) => {
    const c = document.createElement('canvas');
    const maxW = 1280;
    const scale = Math.min(1, maxW / video.videoWidth);
    c.width = Math.round(video.videoWidth * scale);
    c.height = Math.round(video.videoHeight * scale);
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    c.toBlob((b) => resolve(b), 'image/jpeg', 0.82);
  });
}

let tesseractWorker = null;

async function getOcrWorker() {
  if (tesseractWorker) return tesseractWorker;
  const { createWorker } = await import('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js');
  tesseractWorker = await createWorker('chi_sim', 1, {
    logger: () => {},
  });
  return tesseractWorker;
}

async function extractText(blob) {
  try {
    const worker = await getOcrWorker();
    const { data } = await worker.recognize(blob);
    return data.text || '';
  } catch {
    return '';
  }
}

export async function disposeOcr() {
  if (tesseractWorker) {
    await tesseractWorker.terminate();
    tesseractWorker = null;
  }
}
