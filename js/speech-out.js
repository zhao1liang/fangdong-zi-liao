import { formatPropertyLabel } from './voice.js';

let enabled = localStorage.getItem('voiceReminder') !== 'false';

export function isVoiceReminderEnabled() {
  return enabled && 'speechSynthesis' in window;
}

export function setVoiceReminderEnabled(val) {
  enabled = !!val;
  localStorage.setItem('voiceReminder', enabled ? 'true' : 'false');
}

export function speak(text, { rate = 0.95, pitch = 1 } = {}) {
  if (!('speechSynthesis' in window) || !text) return Promise.resolve();

  return new Promise((resolve) => {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'zh-CN';
    utter.rate = rate;
    utter.pitch = pitch;
    utter.onend = () => resolve();
    utter.onerror = () => resolve();
    window.speechSynthesis.speak(utter);
  });
}

export function buildReminderSpeech(reminders) {
  if (!reminders.length) return '';

  const parts = ['您好，租期提醒。'];
  for (const { property, status } of reminders) {
    const label = formatPropertyLabel(property);
    const tenant = property.lease?.tenant;
    const rent = property.lease?.rent;

    if (status.type === 'expired') {
      parts.push(`${label}，租期已过期，请及时处理。`);
    } else {
      parts.push(`${label}，还有 ${status.diffDays} 天到期。`);
    }
    if (tenant) parts.push(`租客 ${tenant}。`);
    if (rent) parts.push(`月租 ${rent} 元。`);
  }
  parts.push('请提前联系租客续租或招租。');
  return parts.join('');
}

export async function speakReminders(reminders) {
  if (!isVoiceReminderEnabled() || !reminders.length) return;
  const text = buildReminderSpeech(reminders);
  await speak(text);
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}
