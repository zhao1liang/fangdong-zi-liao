import { formatPropertyLabel } from './voice.js';
import { getLeaseStatus } from './lease.js';

const W = 750;
const H = 1100;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function formatCNDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${y}年${parseInt(m, 10)}月${parseInt(d, 10)}日`;
}

function getCardMeta(property) {
  const lease = property.lease || {};
  const status = getLeaseStatus(property);
  const label = formatPropertyLabel(property);

  let statusText = '租期正常';
  let statusColor = '#3dd68c';
  let headerTitle = '房源租期信息';

  if (status?.type === 'expiring') {
    statusText = `还有 ${status.diffDays} 天到期`;
    statusColor = '#f5a623';
    headerTitle = '租期到期提醒';
  } else if (status?.type === 'expired') {
    statusText = '租期已过期';
    statusColor = '#ff5c5c';
    headerTitle = '租期到期提醒';
  } else if (lease.endDate) {
    statusText = `距到期 ${status?.diffDays ?? '—'} 天`;
  }

  return { lease, status, label, statusText, statusColor, headerTitle };
}

export function renderShareCard(property) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const meta = getCardMeta(property);
  const { lease, label, statusText, statusColor, headerTitle } = meta;

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#1a1040');
  bg.addColorStop(0.5, '#0f2847');
  bg.addColorStop(1, '#0a1628');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  roundRect(ctx, 40, 40, W - 80, H - 80, 28);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('🏠 租房相册', 72, 110);

  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '28px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(headerTitle, 72, 155);

  ctx.fillStyle = '#ffffff';
  roundRect(ctx, 56, 190, W - 112, 720, 24);
  ctx.fill();

  const unitLine = property.unit || '—';
  ctx.fillStyle = '#1a1d27';
  ctx.font = 'bold 88px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(unitLine, 88, 310);

  ctx.fillStyle = '#4f5568';
  ctx.font = '32px "PingFang SC", "Microsoft YaHei", sans-serif';
  const subLine = [property.name, property.building].filter(Boolean).join(' · ') || label;
  ctx.fillText(subLine, 88, 365);

  ctx.strokeStyle = '#e8eaef';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(88, 400);
  ctx.lineTo(W - 88, 400);
  ctx.stroke();

  ctx.fillStyle = statusColor;
  ctx.font = 'bold 28px "PingFang SC", "Microsoft YaHei", sans-serif';
  const badgeW = Math.min(ctx.measureText(statusText).width + 48, W - 176);
  roundRect(ctx, 88, 430, badgeW, 52, 26);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(statusText, 112, 465);

  const rows = [
    ['到期日', formatCNDate(lease.endDate)],
    ['起租日', formatCNDate(lease.startDate)],
    ['租客', lease.tenant || '—'],
    ['月租', lease.rent ? `¥ ${lease.rent} / 月` : '—'],
  ];

  let y = 540;
  for (const [k, v] of rows) {
    ctx.fillStyle = '#8b92a8';
    ctx.font = '28px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(k, 88, y);

    ctx.fillStyle = k === '到期日' ? '#1a1d27' : '#3a4050';
    ctx.font = k === '到期日'
      ? 'bold 40px "PingFang SC", "Microsoft YaHei", sans-serif'
      : '32px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(v, 88, y + (k === '到期日' ? 52 : 44));
    y += k === '到期日' ? 110 : 88;
  }

  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '24px "PingFang SC", "Microsoft YaHei", sans-serif';
  const today = new Date();
  const footer = `生成于 ${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')} · 长按保存发微信`;
  ctx.fillText(footer, 72, H - 72);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve({ blob, dataUrl: canvas.toDataURL('image/png'), filename: buildFilename(property) }), 'image/png');
  });
}

function buildFilename(property) {
  const name = `${property.name}_${property.building || ''}_${property.unit}`.replace(/\s+/g, '');
  return `${name}_租期卡片.png`;
}

export function downloadShareCard(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function nativeShareCard(blob, filename, title) {
  if (!navigator.share) return false;

  const file = new File([blob], filename, { type: 'image/png' });
  const payload = { title: title || '房源租期', text: title || '房源租期信息' };

  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ ...payload, files: [file] });
    return true;
  }

  try {
    await navigator.share(payload);
    return true;
  } catch (e) {
    if (e.name === 'AbortError') return true;
    return false;
  }
}

export async function openShareCardDialog(property, dialogEl) {
  const preview = dialogEl.querySelector('#share-card-preview');
  const hint = dialogEl.querySelector('#share-card-hint');
  const { blob, dataUrl, filename } = await renderShareCard(property);

  preview.src = dataUrl;
  dialogEl.dataset.filename = filename;
  dialogEl._shareBlob = blob;

  const canShare = !!(navigator.share && navigator.canShare?.({ files: [new File([blob], filename, { type: 'image/png' })] }));
  hint.textContent = canShare
    ? '点「发送微信」在分享菜单选微信；或保存图片后发送'
    : '保存图片后，打开微信 → 发给朋友 → 从相册选图';

  dialogEl.showModal();
  return { blob, filename, dataUrl };
}
