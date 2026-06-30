export function isMobile() {
  return window.matchMedia('(max-width: 768px)').matches
    || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function isIOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function isWeChat() {
  return /MicroMessenger/i.test(navigator.userAgent);
}

export function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

export function openPropertyDrawer() {
  document.getElementById('property-drawer')?.classList.add('open');
  document.getElementById('drawer-backdrop')?.classList.add('show');
}

export function closePropertyDrawer() {
  document.getElementById('property-drawer')?.classList.remove('open');
  document.getElementById('drawer-backdrop')?.classList.remove('show');
}

export function setupMobileUI() {
  const drawerBtn = document.getElementById('btn-open-drawer');
  const backdrop = document.getElementById('drawer-backdrop');

  drawerBtn?.addEventListener('click', openPropertyDrawer);
  backdrop?.addEventListener('click', closePropertyDrawer);

  document.querySelectorAll('.bottom-nav .nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      closePropertyDrawer();
    });
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  if (isWeChat()) {
    showWeChatGuide();
  }
}

export function showWeChatGuide() {
  if (document.getElementById('wechat-guide')) return;

  const el = document.createElement('div');
  el.id = 'wechat-guide';
  el.className = 'wechat-guide';
  el.innerHTML = `
    <div class="wechat-guide-box">
      <h3>⚠️ 微信里无法安装</h3>
      <p>请点右上角 <strong>⋯</strong> 或 <strong>···</strong></p>
      <p>选择 <strong>「在浏览器打开」</strong></p>
      <p class="wechat-sub">然后用 Safari（苹果）或 Chrome（安卓）添加到主屏幕</p>
      <button type="button" class="btn primary" id="wechat-guide-copy">复制网址，去浏览器粘贴</button>
      <button type="button" class="btn secondary" id="wechat-guide-close">我知道了</button>
    </div>`;
  document.body.appendChild(el);

  document.getElementById('wechat-guide-copy')?.addEventListener('click', async () => {
    const url = location.href;
    try {
      await navigator.clipboard.writeText(url);
      alert('网址已复制！\n\n请打开 Safari 或 Chrome，粘贴到地址栏打开，再添加到主屏幕。');
    } catch {
      prompt('请复制此网址，到 Safari/Chrome 打开：', url);
    }
  });

  document.getElementById('wechat-guide-close')?.addEventListener('click', () => {
    el.remove();
  });
}
