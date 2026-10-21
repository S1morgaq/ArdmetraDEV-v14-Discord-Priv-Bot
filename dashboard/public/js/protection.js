'use strict';

const page = document.getElementById('page');
const guildId = page.dataset.guild;
const base = `/api/guilds/${guildId}`;

function collect() {
  const patch = {};
  document.querySelectorAll('[data-section][data-key]').forEach((input) => {
    const section = input.dataset.section;
    const key = input.dataset.key;
    let value;
    if (input.type === 'checkbox') value = input.checked;
    else if (input.dataset.kind === 'number') value = Math.round(Number(input.value) * Number(input.dataset.scale || 1));
    else if (input.dataset.kind === 'idlist') value = input.value.split(',').map((s) => s.trim()).filter(Boolean);
    else value = input.value;
    (patch[section] ??= {})[key] = value;
  });
  return patch;
}

document.getElementById('save-protection')?.addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await api('PATCH', `${base}/protection`, collect());
    toast('Protection settings saved.');
  } catch (error) {
    toast(error.message, 'err');
  } finally {
    button.disabled = false;
  }
});

// ---- whitelist ---------------------------------------------------------------------------------
const typeSelect = document.getElementById('wl-type');
const idInput = document.getElementById('wl-id');
const roleSelect = document.getElementById('wl-role');

typeSelect?.addEventListener('change', () => {
  const isRole = typeSelect.value === 'role';
  idInput.hidden = isRole;
  roleSelect.hidden = !isRole;
});

document.getElementById('wl-add')?.addEventListener('click', async () => {
  const type = typeSelect.value;
  const targetId = (type === 'role' ? roleSelect.value : idInput.value).trim();
  try {
    await api('POST', `${base}/whitelist`, { targetId, type });
    toast('Added to the whitelist.');
    setTimeout(() => location.reload(), 600);
  } catch (error) {
    toast(error.message, 'err');
  }
});

document.querySelectorAll('[data-wl-remove]').forEach((button) => {
  button.addEventListener('click', async () => {
    if (!(await confirmDialog('Remove this entry from the whitelist?'))) return;
    try {
      await api('DELETE', `${base}/whitelist`, { targetId: button.dataset.wlRemove });
      button.closest('tr')?.remove();
      toast('Removed.');
    } catch (error) {
      toast(error.message, 'err');
    }
  });
});
