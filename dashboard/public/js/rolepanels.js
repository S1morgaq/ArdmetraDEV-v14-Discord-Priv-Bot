'use strict';

const page = document.getElementById('page');
const base = `/api/guilds/${page.dataset.guild}`;

document.getElementById('panel-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  try {
    await api('POST', `${base}/rolepanels`, {
      channelId: form.elements.channelId.value,
      title: form.elements.title.value.trim(),
      description: form.elements.description.value.trim(),
      roleIds: Array.from(form.elements.roleIds.selectedOptions).map((o) => o.value),
    });
    toast('Panel posted.');
    setTimeout(() => location.reload(), 700);
  } catch (error) {
    toast(error.message, 'err');
    button.disabled = false;
  }
});

document.querySelectorAll('[data-panel-delete]').forEach((button) => {
  button.addEventListener('click', async () => {
    if (!(await confirmDialog('Delete this panel and its message?'))) return;
    try {
      await api('DELETE', `${base}/rolepanels/${button.dataset.panelDelete}`);
      button.closest('tr').remove();
      toast('Panel deleted.');
    } catch (error) {
      toast(error.message, 'err');
    }
  });
});
