const ROOM_TAGS = ['客厅', '卧室', '主卧', '次卧', '厨房', '卫生间', '阳台', '外景', '其他'];

const ACTION_WORDS = ['放入', '放进', '放到', '存到', '保存到', '加到', '添加到', '归档到', '归入', '把图片', '把照片'];

export function parseVoiceCommand(text, properties) {
  if (!text || !properties.length) return null;

  let cleaned = text
    .replace(/[，。！？、；：""''\s]+/g, '')
    .trim();

  cleaned = cleaned
    .replace(/把?(?:图片|照片|相片)/g, '')
    .replace(/文件夹/g, '')
    .replace(/相册/g, '');

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

  cleaned = cleaned.replace(/里面|里去?|照片?|图片?/g, '').trim();

  // 纯房号：「1201」「502」
  const unitOnly = cleaned.match(/(\d{3,4})/);
  if (unitOnly) {
    const byUnit = properties.filter((p) => p.unit.replace(/\D/g, '').includes(unitOnly[1]) || unitOnly[1] === p.unit.replace(/室|号/g, ''));
    if (byUnit.length === 1) return { property: byUnit[0], tag };
    if (byUnit.length > 1) {
      const match = findBestProperty(unitOnly[1], byUnit);
      if (match) return { property: match, tag };
    }
  }

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

  return bestScore >= 20 ? best : null;
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
