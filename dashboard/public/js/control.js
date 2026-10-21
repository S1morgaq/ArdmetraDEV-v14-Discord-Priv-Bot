'use strict';

const page = document.getElementById('page');
const base = `/api/guilds/${page.dataset.guild}`;

// Show optional fields only for the matching action.
function syncVisibility(form) {
  const select = form.querySelector('select[name="action"]');
  if (!select) return;
  form.querySelectorAll('[data-show-for]').forEach((el) => {
    el.hidden = el.dataset.showFor !== select.value;
  });
}
document.querySelectorAll('form[data-endpoint]').forEach((form) => {
  syncVisibility(form);
  form.querySelector('select[name="action"]')?.addEventListener('change', () => syncVisibility(form));
});

function collect(form) {
  const body = {};
  for (const [key, raw] of new FormData(form).entries()) {
    const value = String(raw);
    const input = form.elements[key];
    if (input && input.closest('[hidden]')) continue; // hidden optional fields are not sent
    if (value === '') continue;
    body[key] = input && input.dataset && input.dataset.number !== undefined ? Number(value) : value;
  }
  return body;
}

document.querySelectorAll('form[data-endpoint], form[data-endpoint-abs]').forEach((form) => {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type=submit]');
    const action = form.querySelector('select[name="action"]')?.value;
    const risky = ['ban', 'kick', 'unban'].includes(action);
    if (risky && !(await confirmDialog(`Really run "${action}" on this user?`))) return;

    button.disabled = true;
    try {
      const url = form.dataset.endpointAbs ?? `${base}/${form.dataset.endpoint}`;
      const result = await api('POST', url, collect(form));
      toast(result.message ?? 'Done.');
      if (form.hasAttribute('data-reload')) setTimeout(() => location.reload(), 800);
    } catch (error) {
      toast(error.message, 'err');
    } finally {
      button.disabled = false;
    }
  });
});

document.getElementById('restart-bot')?.addEventListener('click', async () => {
  if (!(await confirmDialog('Restart the bot now? The dashboard will be unavailable for a few seconds.'))) return;
  try {
    const result = await api('POST', '/api/bot/restart', {});
    toast(result.message);
  } catch (error) {
    toast(error.message, 'err');
  }
});
