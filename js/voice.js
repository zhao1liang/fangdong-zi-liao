const ROOM_TAGS = ['客厅', '卧室', '主卧', '次卧', '厨房', '卫生间', '阳台', '外景', '其他'];

const ACTION_WORDS = ['放入', '放进', '放到', '存到', '保存到', '加到', '添加到', '归档到', '归入'];

export function parseVoiceCommand(text, properties) {
  if (!text || !properties.length) return null;

  let cleaned = text
    .replace(/[，。！？、；：""''\s]+/g, '')
    .trim();

  for (const word of ACTION_WORDS) {
    const idx = cleaned.indexOf(word);
    if (idx !== -1) {
      cleaned = cleaned.slice(idx + word.length);
      break;
    }
  }

  let tag = '';
  for (const t of ROOM_TAGS) {
    if (cleaned.includes(t)) {
      tag = t;
      cleaned = cleaned.replace(t, '');
      break;
    }
  }

  cleaned = cleaned.replace(/相册|里面|里去?|照片?|图片?/g, '').trim();

  const match = findBestProperty(cleaned, properties);
  if (!match) return null;

  return { property: match, tag };
}

function findBestProperty(query, properties) {
  if (!query) return null;

  const q = normalize(query);
  const qDigits = q.replace(/\D/g, '');

  let best = null;
  let bestScore = 0;

  for (const p of properties) {
    const score = scoreProperty(q, qDigits, p);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  return bestScore >= 30 ? best : null;
}

function scoreProperty(q, qDigits, p) {
  const name = normalize(p.name);
  const building = normalize(p.building || '');
  const unit = normalize(p.unit);
  const full = `${name}${building}${unit}`;
  let score = 0;

  if (q.includes(unit) || unit.includes(q)) score += 80;
  if (qDigits && (unit.includes(qDigits) || q.includes(qDigits))) score += 60;

  if (building && (q.includes(building) || building.includes(q))) score += 40;
  if (q.includes(name) || name.includes(q)) score += 50;

  if (q.includes(full) || full.includes(q)) score += 100;

  const qChars = [...q];
  let matched = 0;
  for (const ch of qChars) {
    if (full.includes(ch)) matched++;
  }
  score += (matched / Math.max(qChars.length, 1)) * 20;

  return score;
}

function normalize(s) {
  return String(s)
    .toLowerCase()
    .replace(/[栋座幢单元层号室]/g, '')
    .replace(/\s+/g, '');
}

export function formatPropertyLabel(p) {
  const parts = [p.name];
  if (p.building) parts.push(p.building);
  parts.push(p.unit);
  return parts.join(' · ');
}

export { ROOM_TAGS };
