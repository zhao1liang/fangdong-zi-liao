/** 把手机照片统一转成 JPEG，避免 HEIC 等格式显示黑屏 */
export async function normalizeToJpeg(file) {
  if (!file) return null;

  if (file.type === 'image/jpeg' && file.size > 0) {
    return file instanceof Blob ? file : new Blob([file], { type: 'image/jpeg' });
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const max = 1920;
      let w = img.width;
      let h = img.height;
      if (w > max || h > max) {
        const scale = max / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('convert failed'))),
        'image/jpeg',
        0.88
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('load failed'));
    };

    img.src = url;
  });
}

export async function normalizeFiles(files) {
  const out = [];
  for (const f of files) {
    try {
      out.push(await normalizeToJpeg(f));
    } catch {
      /* skip broken file */
    }
  }
  return out;
}

export function blobToImageUrl(blob) {
  if (!blob || !(blob instanceof Blob) || blob.size === 0) return '';
  return URL.createObjectURL(blob);
}
