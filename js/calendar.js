import { getCalendarEvents } from './lease.js';
import { formatPropertyLabel } from './voice.js';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

const TYPE_COLORS = {
  start: 'var(--success)',
  end: 'var(--danger)',
  remind: 'var(--warning)',
  rent: 'var(--accent)',
};

export function createCalendarController(container, onPropertySelect) {
  let viewYear = new Date().getFullYear();
  let viewMonth = new Date().getMonth();
  let properties = [];
  let selectedDate = null;

  function render(props) {
    properties = props;
    draw();
  }

  function draw() {
    const events = getCalendarEvents(properties);
    const eventsByDate = groupByDate(events);

    container.innerHTML = `
      <div class="calendar-panel">
        <div class="calendar-nav">
          <button type="button" class="btn-icon cal-nav-btn" data-nav="-1">‹</button>
          <span class="calendar-title">${viewYear}年${viewMonth + 1}月</span>
          <button type="button" class="btn-icon cal-nav-btn" data-nav="1">›</button>
          <button type="button" class="btn secondary cal-today-btn">今天</button>
        </div>
        <div class="calendar-weekdays">${WEEKDAYS.map((d) => `<span>${d}</span>`).join('')}</div>
        <div class="calendar-grid">${buildDays(viewYear, viewMonth, eventsByDate)}</div>
        <div class="calendar-legend">
          <span><i style="background:var(--warning)"></i>提前30天提醒</span>
          <span><i style="background:var(--danger)"></i>到期日</span>
          <span><i style="background:var(--accent)"></i>收租日</span>
        </div>
        <div class="calendar-day-detail" id="cal-day-detail"></div>
      </div>`;

    container.querySelector('[data-nav="-1"]').addEventListener('click', () => shiftMonth(-1));
    container.querySelector('[data-nav="1"]').addEventListener('click', () => shiftMonth(1));
    container.querySelector('.cal-today-btn').addEventListener('click', goToday);

    container.querySelectorAll('.cal-day').forEach((cell) => {
      cell.addEventListener('click', () => {
        selectedDate = cell.dataset.date;
        container.querySelectorAll('.cal-day').forEach((c) => c.classList.remove('selected'));
        cell.classList.add('selected');
        showDayDetail(cell.dataset.date, eventsByDate[cell.dataset.date] || []);
      });
    });

    const todayStr = formatDateKey(new Date());
    if (eventsByDate[todayStr]?.length) {
      selectedDate = todayStr;
      const todayCell = container.querySelector(`.cal-day[data-date="${todayStr}"]`);
      todayCell?.classList.add('selected');
      showDayDetail(todayStr, eventsByDate[todayStr]);
    }
  }

  function showDayDetail(date, events) {
    const detail = container.querySelector('#cal-day-detail');
    if (!events.length) {
      detail.innerHTML = `<p class="cal-empty">${date} 无租期事件</p>`;
      return;
    }

    detail.innerHTML = `
      <h4>${date}</h4>
      <ul class="cal-event-list">
        ${events.map((ev) => `
          <li class="cal-event cal-event-${ev.type}" data-pid="${ev.propertyId}">
            <span class="cal-dot" style="background:${TYPE_COLORS[ev.type]}"></span>
            <div>
              <strong>${escapeHtml(ev.title)}</strong>
              ${ev.detail ? `<span>${escapeHtml(ev.detail)}</span>` : ''}
            </div>
          </li>`).join('')}
      </ul>`;

    detail.querySelectorAll('.cal-event').forEach((el) => {
      el.addEventListener('click', () => onPropertySelect?.(el.dataset.pid));
    });
  }

  function shiftMonth(delta) {
    viewMonth += delta;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    draw();
  }

  function goToday() {
    const now = new Date();
    viewYear = now.getFullYear();
    viewMonth = now.getMonth();
    draw();
  }

  return { render, goToday };
}

function buildDays(year, month, eventsByDate) {
  const first = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0).getDate();
  const startPad = first.getDay();
  const todayKey = formatDateKey(new Date());
  let html = '';

  for (let i = 0; i < startPad; i++) {
    html += '<div class="cal-day empty"></div>';
  }

  for (let d = 1; d <= lastDay; d++) {
    const date = new Date(year, month, d);
    const key = formatDateKey(date);
    const events = eventsByDate[key] || [];
    const isToday = key === todayKey;
    const dots = events.slice(0, 3).map((ev) =>
      `<i class="cal-dot-mini" style="background:${TYPE_COLORS[ev.type]}"></i>`
    ).join('');

    html += `
      <div class="cal-day${isToday ? ' today' : ''}${events.length ? ' has-event' : ''}" data-date="${key}">
        <span class="cal-num">${d}</span>
        <span class="cal-dots">${dots}</span>
      </div>`;
  }

  return html;
}

function groupByDate(events) {
  const map = {};
  for (const ev of events) {
    if (!map[ev.date]) map[ev.date] = [];
    map[ev.date].push(ev);
  }
  return map;
}

function formatDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function escapeHtml(s) {
  const el = document.createElement('div');
  el.textContent = s;
  return el.innerHTML;
}

export { formatPropertyLabel };
