/** 图片处理：兼容手机 HEIC / 无类型 / 破损预览 */

export async function normalizeToJpeg(file) {
  if (!file || !file.size) return null;

  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file);
      const blob = await bitmapToJpeg(bitmap);
      bitmap.close?.();
      if (blob?.size) return blob;
    }
  } catch {
    /* fallback below */
  }

  return canvasFromFile(file);
}

async function canvasFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const blob = drawToJpeg(img);
      blob ? resolve(blob) : reject(new Error('canvas failed'));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('img load failed'));
    };
    img.src = url;
  });
}

function drawToJpeg(img) {
  const max = 1920;
  let w = img.width;
  let h = img.height;
  if (!w || !h) return null;
  if (w > max || h > max) {
    const s = max / Math.max(w, h);
    w = Math.round(w * s);
    h = Math.round(h * s);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  return dataUrlToBlob(canvas.toDataURL('image/jpeg', 0.88));
}

async function bitmapToJpeg(bitmap) {
  const canvas = document.createElement('canvas');
  const max = 1920;
  let w = bitmap.width;
  let h = bitmap.height;
  if (w > max || h > max) {
    const s = max / Math.max(w, h);
    w = Math.round(w * s);
    h = Math.round(h * s);
  }
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  return dataUrlToBlob(canvas.toDataURL('image/jpeg', 0.88));
}

function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const mime = head.match(/:(.*?);/)[1];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export async function normalizeFiles(files) {
  const out = [];
  for (const f of files) {
    try {
      const b = await normalizeToJpeg(f);
      if (b?.size > 100) out.push(b);
    } catch {
      /* skip */
    }
  }
  return out;
}

/** 预览用 dataURL，比 blob URL 在手机更稳定 */
export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    if (!blob || blob.size === 0) {
      reject(new Error('empty'));
      return;
    }
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(blob);
  });
}

export function ensurePhotoBlob(photo) {
  if (photo.blob instanceof Blob && photo.blob.size > 0) return photo.blob;
  if (photo.data) {
    const buf = photo.data instanceof ArrayBuffer ? photo.data : photo.data.buffer;
    photo.blob = new Blob([buf], { type: photo.mimeType || 'image/jpeg' });
  }
  return photo.blob;
}

export async function photoToDataUrl(photo) {
  const blob = ensurePhotoBlob(photo);
  if (!blob?.size) return '';
  return blobToDataUrl(blob);
}
