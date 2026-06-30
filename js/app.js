import {
  openDB, uid, getAllProperties, saveProperty, savePhoto,
  getPhotosByProperty, deletePhoto, countPhotosByProperty, seedDemoData,
  getAllInbox, saveInboxItem, deleteInboxItem, getAllTasks, saveTask,
  saveCaptureSession, getAllCaptureSessions, saveCapture, getCapturesBySession,
  deleteCapture, deleteCaptureSession
} from './db.js';
import { parseVoiceCommand, formatPropertyLabel } from './voice.js';
import {
  getLeaseStatus, parseWeChatText, getUndismissedReminders,
  dismissAllReminders, downloadICS, REMINDER_DAYS
} from './lease.js';
import { createCalendarController } from './calendar.js';
import {
  isVoiceReminderEnabled, setVoiceReminderEnabled,
  speakReminders, speak, stopSpeaking
} from './speech-out.js';
import {
  openShareCardDialog, downloadShareCard, nativeShareCard, renderShareCard
} from './share-card.js';
import {
  splitWeChatMessages, parseWeChatMessage, applyParsedToProperty,
  buildImportSummary, CATEGORY_LABELS
} from './wechat-import.js';
import {
  regenerateTomorrowTasks, formatTomorrowLabel, TASK_TYPE_ICONS, inboxIssueLabel
} from './tasks.js';
import {
  startScreenCapture, stopScreenCapture, manualCapture, isCapturing
} from './screen-capture.js';
import {
  isMobile, isStandalone, setupInstallPrompt, promptInstall,
  showIOSInstallHint, setupMobileUI, closePropertyDrawer, isWeChat, isAndroid
} from './mobile.js';

const $ = (sel) => document.querySelector(sel);

let properties = [];
let selectedId = null;
let pendingFiles = [];
let recognition = null;
let isListening = false;
let currentView = 'album';
let pendingReminders = [];
let calendarCtrl = null;
let inboxItems = [];
let tomorrowTasks = [];
let activeInboxId = null;
let captureSessions = [];
let currentCaptureSessionId = null;
let liveCaptureCount = 0;
let endingCapture = false;

const els = {
  main: $('.main'),
  propertyList: $('#property-list'),
  emptyState: $('#empty-state'),
  albumView: $('#album-view'),
  calendarView: $('#calendar-view'),
  importView: $('#import-view'),
  inboxView: $('#inbox-view'),
  tasksView: $('#tasks-view'),
  captureView: $('#capture-view'),
  voiceDock: $('#voice-dock'),
  albumTitle: $('#album-title'),
  leaseInfo: $('#lease-info'),
  photoGrid: $('#photo-grid'),
  searchInput: $('#search-input'),
  leaseAlerts: $('#lease-alerts'),
  voicePreview: $('#voice-preview'),
  previewImg: $('#preview-img'),
  voiceStatus: $('#voice-status'),
  voiceHint: $('#voice-hint'),
  btnVoice: $('#btn-voice'),
  photoInput: $('#photo-input'),
  toast: $('#toast'),
  dialogProperty: $('#dialog-property'),
  dialogLease: $('#dialog-lease'),
  dialogReminder: $('#dialog-reminder'),
  formProperty: $('#form-property'),
  formLease: $('#form-lease'),
  reminderList: $('#reminder-list'),
  wechatPaste: $('#wechat-paste'),
  dialogShareCard: $('#dialog-share-card'),
  dialogInbox: $('#dialog-inbox'),
  formInbox: $('#form-inbox'),
  importText: $('#import-text'),
  importResult: $('#import-result'),
  inboxList: $('#inbox-list'),
  inboxCount: $('#inbox-count'),
  inboxBadge: $('#inbox-badge'),
  taskList: $('#task-list'),
  tasksBadge: $('#tasks-badge'),
  tasksDateLabel: $('#tasks-date-label'),
  captureStatus: $('#capture-status'),
  captureCounter: $('#capture-counter'),
  captureSessionsEl: $('#capture-sessions'),
};

async function init() {
  await openDB();
  await seedDemoData();
  properties = await getAllProperties();
  calendarCtrl = createCalendarController(els.calendarView, (pid) => {
    selectedId = pid;
    switchView('album');
    renderPropertyList();
    renderAlbum();
  });

  initSpeech();
  bindEvents();
  await loadInboxAndTasks();
  await loadCaptureSessions();
  handleShareLaunch();
  renderPropertyList();
  renderLeaseAlerts();
  calendarCtrl.render(properties);
  await showReminderPopup();
  scheduleDailyCheck();
  setupMobile();
}

function setupMobile() {
  setupMobileUI();
  $('#btn-close-drawer')?.addEventListener('click', closePropertyDrawer);

  document.querySelectorAll('.bottom-nav .nav-item').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  setupInstallPrompt(() => showInstallBanner());

  if (!isStandalone() && !localStorage.getItem('install-dismissed')) {
    if (showIOSInstallHint()) {
      showInstallBanner(true);
    } else if (isMobile()) {
      setTimeout(showInstallBanner, 1500);
    }
  }

  $('#btn-install')?.addEventListener('click', async () => {
    if (isWeChat()) {
      showToast('微信里无法安装，请点右上角「在浏览器打开」', 'error');
      return;
    }
    const ok = await promptInstall();
    if (ok) {
      $('#install-banner').hidden = true;
    } else if (showIOSInstallHint()) {
      showInstallBanner(true);
      showToast('Safari 点底部分享 → 添加到主屏幕', 'success');
    } else if (isAndroid()) {
      showToast('Chrome 点右上角 ⋮ → 添加到主屏幕', 'success');
    } else {
      showToast('请用浏览器菜单「添加到主屏幕」', 'success');
    }
  });

  $('#btn-dismiss-install')?.addEventListener('click', () => {
    $('#install-banner').hidden = true;
    localStorage.setItem('install-dismissed', '1');
  });

  if (isMobile()) {
    document.body.classList.add('is-mobile');
  }
}

function showInstallBanner(iosOnly = false) {
  const banner = $('#install-banner');
  const hint = $('#install-hint');
  if (!banner || isStandalone()) return;

  if (iosOnly || showIOSInstallHint()) {
    hint.textContent = 'Safari 点分享 →「添加到主屏幕」';
    $('#btn-install').textContent = '怎么装';
  } else {
    hint.textContent = '像 App 一样打开，不用每次找网页';
    $('#btn-install').textContent = '安装';
  }
  banner.hidden = false;
}

async function loadInboxAndTasks(forceRegenerate = false) {
  inboxItems = await getAllInbox();
  const tomorrow = getTomorrowISO();
  let existing = await getAllTasks({ dueDate: tomorrow });

  if (forceRegenerate || existing.length === 0) {
    await regenerateTomorrowTasks(properties, inboxItems);
    existing = await getAllTasks({ dueDate: tomorrow });
  }
  tomorrowTasks = existing;
  updateBadges();
}

function getTomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function handleShareLaunch() {
  const params = new URLSearchParams(window.location.search);
  const shared = params.get('text') || params.get('title');
  if (shared) {
    els.importText.value = shared;
    switchView('import');
  }
}

function initSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    els.voiceHint.textContent = '当前浏览器不支持语音识别，请用 Chrome / Edge';
    els.btnVoice.disabled = true;
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'zh-CN';
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 3;

  recognition.onstart = () => {
    isListening = true;
    els.btnVoice.classList.add('listening');
    els.voiceStatus.classList.add('listening');
    els.voiceHint.textContent = '正在听…';
  };

  recognition.onend = () => {
    isListening = false;
    els.btnVoice.classList.remove('listening');
    els.voiceStatus.classList.remove('listening');
    els.voiceHint.textContent = pendingFiles.length
      ? '已选图，按住说话指定房号'
      : '拍照或选图后，按住说话指定房号';
  };

  recognition.onerror = (e) => {
    if (e.error === 'no-speech') showToast('没听到声音，请再试一次', 'error');
    else if (e.error !== 'aborted') showToast(`语音识别失败：${e.error}`, 'error');
  };

  recognition.onresult = (e) => {
    let transcript = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) transcript = e.results[i][0].transcript;
    }
    if (!transcript) {
      for (let i = e.results.length - 1; i >= 0; i--) {
        transcript = e.results[i][0].transcript;
        break;
      }
    }
    if (transcript) {
      els.voiceHint.textContent = `听到：「${transcript}」`;
      handleVoiceCommand(transcript);
    }
  };
}

function bindEvents() {
  $('#btn-add-property').addEventListener('click', () => openPropertyDialog());
  $('#btn-calendar').addEventListener('click', () => switchView('calendar'));
  $('#btn-cancel-property').addEventListener('click', () => els.dialogProperty.close());
  $('#btn-cancel-lease').addEventListener('click', () => els.dialogLease.close());
  $('#btn-edit-lease').addEventListener('click', () => openLeaseDialog());
  $('#btn-export').addEventListener('click', exportAlbum);
  $('#btn-share-card').addEventListener('click', () => shareCurrentPropertyCard());
  $('#btn-parse-wechat').addEventListener('click', parseWeChatAndFill);
  $('#btn-export-ics').addEventListener('click', () => exportLeaseCalendar());
  $('#btn-reminder-share').addEventListener('click', () => shareReminderCards());
  $('#btn-reminder-ok').addEventListener('click', closeReminderPopup);
  $('#btn-reminder-speak').addEventListener('click', () => speakReminders(pendingReminders));
  $('#btn-reminder-calendar').addEventListener('click', () => {
    downloadICS(properties);
    showToast('日历已导出，可导入微信/手机日历', 'success');
  });

  document.querySelectorAll('.view-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });

  els.formProperty.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(els.formProperty);
    const property = {
      id: uid(),
      name: fd.get('name').trim(),
      building: fd.get('building').trim(),
      unit: fd.get('unit').trim(),
      lease: { tenant: '', startDate: '', endDate: '', rent: '', remind: true, voiceRemind: true },
      createdAt: Date.now(),
    };
    await saveProperty(property);
    properties = await getAllProperties();
    els.dialogProperty.close();
    els.formProperty.reset();
    selectedId = property.id;
    refreshUI();
    showToast(`已添加 ${formatPropertyLabel(property)}`, 'success');
  });

  els.formLease.addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = properties.find((x) => x.id === selectedId);
    if (!p) return;
    const fd = new FormData(els.formLease);
    p.lease = {
      tenant: fd.get('tenant').trim(),
      startDate: fd.get('startDate'),
      endDate: fd.get('endDate'),
      rent: fd.get('rent'),
      remind: fd.get('remind') === 'on',
      voiceRemind: fd.get('voiceRemind') === 'on',
      wechatNote: els.wechatPaste.value.trim(),
    };
    setVoiceReminderEnabled(p.lease.voiceRemind);
    await saveProperty(p);
    els.dialogLease.close();
    refreshUI();

    if (fd.get('syncCalendar') === 'on' && p.lease.endDate) {
      downloadICS(properties, `${p.name}_${p.unit}_租期.ics`, p.id);
      showToast('租期已保存，日历文件已下载', 'success');
    } else {
      showToast('租期已保存，到期前30天会弹窗提醒', 'success');
    }
  });

  els.searchInput.addEventListener('input', () => renderPropertyList());
  els.photoInput.addEventListener('change', (e) => {
    const files = [...e.target.files].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    setPendingFiles(files);
    e.target.value = '';
  });

  els.leaseAlerts.addEventListener('click', () => {
    if (pendingReminders.length) openReminderPopup(pendingReminders);
  });

  setupVoiceButton();
  $('#preview-close').addEventListener('click', clearPendingFiles);
  setupShareCardDialog();
  setupImportInboxTasks();
  setupScreenCapture();
}

async function loadCaptureSessions() {
  captureSessions = await getAllCaptureSessions();
}

function setupScreenCapture() {
  $('#btn-start-capture').addEventListener('click', startCaptureSession);
  $('#btn-stop-capture').addEventListener('click', endCaptureSession);
  $('#btn-pin-capture').addEventListener('click', async () => {
    await manualCapture('manual');
    showToast('已保留当前画面', 'success');
  });
}

let captureCache = new Map();

async function startCaptureSession() {
  try {
    liveCaptureCount = 0;
    const sessionId = await startScreenCapture({
      onFrame: handleCaptureFrame,
      onStatus: (msg) => setCaptureUI(true, msg),
      onEnd: () => endCaptureSession(),
    });

    currentCaptureSessionId = sessionId;
    await saveCaptureSession({
      id: sessionId,
      startedAt: Date.now(),
      endedAt: null,
      itemCount: 0,
    });
    captureSessions = await getAllCaptureSessions();
    setCaptureUI(true, '采集中… 请切换到要录制的窗口');
    showToast('请选择要采集的屏幕或窗口', 'success');
  } catch (err) {
    console.error(err);
    showToast(err.message || '无法开始屏幕采集', 'error');
    setCaptureUI(false);
  }
}

async function endCaptureSession() {
  if (endingCapture) return;
  if (!currentCaptureSessionId && !isCapturing()) return;
  endingCapture = true;

  const sessionId = stopScreenCapture() || currentCaptureSessionId;
  if (sessionId) {
    const session = captureSessions.find((s) => s.id === sessionId);
    if (session) {
      session.endedAt = Date.now();
      session.itemCount = liveCaptureCount;
      await saveCaptureSession(session);
    }
  }
  currentCaptureSessionId = null;
  liveCaptureCount = 0;
  await loadCaptureSessions();
  renderCaptureSessions();
  setCaptureUI(false, '采集已结束，仅保留图片和文字');
  showToast('采集结束，资料已存档', 'success');
  endingCapture = false;
}

async function handleCaptureFrame({ phase, item }) {
  if (!currentCaptureSessionId) return;

  item.sessionId = currentCaptureSessionId;
  await saveCapture(item);

  if (phase === 'image') {
    liveCaptureCount++;
    updateCaptureCounter();
  }

  if (phase === 'text' && item.ocrText) {
    await saveCapture(item);
    const parsed = parseWeChatText(item.ocrText);
    if (parsed && (parsed.endDate || parsed.rent || parsed.tenant)) {
      item.parsedHint = parsed;
      await saveCapture(item);
    }
  }

  renderCaptureSessions();
}

function setCaptureUI(recording, msg) {
  $('#btn-start-capture').hidden = recording;
  $('#btn-stop-capture').hidden = !recording;
  $('#btn-pin-capture').hidden = !recording;
  els.captureCounter.hidden = !recording;

  if (recording) {
    els.captureStatus.className = 'capture-status recording';
    els.captureStatus.innerHTML = `<span class="capture-live">${escapeHtml(msg || '采集中')}</span>`;
    updateCaptureCounter();
  } else {
    els.captureStatus.className = 'capture-status';
    els.captureStatus.innerHTML = `<span class="capture-idle">${escapeHtml(msg || '未开始采集')}</span>`;
    els.captureCounter.hidden = true;
  }
}

function updateCaptureCounter() {
  els.captureCounter.hidden = false;
  els.captureCounter.innerHTML = `已保留 <strong>${liveCaptureCount}</strong> 条资料（图片+文字，无视频）`;
}

async function renderCaptureSessions() {
  captureCache.clear();
  if (!captureSessions.length) {
    els.captureSessionsEl.innerHTML = '<p class="panel-desc">暂无采集记录，开始采集后会在这里显示</p>';
    return;
  }

  let html = '';
  for (const session of captureSessions.slice(0, 10)) {
    const caps = await getCapturesBySession(session.id);
    const unique = dedupeCaptures(caps);
    unique.forEach((c) => captureCache.set(c.id, c));
    const time = new Date(session.startedAt).toLocaleString('zh-CN');
    html += `
      <div class="capture-session" data-session="${session.id}">
        <div class="capture-session-head">
          <span>${time} · ${unique.length} 条资料</span>
          <button type="button" class="btn secondary" style="padding:4px 10px;font-size:0.75rem" data-del-session="${session.id}">删除</button>
        </div>
        <div class="capture-grid">${unique.map(renderCaptureCard).join('')}</div>
      </div>`;
  }
  els.captureSessionsEl.innerHTML = html;

  els.captureSessionsEl.querySelectorAll('[data-del-session]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('删除这次采集的全部资料？')) return;
      await deleteCaptureSession(btn.dataset.delSession);
      await loadCaptureSessions();
      renderCaptureSessions();
    });
  });

  bindCaptureCardActions();
}

function dedupeCaptures(caps) {
  const seen = new Set();
  return caps.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

function renderCaptureCard(c) {
  const url = URL.createObjectURL(c.blob);
  const text = c.ocrText ? escapeHtml(c.ocrText.slice(0, 120)) : '（识别中…）';
  return `
    <div class="capture-card" data-id="${c.id}">
      <img src="${url}" alt="" data-full="${url}">
      <div class="capture-card-body">
        <div class="capture-card-text">${text}</div>
        <div class="capture-card-actions">
          <button type="button" data-action="import-text" data-id="${c.id}">导入文字</button>
          <button type="button" data-action="save-photo" data-id="${c.id}">存入相册</button>
          <button type="button" data-action="del" data-id="${c.id}">删除</button>
        </div>
      </div>
    </div>`;
}

function bindCaptureCardActions() {
  els.captureSessionsEl.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const cap = captureCache.get(id);
      if (!cap) return;

      if (btn.dataset.action === 'import-text') {
        els.importText.value = cap.ocrText || '';
        switchView('import');
        showToast('文字已填入导入页，点「开始整理」', 'success');
      } else if (btn.dataset.action === 'save-photo') {
        if (!selectedId) {
          showToast('请先在相册页选择房源', 'error');
          return;
        }
        await savePhoto({
          id: uid(),
          propertyId: selectedId,
          tag: '屏幕采集',
          blob: cap.blob,
          mimeType: cap.mimeType || 'image/jpeg',
          createdAt: Date.now(),
        });
        refreshUI();
        showToast('图片已存入当前房源相册', 'success');
      } else if (btn.dataset.action === 'del') {
        await deleteCapture(id);
        renderCaptureSessions();
      }
    });
  });
}

function setupImportInboxTasks() {
  $('#btn-run-import').addEventListener('click', () => runWeChatImport());
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    els.importText.value = await file.text();
    e.target.value = '';
    showToast('文件已载入，点「开始整理」', 'success');
  });
  $('#btn-refresh-tasks').addEventListener('click', async () => {
    await loadInboxAndTasks(true);
    renderTasks();
    showToast('明日任务已刷新', 'success');
  });
  $('#btn-share-tasks').addEventListener('click', shareTaskList);
  $('#btn-inbox-cancel').addEventListener('click', () => els.dialogInbox.close());
  $('#btn-inbox-ignore').addEventListener('click', () => ignoreInboxItem());

  els.formInbox.addEventListener('submit', async (e) => {
    e.preventDefault();
    await resolveInboxItem();
  });
}

async function runWeChatImport() {
  const text = els.importText.value.trim();
  if (!text) {
    showToast('请先粘贴微信聊天记录', 'error');
    return;
  }

  const messages = splitWeChatMessages(text);
  if (!messages.length) {
    showToast('未检测到有效消息', 'error');
    return;
  }

  const results = [];
  for (const msg of messages) {
    const analysis = parseWeChatMessage(msg, properties);
    if (analysis.confidence === 'high' && analysis.propertyId) {
      const p = properties.find((x) => x.id === analysis.propertyId);
      const updated = applyParsedToProperty(p, analysis.parsed);
      await saveProperty(updated);
      results.push({ action: 'auto', analysis, label: formatPropertyLabel(updated) });
    } else {
      const inboxItem = {
        id: uid(),
        rawText: msg,
        parsed: analysis.parsed,
        hint: analysis.hint,
        propertyId: analysis.propertyId,
        propertyLabel: analysis.propertyLabel,
        confidence: analysis.confidence,
        issues: analysis.issues,
        category: analysis.category,
        status: 'pending',
        createdAt: Date.now(),
      };
      await saveInboxItem(inboxItem);
      results.push({
        action: analysis.confidence === 'none' ? 'failed' : 'review',
        analysis,
        inboxItem,
      });
    }
  }

  properties = await getAllProperties();
  await loadInboxAndTasks(true);

  const summary = buildImportSummary(results);
  showImportResult(summary, results);
  refreshUI();
  renderInbox();
  renderTasks();
  updateBadges();

  if (summary.review + summary.failed > 0) {
    showToast(`整理完成：${summary.auto} 条已归档，${summary.review + summary.failed} 条待你处理`, 'success');
  } else {
    showToast(`全部 ${summary.auto} 条已自动归档`, 'success');
  }
}

function showImportResult(summary, results) {
  els.importResult.hidden = false;
  els.importResult.innerHTML = `
    <div class="stat">
      <span class="ok">✓ 已归档 ${summary.auto}</span>
      <span class="warn">⚠ 待确认 ${summary.review}</span>
      <span class="bad">✕ 未识别 ${summary.failed}</span>
    </div>
    ${results.filter((r) => r.action !== 'auto').length
      ? `<p>无法完全识别的消息已放入「待处理」，请逐条确认。</p>
         <button type="button" class="btn secondary" id="btn-go-inbox">去处理 (${summary.review + summary.failed})</button>`
      : '<p>所有消息均已自动匹配房源并更新档案。</p>'}
    ${summary.auto ? `<p style="margin-top:8px;color:var(--text-muted);font-size:0.8rem">明日任务清单已更新，可到「明日任务」查看。</p>` : ''}`;

  $('#btn-go-inbox')?.addEventListener('click', () => switchView('inbox'));
}

function renderInbox() {
  const pending = inboxItems.filter((x) => x.status === 'pending');
  els.inboxCount.textContent = pending.length;

  if (!pending.length) {
    els.inboxList.innerHTML = '<div class="empty-state" style="min-height:160px"><p style="font-size:0.85rem">暂无待处理消息 🎉</p></div>';
    return;
  }

  els.inboxList.innerHTML = pending.map((item) => {
    const cat = CATEGORY_LABELS[item.category] || '其他';
    const failClass = item.confidence === 'none' ? ' fail' : '';
    return `
      <li class="inbox-item" data-id="${item.id}">
        <div class="inbox-meta">
          <span class="tag${failClass}">${escapeHtml(cat)}</span>
          ${item.propertyLabel ? `<span class="tag">${escapeHtml(item.propertyLabel)}</span>` : ''}
        </div>
        <div class="raw">${escapeHtml(item.rawText)}</div>
        <div class="issues">⚠ ${escapeHtml(inboxIssueLabel(item.issues))}</div>
      </li>`;
  }).join('');

  els.inboxList.querySelectorAll('.inbox-item').forEach((el) => {
    el.addEventListener('click', () => openInboxDialog(el.dataset.id));
  });
}

function openInboxDialog(id) {
  const item = inboxItems.find((x) => x.id === id);
  if (!item) return;
  activeInboxId = id;

  $('#inbox-raw').textContent = item.rawText;
  $('#inbox-issues').textContent = `问题：${inboxIssueLabel(item.issues)}`;

  const select = $('#inbox-property-select');
  select.innerHTML = '<option value="">— 选择已有房源 —</option>' +
    properties.map((p) => `<option value="${p.id}"${p.id === item.propertyId ? ' selected' : ''}>${escapeHtml(formatPropertyLabel(p))}</option>`).join('');

  const form = els.formInbox;
  form.name.value = item.hint?.name || '';
  form.building.value = item.hint?.building || '';
  form.unit.value = item.hint?.unit || '';
  form.tenant.value = item.parsed?.tenant || '';
  form.endDate.value = item.parsed?.endDate || '';
  form.rent.value = item.parsed?.rent || '';

  els.dialogInbox.showModal();
}

async function resolveInboxItem() {
  const item = inboxItems.find((x) => x.id === activeInboxId);
  if (!item) return;

  const fd = new FormData(els.formInbox);
  let propertyId = fd.get('propertyId');

  if (!propertyId) {
    const name = fd.get('name').trim();
    const unit = fd.get('unit').trim();
    if (!name || !unit) {
      showToast('请选择房源或填写楼盘+房号', 'error');
      return;
    }
    const created = {
      id: uid(),
      name,
      building: fd.get('building').trim(),
      unit,
      lease: {},
      createdAt: Date.now(),
    };
    await saveProperty(created);
    propertyId = created.id;
  }

  let p = properties.find((x) => x.id === propertyId);
  if (!p) {
    properties = await getAllProperties();
    p = properties.find((x) => x.id === propertyId);
  }
  if (!p) {
    showToast('房源不存在', 'error');
    return;
  }
  const updated = applyParsedToProperty(p, {
    tenant: fd.get('tenant').trim(),
    endDate: fd.get('endDate'),
    rent: fd.get('rent'),
    note: item.rawText,
  });
  await saveProperty(updated);

  item.status = 'resolved';
  await saveInboxItem(item);

  properties = await getAllProperties();
  inboxItems = await getAllInbox();
  await loadInboxAndTasks(true);

  els.dialogInbox.close();
  refreshUI();
  renderInbox();
  renderTasks();
  updateBadges();
  showToast('已归档到房源档案', 'success');
}

async function ignoreInboxItem() {
  const item = inboxItems.find((x) => x.id === activeInboxId);
  if (!item) return;
  item.status = 'ignored';
  await saveInboxItem(item);
  inboxItems = await getAllInbox();
  els.dialogInbox.close();
  renderInbox();
  updateBadges();
  showToast('已忽略该消息', 'success');
}

function renderTasks() {
  els.tasksDateLabel.textContent = formatTomorrowLabel();

  if (!tomorrowTasks.length) {
    els.taskList.innerHTML = '<div class="empty-state" style="min-height:160px"><p style="font-size:0.85rem">明天暂无待办 🎉</p></div>';
    return;
  }

  els.taskList.innerHTML = tomorrowTasks.map((task) => {
    const icon = TASK_TYPE_ICONS[task.type] || '📌';
    return `
      <li class="task-item${task.done ? ' done' : ''}" data-id="${task.id}">
        <input type="checkbox" class="task-check" ${task.done ? 'checked' : ''}>
        <div class="task-body">
          <div class="task-title">${icon} ${escapeHtml(task.title)}</div>
          <div class="task-detail">${escapeHtml(task.detail || '')}</div>
          ${task.inboxId ? '<button type="button" class="task-link" data-inbox="' + task.inboxId + '">去处理消息 →</button>' : ''}
          ${task.propertyId ? '<button type="button" class="task-link" data-property="' + task.propertyId + '">查看房源 →</button>' : ''}
        </div>
      </li>`;
  }).join('');

  els.taskList.querySelectorAll('.task-check').forEach((cb) => {
    cb.addEventListener('change', async (e) => {
      const li = e.target.closest('.task-item');
      const task = tomorrowTasks.find((t) => t.id === li.dataset.id);
      if (!task) return;
      task.done = e.target.checked;
      await saveTask(task);
      li.classList.toggle('done', task.done);
      updateBadges();
    });
  });

  els.taskList.querySelectorAll('[data-inbox]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      switchView('inbox');
      openInboxDialog(btn.dataset.inbox);
    });
  });

  els.taskList.querySelectorAll('[data-property]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedId = btn.dataset.property;
      switchView('album');
      renderPropertyList();
      renderAlbum();
    });
  });
}

function updateBadges() {
  const pending = inboxItems.filter((x) => x.status === 'pending').length;
  const tasksLeft = tomorrowTasks.filter((t) => !t.done).length;

  els.inboxBadge.hidden = pending === 0;
  els.inboxBadge.textContent = pending;
  els.tasksBadge.hidden = tasksLeft === 0;
  els.tasksBadge.textContent = tasksLeft;

  const navInbox = $('#nav-inbox-badge');
  const navTasks = $('#nav-tasks-badge');
  if (navInbox) {
    navInbox.hidden = pending === 0;
    navInbox.textContent = pending;
  }
  if (navTasks) {
    navTasks.hidden = tasksLeft === 0;
    navTasks.textContent = tasksLeft;
  }
}

async function shareTaskList() {
  const lines = [`📋 明日任务（${formatTomorrowLabel()}）`, ''];
  for (const t of tomorrowTasks.filter((x) => !x.done)) {
    lines.push(`• ${t.title}${t.detail ? ' — ' + t.detail : ''}`);
  }
  if (lines.length <= 2) {
    showToast('明天没有待办', 'error');
    return;
  }
  const text = lines.join('\n');
  if (navigator.share) {
    try {
      await navigator.share({ title: '明日任务清单', text });
      return;
    } catch { /* fallback */ }
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast('任务清单已复制，可粘贴到微信', 'success');
  } catch {
    showToast('请手动复制任务清单', 'error');
  }
}

function setupShareCardDialog() {
  $('#btn-share-close').addEventListener('click', () => els.dialogShareCard.close());
  $('#btn-share-save').addEventListener('click', () => {
    const dialog = els.dialogShareCard;
    if (dialog._shareBlob) {
      downloadShareCard(dialog._shareBlob, dialog.dataset.filename);
      showToast('图片已保存', 'success');
    }
  });
  $('#btn-share-wechat').addEventListener('click', async () => {
    const dialog = els.dialogShareCard;
    if (!dialog._shareBlob) return;
    const p = properties.find((x) => x.id === selectedId);
    const title = p ? `${formatPropertyLabel(p)} 租期提醒` : '房源租期提醒';
    const ok = await nativeShareCard(dialog._shareBlob, dialog.dataset.filename, title);
    if (ok) {
      showToast('请在分享菜单选择微信', 'success');
    } else {
      downloadShareCard(dialog._shareBlob, dialog.dataset.filename);
      showToast('已保存图片，请打开微信从相册发送', 'success');
    }
  });
}

async function shareCurrentPropertyCard() {
  const p = properties.find((x) => x.id === selectedId);
  if (!p) {
    showToast('请先选择房源', 'error');
    return;
  }
  if (!p.lease?.endDate) {
    showToast('请先填写到期日', 'error');
    openLeaseDialog();
    return;
  }
  try {
    await openShareCardDialog(p, els.dialogShareCard);
  } catch (err) {
    console.error(err);
    showToast('生成分享卡片失败', 'error');
  }
}

async function shareReminderCards() {
  if (!pendingReminders.length) return;

  if (pendingReminders.length === 1) {
    selectedId = pendingReminders[0].property.id;
    await openShareCardDialog(pendingReminders[0].property, els.dialogShareCard);
    return;
  }

  for (const { property } of pendingReminders) {
    const { blob, filename } = await renderShareCard(property);
    downloadShareCard(blob, filename);
  }
  showToast(`已保存 ${pendingReminders.length} 张卡片，请在微信逐张发送`, 'success');
}

function switchView(view) {
  if (isMobile() && view === 'capture') {
    showToast('屏幕采集仅支持电脑，手机请用「导入」粘贴微信文字', 'error');
    return;
  }

  currentView = view;
  document.querySelectorAll('.view-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.view === view);
  });
  document.querySelectorAll('.bottom-nav .nav-item').forEach((t) => {
    t.classList.toggle('active', t.dataset.view === view);
  });

  closePropertyDrawer();

  const panelViews = ['import', 'inbox', 'tasks', 'capture'];
  const isPanel = panelViews.includes(view);

  els.main.classList.toggle('full-panel', isPanel);
  els.voiceDock.hidden = view !== 'album';
  els.emptyState.hidden = true;
  els.albumView.hidden = true;
  els.calendarView.hidden = true;
  els.importView.hidden = true;
  els.inboxView.hidden = true;
  els.tasksView.hidden = true;
  els.captureView.hidden = true;

  if (view === 'calendar') {
    els.calendarView.hidden = false;
    calendarCtrl.render(properties);
  } else if (view === 'import') {
    els.importView.hidden = false;
  } else if (view === 'inbox') {
    els.inboxView.hidden = false;
    renderInbox();
  } else if (view === 'tasks') {
    els.tasksView.hidden = false;
    renderTasks();
  } else if (view === 'capture') {
    els.captureView.hidden = false;
    renderCaptureSessions();
  } else if (selectedId) {
    renderAlbum();
  } else {
    els.emptyState.hidden = false;
  }
}

function refreshUI() {
  renderPropertyList();
  renderAlbum();
  renderLeaseAlerts();
  renderInbox();
  renderTasks();
  updateBadges();
  calendarCtrl.render(properties);
}

function parseWeChatAndFill() {
  const text = els.wechatPaste.value.trim();
  if (!text) {
    showToast('请先粘贴微信出租或收费信息', 'error');
    return;
  }
  const parsed = parseWeChatText(text);
  if (!parsed) {
    showToast('未能识别日期或租金，请检查格式', 'error');
    return;
  }
  const form = els.formLease;
  if (parsed.tenant) form.tenant.value = parsed.tenant;
  if (parsed.startDate) form.startDate.value = parsed.startDate;
  if (parsed.endDate) form.endDate.value = parsed.endDate;
  if (parsed.rent) form.rent.value = parsed.rent;
  showToast('已识别微信信息，请确认后保存', 'success');
}

function exportLeaseCalendar() {
  const p = properties.find((x) => x.id === selectedId);
  if (!p?.lease?.endDate) {
    showToast('请先填写到期日', 'error');
    return;
  }
  downloadICS(properties, `${p.name}_${p.unit}_租期.ics`, p.id);
  showToast('日历已导出，可导入微信/手机日历', 'success');
}

async function showReminderPopup() {
  pendingReminders = getUndismissedReminders(properties, REMINDER_DAYS);
  if (!pendingReminders.length) return;

  openReminderPopup(pendingReminders);

  const shouldSpeak = pendingReminders.some(
    (r) => r.property.lease?.voiceRemind !== false
  ) && isVoiceReminderEnabled();

  if (shouldSpeak) {
    setTimeout(() => speakReminders(pendingReminders), 600);
  }

  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  for (const { property, status } of pendingReminders) {
    if (Notification.permission === 'granted') {
      const label = formatPropertyLabel(property);
      const body = status.type === 'expired'
        ? `${label} 租期已过期`
        : `${label} 还有 ${status.diffDays} 天到期`;
      new Notification('租期到期提醒', { body, tag: `lease-${property.id}` });
    }
  }
}

function openReminderPopup(reminders) {
  pendingReminders = reminders;
  els.reminderList.innerHTML = reminders.map(({ property, status }) => {
    const label = formatPropertyLabel(property);
    const lease = property.lease || {};
    const meta = [
      lease.tenant && `租客：${lease.tenant}`,
      lease.endDate && `到期：${lease.endDate}`,
      lease.rent && `月租：¥${lease.rent}`,
      status.label,
    ].filter(Boolean).join(' · ');
    return `
      <li class="${status.type === 'expired' ? 'expired' : ''}" data-id="${property.id}">
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(meta)}</span>
      </li>`;
  }).join('');

  els.reminderList.querySelectorAll('li').forEach((li) => {
    li.addEventListener('click', () => {
      selectedId = li.dataset.id;
      closeReminderPopup();
      switchView('album');
      renderPropertyList();
      renderAlbum();
    });
  });

  els.dialogReminder.showModal();
}

function closeReminderPopup() {
  dismissAllReminders(pendingReminders, REMINDER_DAYS);
  stopSpeaking();
  els.dialogReminder.close();
  renderLeaseAlerts();
}

function scheduleDailyCheck() {
  setInterval(() => {
    const reminders = getUndismissedReminders(properties, REMINDER_DAYS);
    if (reminders.length) showReminderPopup();
  }, 3600000);
}

function setupVoiceButton() {
  const btn = els.btnVoice;
  const start = (e) => {
    e.preventDefault();
    if (!recognition || isListening) return;
    if (!pendingFiles.length) {
      showToast('请先拍照或选择图片', 'error');
      return;
    }
    try { recognition.start(); } catch { /* noop */ }
  };
  const stop = (e) => {
    e.preventDefault();
    if (recognition && isListening) {
      try { recognition.stop(); } catch { /* noop */ }
    }
  };
  btn.addEventListener('mousedown', start);
  btn.addEventListener('mouseup', stop);
  btn.addEventListener('mouseleave', stop);
  btn.addEventListener('touchstart', start, { passive: false });
  btn.addEventListener('touchend', stop);
  btn.addEventListener('touchcancel', stop);
}

function setPendingFiles(files) {
  pendingFiles = files;
  els.previewImg.src = URL.createObjectURL(files[0]);
  els.voicePreview.hidden = false;
  if (files.length > 1) {
    els.voiceHint.textContent = `已选 ${files.length} 张，按住说话指定房号`;
  }
}

function clearPendingFiles() {
  pendingFiles = [];
  els.voicePreview.hidden = true;
  els.previewImg.src = '';
  els.voiceHint.textContent = '拍照或选图后，按住说话指定房号';
}

async function handleVoiceCommand(transcript) {
  const result = parseVoiceCommand(transcript, properties);
  if (!result) {
    showToast('未找到匹配房源，请说「放入楼盘名+房号」', 'error');
    return;
  }
  const { property, tag } = result;
  if (!pendingFiles.length) {
    selectedId = property.id;
    switchView('album');
    renderPropertyList();
    renderAlbum();
    showToast(`已切换到 ${formatPropertyLabel(property)}`, 'success');
    return;
  }
  for (const file of pendingFiles) {
    await savePhoto({
      id: uid(),
      propertyId: property.id,
      tag: tag || '',
      blob: file,
      mimeType: file.type,
      createdAt: Date.now(),
    });
  }
  const savedCount = pendingFiles.length;
  selectedId = property.id;
  clearPendingFiles();
  refreshUI();
  const tagStr = tag ? ` · ${tag}` : '';
  showToast(`✓ ${savedCount} 张已放入 ${formatPropertyLabel(property)}${tagStr}`, 'success');
}

function openPropertyDialog() {
  els.formProperty.reset();
  els.dialogProperty.showModal();
}

function openLeaseDialog() {
  const p = properties.find((x) => x.id === selectedId);
  if (!p) return;
  const form = els.formLease;
  const lease = p.lease || {};
  form.tenant.value = lease.tenant || '';
  form.startDate.value = lease.startDate || '';
  form.endDate.value = lease.endDate || '';
  form.rent.value = lease.rent || '';
  form.remind.checked = lease.remind !== false;
  form.voiceRemind.checked = lease.voiceRemind !== false;
  form.syncCalendar.checked = true;
  els.wechatPaste.value = lease.wechatNote || '';
  els.dialogLease.showModal();
}

function renderLeaseAlerts() {
  pendingReminders = getUndismissedReminders(properties, REMINDER_DAYS);
  const alerts = pendingReminders;

  if (!alerts.length) {
    els.leaseAlerts.hidden = true;
    els.leaseAlerts.classList.remove('clickable');
    return;
  }

  const lines = alerts.map(({ property, status }) => {
    const label = formatPropertyLabel(property);
    if (status.type === 'expired') return `⚠ ${label} 租期已过期`;
    return `⏰ ${label} 还有 ${status.diffDays} 天到期`;
  });

  els.leaseAlerts.textContent = lines.join('  ·  ') + '  （点击查看）';
  els.leaseAlerts.hidden = false;
  els.leaseAlerts.classList.add('clickable');
}

async function renderPropertyList() {
  const query = els.searchInput.value.trim().toLowerCase();
  const filtered = properties.filter((p) => {
    if (!query) return true;
    return `${p.name} ${p.building} ${p.unit}`.toLowerCase().includes(query);
  });

  const groups = {};
  for (const p of filtered) {
    if (!groups[p.name]) groups[p.name] = [];
    groups[p.name].push(p);
  }

  if (!filtered.length) {
    els.propertyList.innerHTML = '<div class="empty-state" style="min-height:120px"><p style="font-size:0.85rem">暂无房源</p></div>';
    return;
  }

  let html = '';
  for (const [name, items] of Object.entries(groups)) {
    html += `<div class="property-group"><div class="property-group-name">${escapeHtml(name)}</div>`;
    for (const p of items) {
      const status = getLeaseStatus(p);
      const count = await countPhotosByProperty(p.id);
      const active = p.id === selectedId ? ' active' : '';
      let badge = `<span class="badge">${count}张</span>`;
      if (status && status.type !== 'ok') {
        badge = `<span class="badge ${status.type}">${status.label}</span>`;
      }
      html += `
        <div class="property-item${active}" data-id="${p.id}">
          <div>
            <div class="unit">${escapeHtml(p.unit)}</div>
            <div class="meta">${escapeHtml(p.building || '')}</div>
          </div>
          ${badge}
        </div>`;
    }
    html += '</div>';
  }

  els.propertyList.innerHTML = html;
  els.propertyList.querySelectorAll('.property-item').forEach((el) => {
    el.addEventListener('click', () => {
      selectedId = el.dataset.id;
      closePropertyDrawer();
      switchView('album');
      renderPropertyList();
      renderAlbum();
    });
  });
}

async function renderAlbum() {
  const p = properties.find((x) => x.id === selectedId);
  if (!p) {
    if (currentView === 'album') {
      els.emptyState.hidden = false;
      els.albumView.hidden = true;
    }
    return;
  }

  els.emptyState.hidden = true;
  els.albumView.hidden = false;
  els.calendarView.hidden = true;
  els.albumTitle.textContent = formatPropertyLabel(p);

  const lease = p.lease || {};
  const parts = [];
  if (lease.tenant) parts.push(`租客：${lease.tenant}`);
  if (lease.endDate) parts.push(`到期：${lease.endDate}`);
  if (lease.rent) parts.push(`月租：¥${lease.rent}`);
  const status = getLeaseStatus(p);
  if (status && status.type !== 'ok') parts.push(status.label);
  if (lease.endDate) {
    const remindDate = new Date(lease.endDate);
    remindDate.setDate(remindDate.getDate() - REMINDER_DAYS);
    parts.push(`提醒日：${remindDate.toISOString().slice(0, 10)}`);
  }
  els.leaseInfo.textContent = parts.length
    ? parts.join('  ·  ')
    : '未设置租期，点击「租期」粘贴微信信息或手动填写';

  const photos = await getPhotosByProperty(p.id);
  if (!photos.length) {
    els.photoGrid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;min-height:160px"><p style="font-size:0.85rem">暂无照片，选图后语音说「放入${escapeHtml(p.name + p.unit)}」</p></div>`;
    return;
  }

  els.photoGrid.innerHTML = photos.map((photo) => {
    const url = URL.createObjectURL(photo.blob);
    const tagHtml = photo.tag ? `<span class="tag">${escapeHtml(photo.tag)}</span>` : '';
    return `
      <div class="photo-card" data-id="${photo.id}">
        <img src="${url}" alt="" loading="lazy">
        ${tagHtml}
        <button type="button" class="delete-btn" data-delete="${photo.id}">×</button>
      </div>`;
  }).join('');

  els.photoGrid.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('删除这张照片？')) return;
      await deletePhoto(btn.dataset.delete);
      refreshUI();
    });
  });
}

async function exportAlbum() {
  const p = properties.find((x) => x.id === selectedId);
  if (!p) return;
  const photos = await getPhotosByProperty(p.id);
  if (!photos.length) {
    showToast('该相册暂无照片', 'error');
    return;
  }
  if (typeof JSZip === 'undefined') {
    showToast('导出组件加载失败，请检查网络', 'error');
    return;
  }
  const zip = new JSZip();
  const folderName = `${p.name}_${p.building || ''}_${p.unit}`.replace(/\s+/g, '');
  photos.forEach((photo, i) => {
    const ext = (photo.mimeType || 'image/jpeg').split('/')[1] || 'jpg';
    const tagPart = photo.tag ? `_${photo.tag}` : '';
    zip.file(`${String(i + 1).padStart(2, '0')}${tagPart}.${ext}`, photo.blob);
  });
  const blob = await zip.generateAsync({ type: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${folderName}_相册.zip`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('相册已导出', 'success');
}

function showToast(msg, type = '') {
  els.toast.textContent = msg;
  els.toast.className = 'toast' + (type ? ` ${type}` : '');
  els.toast.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => { els.toast.hidden = true; }, 3200);
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

init().catch((err) => {
  console.error(err);
  showToast('初始化失败，请刷新重试', 'error');
});
