export function isMobile() {
  return window.matchMedia('(max-width: 768px)').matches
    || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function isIOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

let deferredPrompt = null;

export function setupInstallPrompt(onReady) {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    onReady?.();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

export async function promptInstall() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    return outcome === 'accepted';
  }
  return false;
}

export function showIOSInstallHint() {
  return isIOS() && !isStandalone();
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
}
