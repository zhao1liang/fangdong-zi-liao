import { formatPropertyLabel } from './voice.js';

export const REMINDER_DAYS = 30;

export function parseWeChatText(text) {
  if (!text?.trim()) return null;

  const result = { tenant: '', startDate: '', endDate: '', rent: '', deposit: '', note: text.trim() };

  const tenantMatch = text.match(/(?:租客|租户|承租人|姓名)[：:\s]*([^\s，,。\d]{2,8})/);
  if (tenantMatch) result.tenant = tenantMatch[1];

  const rentMatch = text.match(/(?:月租|租金|每月)[：:\s]*(\d+(?:\.\d+)?)\s*元?/);
  if (rentMatch) result.rent = rentMatch[1];

  const depositMatch = text.match(/(?:押金|保证金)[：:\s]*(\d+(?:\.\d+)?)\s*元?/);
  if (depositMatch) result.deposit = depositMatch[1];

  const rangePatterns = [
    /(\d{4})[年\-/.](\d{1,2})[月\-/.](\d{1,2})[日号]?\s*[至到\-~—]\s*(\d{4})[年\-/.](\d{1,2})[月\-/.](\d{1,2})[日号]?/,
    /(\d{4})-(\d{2})-(\d{2})\s*[至到\-~—]\s*(\d{4})-(\d{2})-(\d{2})/,
  ];

  for (const pat of rangePatterns) {
    const m = text.match(pat);
    if (m) {
      result.startDate = toISODate(m[1], m[2], m[3]);
      result.endDate = toISODate(m[4], m[5], m[6]);
      break;
    }
  }

  if (!result.startDate) {
    const startMatch = text.match(/(?:起租|开始|起始)[：:\s]*(\d{4})[年\-/.](\d{1,2})[月\-/.](\d{1,2})/);
    if (startMatch) result.startDate = toISODate(startMatch[1], startMatch[2], startMatch[3]);
  }

  if (!result.endDate) {
    const endMatch = text.match(/(?:到期|截止|结束|租至)[：:\s]*(\d{4})[年\-/.](\d{1,2})[月\-/.](\d{1,2})/);
    if (endMatch) result.endDate = toISODate(endMatch[1], endMatch[2], endMatch[3]);
  }

  if (!result.endDate && result.startDate) {
    const yearMatch = text.match(/租期\s*(\d+)\s*年/);
    const monthMatch = text.match(/租期\s*(\d+)\s*个?月/);
    if (yearMatch || monthMatch) {
      const start = new Date(result.startDate);
      if (yearMatch) start.setFullYear(start.getFullYear() + parseInt(yearMatch[1], 10));
      if (monthMatch) start.setMonth(start.getMonth() + parseInt(monthMatch[1], 10));
      start.setDate(start.getDate() - 1);
      result.endDate = formatISO(start);
    }
  }

  const hasData = result.startDate || result.endDate || result.rent || result.tenant;
  return hasData ? result : null;
}

function toISODate(y, m, d) {
  const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
  if (Number.isNaN(date.getTime())) return '';
  return formatISO(date);
}

function formatISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  d.setHours(0, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function daysUntil(dateStr) {
  const target = parseDate(dateStr);
  if (!target) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((target - today) / 86400000);
}

export function getLeaseStatus(p, reminderDays = REMINDER_DAYS) {
  const end = p.lease?.endDate;
  if (!end) return null;
  const diffDays = daysUntil(end);
  if (diffDays === null) return null;

  if (diffDays < 0) return { type: 'expired', diffDays, label: '已到期', endDate: end };
  if (diffDays <= reminderDays) return { type: 'expiring', diffDays, label: `${diffDays}天后到期`, endDate: end };
  return { type: 'ok', diffDays, label: `${diffDays}天后到期`, endDate: end };
}

export function getReminderDate(endDateStr, daysBefore = REMINDER_DAYS) {
  const end = parseDate(endDateStr);
  if (!end) return null;
  const reminder = new Date(end);
  reminder.setDate(reminder.getDate() - daysBefore);
  return formatISO(reminder);
}

export function getUpcomingReminders(properties, daysBefore = REMINDER_DAYS) {
  return properties
    .filter((p) => p.lease?.endDate && p.lease?.remind !== false)
    .map((p) => {
      const status = getLeaseStatus(p, daysBefore);
      if (!status || status.type === 'ok') return null;
      return { property: p, status, reminderDate: getReminderDate(p.lease.endDate, daysBefore) };
    })
    .filter(Boolean)
    .sort((a, b) => a.status.diffDays - b.status.diffDays);
}

export function getCalendarEvents(properties) {
  const events = [];

  for (const p of properties) {
    const lease = p.lease || {};
    const label = formatPropertyLabel(p);
    const id = p.id;

    if (lease.startDate) {
      events.push({
        id: `${id}-start`,
        propertyId: id,
        date: lease.startDate,
        type: 'start',
        title: `起租 · ${label}`,
        detail: lease.tenant ? `租客 ${lease.tenant}` : '',
      });
    }

    if (lease.endDate) {
      events.push({
        id: `${id}-end`,
        propertyId: id,
        date: lease.endDate,
        type: 'end',
        title: `到期 · ${label}`,
        detail: lease.rent ? `月租 ¥${lease.rent}` : '',
      });

      const reminderDate = getReminderDate(lease.endDate, REMINDER_DAYS);
      if (reminderDate) {
        events.push({
          id: `${id}-remind`,
          propertyId: id,
          date: reminderDate,
          type: 'remind',
          title: `提前提醒 · ${label}`,
          detail: `距到期还有 ${REMINDER_DAYS} 天`,
        });
      }
    }

    if (lease.rent && lease.startDate) {
      addRentEvents(events, p, label, id, lease);
    }
  }

  return events.sort((a, b) => a.date.localeCompare(b.date));
}

function addRentEvents(events, p, label, id, lease) {
  const start = parseDate(lease.startDate);
  const end = parseDate(lease.endDate) || new Date(start.getFullYear() + 1, start.getMonth(), start.getDate());
  if (!start) return;

  let cursor = new Date(start.getFullYear(), start.getMonth() + 1, start.getDate());
  let i = 0;
  while (cursor <= end && i < 24) {
    events.push({
      id: `${id}-rent-${i}`,
      propertyId: id,
      date: formatISO(cursor),
      type: 'rent',
      title: `收租 · ${label}`,
      detail: `¥${lease.rent}`,
    });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate());
    i++;
  }
}

function icsEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function toICSDate(dateStr) {
  return dateStr.replace(/-/g, '');
}

export function generateICS(properties, singleId = null) {
  const list = singleId ? properties.filter((p) => p.id === singleId) : properties;
  const events = getCalendarEvents(list);
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//租房相册//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:租房租期提醒',
  ];

  for (const ev of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.id}@rental-album`);
    lines.push(`DTSTAMP:${now}`);
    lines.push(`DTSTART;VALUE=DATE:${toICSDate(ev.date)}`);
    lines.push(`SUMMARY:${icsEscape(ev.title)}`);
    if (ev.detail) lines.push(`DESCRIPTION:${icsEscape(ev.detail)}`);
    if (ev.type === 'remind' || ev.type === 'end') {
      lines.push('BEGIN:VALARM');
      lines.push('TRIGGER:-P1D');
      lines.push('ACTION:DISPLAY');
      lines.push(`DESCRIPTION:${icsEscape(ev.title)}`);
      lines.push('END:VALARM');
    }
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function downloadICS(properties, filename = '租房租期日历.ics', singleId = null) {
  const content = generateICS(properties, singleId);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function getDismissKey(propertyId, endDate, daysBefore = REMINDER_DAYS) {
  return `remind-${propertyId}-${endDate}-${daysBefore}`;
}

export function loadDismissed() {
  try {
    return JSON.parse(localStorage.getItem('dismissedReminders') || '{}');
  } catch {
    return {};
  }
}

export function saveDismissed(map) {
  localStorage.setItem('dismissedReminders', JSON.stringify(map));
}

export function getUndismissedReminders(properties, daysBefore = REMINDER_DAYS) {
  const dismissed = loadDismissed();
  const today = formatISO(new Date());

  return getUpcomingReminders(properties, daysBefore).filter(({ property, status }) => {
    const key = getDismissKey(property.id, property.lease.endDate, daysBefore);
    const record = dismissed[key];
    if (!record) return true;
    return record.date !== today;
  });
}

export function dismissReminder(propertyId, endDate, daysBefore = REMINDER_DAYS) {
  const dismissed = loadDismissed();
  const key = getDismissKey(propertyId, endDate, daysBefore);
  dismissed[key] = { date: formatISO(new Date()) };
  saveDismissed(dismissed);
}

export function dismissAllReminders(reminders, daysBefore = REMINDER_DAYS) {
  const dismissed = loadDismissed();
  const today = formatISO(new Date());
  for (const { property } of reminders) {
    const key = getDismissKey(property.id, property.lease.endDate, daysBefore);
    dismissed[key] = { date: today };
  }
  saveDismissed(dismissed);
}
