/* Standalone welcome sequence: authentication is never blocked. */
(() => {
  const splash = document.getElementById('introSplash');
  if (!splash) return;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    splash.remove();
  };
  const timer = window.setTimeout(close, reducedMotion ? 650 : 5650);
  document.getElementById('introSkip')?.addEventListener('click', () => {
    if (closed) return;
    splash.classList.add('is-skipping');
    window.clearTimeout(timer);
    window.setTimeout(close, 280);
  });
  splash.addEventListener('animationend', (event) => {
    if (event.target === splash && event.animationName === 'cmu-splash-leave') {
      window.clearTimeout(timer);
      close();
    }
  });
})();