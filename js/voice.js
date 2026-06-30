const ROOM_TAGS = ['客厅', '卧室', '主卧', '次卧', '厨房', '卫生间', '阳台', '外景', '其他'];

const ACTION_WORDS = ['放入', '放进', '放到', '存到', '保存到', '加到', '添加到', '归档到', '归入', '把图片', '把照片', '把相片'];

const CREATE_WORDS = ['新建', '创建', '新增', '添加房源', '建立一个', '建一个'];

export function cleanSpeechText(text) {
  if (!text) return '';

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

  for (const word of CREATE_WORDS) {
    const idx = cleaned.indexOf(word);
    if (idx !== -1) {
      cleaned = cleaned.slice(idx + word.length);
      break;
    }
  }

  return cleaned.replace(/里面|里去?|的$|房源$/g, '').trim();
}

export function isCreateCommand(text) {
  if (!text) return false;
  return CREATE_WORDS.some((w) => text.includes(w));
}

export function extractPropertyFields(text) {
  const raw = cleanSpeechText(text);
  if (!raw) return null;

  let tag = '';
  let cleaned = raw;
  for (const t of ROOM_TAGS) {
    if (cleaned.includes(t)) {
      tag = t;
      cleaned = cleaned.replace(t, '');
      break;
    }
  }
  cleaned = cleaned.replace(/照片?|图片?|相片?/g, '').trim();

  let building = '';
  const bMatch = cleaned.match(/([0-9一二三四五六七八九十]+[栋座幢])|([A-Za-z][栋座])|([A-Za-z]座)/);
  if (bMatch) {
    building = bMatch[0];
    cleaned = cleaned.replace(building, '');
  }

  let unit = '';
  const uMatch = cleaned.match(/(\d{2,4})[室号]?/);
  if (uMatch) {
    unit = uMatch[1];
    cleaned = cleaned.replace(uMatch[0], '');
  }

  const name = cleaned.replace(/^[的到进]+/, '').trim();
  if (!name) return null;

  return { name, building, unit, tag };
}

export function parseVoiceCommand(text, properties) {
  if (!text || !properties.length) return null;

  let cleaned = cleanSpeechText(text);

  let tag = '';
  for (const t of ROOM_TAGS) {
    if (cleaned.includes(t)) {
      tag = t;
      cleaned = cleaned.replace(t, '');
      break;
    }
  }
  cleaned = cleaned.replace(/照片?|图片?|相片?/g, '').trim();

  const nameMatches = properties.filter((p) => nameSimilar(cleaned, p.name));
  if (nameMatches.length === 1) return { property: nameMatches[0], tag };

  const unitOnly = cleaned.match(/(\d{3,4})/);
  if (unitOnly) {
    const digit = unitOnly[1];
    let byUnit = properties.filter(
      (p) => p.unit.replace(/\D/g, '').includes(digit) || digit === p.unit.replace(/室|号/g, '')
    );
    if (nameMatches.length > 1) {
      byUnit = byUnit.filter((p) => nameMatches.some((m) => m.id === p.id));
    }
    if (byUnit.length === 1) return { property: byUnit[0], tag };
    if (byUnit.length > 1) {
      const match = findBestProperty(cleaned, byUnit);
      if (match) return { property: match, tag };
    }
  }

  if (nameMatches.length > 1) {
    const match = findBestProperty(cleaned, nameMatches);
    if (match) return { property: match, tag };
    return { needPick: true, candidates: nameMatches, tag };
  }

  const match = findBestProperty(cleaned, properties);
  if (!match) return null;

  return { property: match, tag };
}

/** 匹配已有房源；匹配不到则返回待新建信息 */
export function resolveVoiceTarget(text, properties) {
  const list = properties || [];

  if (list.length) {
    const matched = parseVoiceCommand(text, list);
    if (matched?.property) {
      return { property: matched.property, tag: matched.tag || '', created: false };
    }
    if (matched?.needPick) {
      return {
        needPick: true,
        candidates: matched.candidates,
        tag: matched.tag || '',
        created: false,
      };
    }
  }

  const fields = extractPropertyFields(text);
  if (!fields?.name) return null;

  if (list.length) {
    const query = `${fields.name}${fields.building || ''}${fields.unit || ''}`;
    const best = findBestProperty(query, list);
    if (best) {
      const score = scoreProperty(
        normalize(query),
        (fields.unit || '').replace(/\D/g, ''),
        best
      );
      if (score >= 12) {
        return { property: best, tag: fields.tag, created: false };
      }
    }

    const byName = list.filter((p) => nameSimilar(fields.name, p.name));
    if (byName.length === 1) {
      return { property: byName[0], tag: fields.tag, created: false };
    }
    if (byName.length > 1) {
      if (fields.unit) {
        const withUnit = byName.filter(
          (p) => p.unit.includes(fields.unit) || fields.unit === p.unit.replace(/\D/g, '')
        );
        if (withUnit.length === 1) {
          return { property: withUnit[0], tag: fields.tag, created: false };
        }
      }
      return { needPick: true, candidates: byName, tag: fields.tag, created: false };
    }
  }

  return {
    property: {
      name: fields.name,
      building: fields.building || '',
      unit: fields.unit || '待归档',
    },
    tag: fields.tag,
    created: true,
  };
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

  return bestScore >= 12 ? best : null;
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

  const qName = normalizeName(q);
  const pName = normalizeName(name);
  if (qName && pName && (qName.includes(pName) || pName.includes(qName))) score += 55;

  if (q.includes(full) || full.includes(q)) score += 100;

  const qChars = [...q];
  let matched = 0;
  for (const ch of qChars) {
    if (full.includes(ch)) matched++;
  }
  score += (matched / Math.max(qChars.length, 1)) * 20;

  return score;
}

function nameSimilar(query, propertyName) {
  const q = normalizeName(normalize(query));
  const n = normalizeName(normalize(propertyName));
  if (!q || !n) return false;
  return q.includes(n) || n.includes(q);
}

function normalizeName(s) {
  return String(s).replace(/(小区|花园|名苑|公寓|家园|里|城|府|湾|苑|园|国际|中心)$/g, '');
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
