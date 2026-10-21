'use strict';

const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content ?? '';

/** JSON helper with CSRF header. Throws Error(message) for non-2xx responses. */
async function api(method, url, body) {
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await response.json(); } catch { /* empty body */ }
  if (!response.ok) throw new Error(data?.error ?? `Request failed (${response.status})`);
  return data;
}

function toast(message, type = 'ok') {
  const box = document.getElementById('toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message; // textContent: never interpret server text as HTML
  box.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

/** Promise based confirmation dialog. */
function confirmDialog(message) {
  const dialog = document.getElementById('confirm-dialog');
  if (!dialog) return Promise.resolve(window.confirm(message));
  dialog.querySelector('[data-message]').textContent = message;
  return new Promise((resolve) => {
    const onClose = () => { dialog.removeEventListener('close', onClose); resolve(dialog.returnValue === 'yes'); };
    dialog.addEventListener('close', onClose);
    dialog.returnValue = 'no';
    dialog.showModal();
  });
}

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest('[data-menu]')) document.getElementById('sidebar')?.classList.toggle('open');
  else if (!target.closest('#sidebar')) document.getElementById('sidebar')?.classList.remove('open');

  const opener = target.closest('[data-open]');
  if (opener) document.getElementById(opener.getAttribute('data-open'))?.showModal();
  const closer = target.closest('[data-close]');
  if (closer) closer.closest('dialog')?.close();
});

/** Live uptime counters: <span data-uptime="seconds"> */
document.querySelectorAll('[data-uptime]').forEach((el) => {
  let seconds = Number(el.getAttribute('data-uptime')) || 0;
  const render = () => {
    const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
    el.textContent = `${d ? d + 'd ' : ''}${h}h ${m}m ${s}s`;
  };
  render();
  setInterval(() => { seconds++; render(); }, 1000);
});

/** count-up: numbers in .stat .value animate from 0 (skipped when the user prefers reduced motion). */
(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.querySelectorAll('.stat .value').forEach((el) => {
    const raw = el.textContent.trim();
    if (!/^\d{1,9}$/.test(raw)) return;
    const target = Number(raw);
    if (target < 2) return;
    const start = performance.now();
    const duration = 900;
    const step = (now) => {
      const p = Math.min(1, (now - start) / duration);
      el.textContent = String(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(step);
    };
    el.textContent = '0';
    requestAnimationFrame(step);
  });
})();