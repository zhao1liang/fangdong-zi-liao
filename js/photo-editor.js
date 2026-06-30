let editRotation = 0;
let editSource = null;

export function openPhotoEditor(file, onConfirm, onCancel) {
  const dialog = document.getElementById('dialog-photo-edit');
  const img = document.getElementById('edit-preview');
  if (!dialog || !img) {
    onConfirm?.([file]);
    return;
  }

  editRotation = 0;
  editSource = file;
  img.src = URL.createObjectURL(file);
  img.style.transform = 'rotate(0deg)';

  dialog.showModal();

  const confirm = () => {
    renderEditedBlob().then((blob) => {
      const edited = new File([blob], file.name || 'photo.jpg', { type: 'image/jpeg' });
      cleanup(dialog, img);
      onConfirm?.([edited]);
    });
  };

  const cancel = () => {
    cleanup(dialog, img);
    onCancel?.();
  };

  const rotate = () => {
    editRotation = (editRotation + 90) % 360;
    img.style.transform = `rotate(${editRotation}deg)`;
  };

  $('#btn-edit-rotate').onclick = rotate;
  $('#btn-edit-confirm').onclick = confirm;
  $('#btn-edit-cancel').onclick = cancel;
  $('#btn-edit-retake').onclick = cancel;
}

function cleanup(dialog, img) {
  dialog.close();
  if (img.src) URL.revokeObjectURL(img.src);
  editSource = null;
}

async function renderEditedBlob() {
  const img = document.getElementById('edit-preview');
  const bitmap = await createImageBitmap(editSource);
  const rot = editRotation % 360;
  const swap = rot === 90 || rot === 270;
  const w = swap ? bitmap.height : bitmap.width;
  const h = swap ? bitmap.width : bitmap.height;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.translate(w / 2, h / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);

  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9);
  });
}

const $ = (sel) => document.querySelector(sel);
