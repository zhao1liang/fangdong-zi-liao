import { formatPropertyLabel } from './voice.js';
import { getLeaseStatus, parseDate, REMINDER_DAYS } from './lease.js';
import { CATEGORY_LABELS } from './wechat-import.js';
import { uid, deleteTasksBySource, saveTask } from './db.js';

function formatISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function isRentDueOn(property, dateStr) {
  const start = property.lease?.startDate;
  const rent = property.lease?.rent;
  if (!start || !rent) return false;
  const startDate = parseDate(start);
  const target = parseDate(dateStr);
  if (!startDate || !target) return false;
  return target.getDate() === startDate.getDate() && target >= startDate;
}

export async function regenerateTomorrowTasks(properties, inboxItems) {
  const tomorrow = formatISO(addDays(new Date(), 1));
  await deleteTasksBySource('auto');

  const tasks = [];

  const pendingInbox = inboxItems.filter((x) => x.status === 'pending');
  for (const item of pendingInbox.slice(0, 10)) {
    tasks.push(makeTask({
      title: `处理未识别微信消息`,
      detail: item.rawText.slice(0, 80) + (item.rawText.length > 80 ? '…' : ''),
      dueDate: tomorrow,
      type: 'inbox',
      priority: 1,
      inboxId: item.id,
      issues: item.issues,
    }));
  }

  for (const p of properties) {
    const lease = p.lease || {};
    const label = formatPropertyLabel(p);
    const status = getLeaseStatus(p);

    if (lease.endDate) {
      const end = parseDate(lease.endDate);
      const tmr = parseDate(tomorrow);
      const diff = Math.ceil((end - tmr) / 86400000);

      if (diff === 0) {
        tasks.push(makeTask({
          title: `租期今天到期 · ${label}`,
          detail: `租客 ${lease.tenant || '—'}，月租 ¥${lease.rent || '—'}，请联系续租或招租`,
          dueDate: tomorrow,
          type: 'expire',
          priority: 0,
          propertyId: p.id,
        }));
      } else if (diff > 0 && diff <= 7) {
        tasks.push(makeTask({
          title: `跟进续租 · ${label}`,
          detail: `还有 ${diff + 1} 天到期（${lease.endDate}），提前联系租客`,
          dueDate: tomorrow,
          type: 'renew',
          priority: 1,
          propertyId: p.id,
        }));
      } else if (diff === REMINDER_DAYS - 1) {
        tasks.push(makeTask({
          title: `到期预警 · ${label}`,
          detail: `距到期约 ${REMINDER_DAYS} 天，安排看房或续租`,
          dueDate: tomorrow,
          type: 'renew',
          priority: 1,
          propertyId: p.id,
        }));
      }
    }

    if (isRentDueOn(p, tomorrow)) {
      tasks.push(makeTask({
        title: `收租 · ${label}`,
        detail: `向 ${lease.tenant || '租客'} 收取月租 ¥${lease.rent}`,
        dueDate: tomorrow,
        type: 'rent',
        priority: 1,
        propertyId: p.id,
      }));
    }

    if (!lease.endDate || !lease.tenant) {
      tasks.push(makeTask({
        title: `补全房源资料 · ${label}`,
        detail: [!lease.endDate && '缺到期日', !lease.tenant && '缺租客'].filter(Boolean).join('、'),
        dueDate: tomorrow,
        type: 'data',
        priority: 2,
        propertyId: p.id,
      }));
    }
  }

  tasks.sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title, 'zh-CN'));

  for (const t of tasks) {
    await saveTask(t);
  }

  return tasks;
}

function makeTask({ title, detail, dueDate, type, priority, propertyId, inboxId, issues }) {
  return {
    id: uid(),
    title,
    detail,
    dueDate,
    type,
    priority: priority ?? 2,
    propertyId: propertyId || null,
    inboxId: inboxId || null,
    issues: issues || [],
    done: false,
    source: 'auto',
    createdAt: Date.now(),
  };
}

export function formatTomorrowLabel() {
  const d = addDays(new Date(), 1);
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  return `${d.getMonth() + 1}月${d.getDate()}日 周${weekdays[d.getDay()]}`;
}

export const TASK_TYPE_ICONS = {
  inbox: '📩',
  expire: '🔴',
  renew: '⏰',
  rent: '💰',
  data: '📝',
};

export function inboxIssueLabel(issues) {
  return (issues || []).join(' · ') || '无法自动识别';
}

export { CATEGORY_LABELS };
