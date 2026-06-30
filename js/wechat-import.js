import { parseWeChatText } from './lease.js';
import { formatPropertyLabel } from './voice.js';

const MSG_SPLIT = /\n(?=\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}[\s日]*\d{1,2}:\d{2})|\n(?=[\u4e00-\u9fa5A-Za-z0-9_]{1,12}[：:])|\n{2,}/;

const PROPERTY_NAME = /([\u4e00-\u9fa5]{2,10}(?:花园|小区|名苑|公寓|大厦|中心|里|城|府|湾|苑|居|庭|轩|阁|豪庭|国际|广场|新村|家园|御|府|层))/g;
const BUILDING = /(\d+[栋座幢]|[A-Za-z][栋座]?|[A-Za-z]座)/;
const UNIT = /(?:^|[\s，,·])(\d{3,4}[室号]?)(?:[\s，,]|$)|([一二三四五六七八九十百]+[室号])/;

export function splitWeChatMessages(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];

  let chunks = trimmed.split(MSG_SPLIT).map((s) => s.trim()).filter(Boolean);

  if (chunks.length <= 1 && trimmed.includes('\n')) {
    chunks = trimmed.split('\n').map((s) => s.trim()).filter((s) => s.length > 4);
  }

  return chunks.filter((c) => c.length >= 4);
}

function extractPropertyHint(text) {
  const names = [...text.matchAll(PROPERTY_NAME)].map((m) => m[1]);
  const buildingMatch = text.match(BUILDING);
  const unitMatch = text.match(/(\d{3,4})[室号]?/) || text.match(/(\d{1,2})\d{2}(?![\d/])/);

  return {
    name: names[0] || '',
    building: buildingMatch ? buildingMatch[1] : '',
    unit: unitMatch ? unitMatch[1] : '',
    allNames: names,
  };
}

function scorePropertyMatch(hint, property) {
  let score = 0;
  const text = `${hint.name}${hint.building}${hint.unit}`.toLowerCase();
  const full = `${property.name}${property.building || ''}${property.unit}`.toLowerCase();

  if (hint.unit && property.unit.includes(hint.unit)) score += 60;
  if (hint.unit && hint.unit === property.unit.replace(/室|号/g, '')) score += 40;
  if (hint.name && (property.name.includes(hint.name) || hint.name.includes(property.name))) score += 50;
  if (hint.building && property.building && property.building.includes(hint.building.replace(/[栋座幢]/, ''))) score += 30;
  if (text && full.includes(text)) score += 80;
  return score;
}

export function matchProperty(hint, properties) {
  let best = null;
  let bestScore = 0;
  for (const p of properties) {
    const score = scorePropertyMatch(hint, p);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return bestScore >= 50 ? { property: best, score: bestScore } : null;
}

function detectIssues(parsed, hint, match) {
  const issues = [];
  if (!parsed?.endDate && !parsed?.startDate) issues.push('缺少日期');
  if (!hint.unit && !match) issues.push('未识别房号');
  if (!hint.name && !match) issues.push('未识别楼盘');
  if (!parsed?.rent) issues.push('缺少月租');
  if (!parsed?.tenant) issues.push('缺少租客');
  if (!match) issues.push('未匹配已有房源');
  return issues;
}

function classifyConfidence(parsed, hint, match, issues) {
  if (!parsed) return 'none';
  const coreFields = [parsed.endDate || parsed.startDate, parsed.rent || parsed.tenant, hint.unit || match];
  const filled = coreFields.filter(Boolean).length;
  if (match && filled >= 2 && issues.length <= 1) return 'high';
  if (filled >= 1) return 'low';
  return 'none';
}

export function parseWeChatMessage(rawText, properties) {
  const parsed = parseWeChatText(rawText);
  const hint = extractPropertyHint(rawText);
  const match = matchProperty(hint, properties);
  const issues = detectIssues(parsed, hint, match);
  const confidence = classifyConfidence(parsed, hint, match, issues);

  return {
    rawText,
    parsed: parsed || { tenant: '', startDate: '', endDate: '', rent: '', deposit: '', note: rawText },
    hint,
    propertyId: match?.property?.id || null,
    propertyLabel: match ? formatPropertyLabel(match.property) : '',
    confidence,
    issues,
    category: guessCategory(rawText, parsed),
  };
}

function guessCategory(text, parsed) {
  if (/到期|续租|退租|招租|空房/.test(text)) return 'lease_end';
  if (/出租|起租|签约|合同|租期/.test(text)) return 'lease_new';
  if (/租金|月租|收款|转账|已收|打款|水电/.test(text)) return 'payment';
  if (/维修|报修|漏水|换锁/.test(text)) return 'maintenance';
  if (parsed?.endDate || parsed?.startDate) return 'lease';
  return 'other';
}

export function applyParsedToProperty(property, parsed) {
  const lease = { ...(property.lease || {}) };
  if (parsed.tenant) lease.tenant = parsed.tenant;
  if (parsed.startDate) lease.startDate = parsed.startDate;
  if (parsed.endDate) lease.endDate = parsed.endDate;
  if (parsed.rent) lease.rent = parsed.rent;
  lease.remind = lease.remind !== false;
  lease.voiceRemind = lease.voiceRemind !== false;
  lease.wechatNote = parsed.note || lease.wechatNote || '';
  lease.lastImportAt = Date.now();
  return { ...property, lease };
}

export function buildImportSummary(results) {
  return {
    total: results.length,
    auto: results.filter((r) => r.action === 'auto').length,
    review: results.filter((r) => r.action === 'review').length,
    failed: results.filter((r) => r.action === 'failed').length,
  };
}

export const CATEGORY_LABELS = {
  lease_end: '到期/续租',
  lease_new: '新出租',
  payment: '收租/费用',
  maintenance: '维修',
  lease: '租期信息',
  other: '其他',
};
