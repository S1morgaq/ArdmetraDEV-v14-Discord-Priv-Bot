'use strict';

const page = document.getElementById('page');
const base = `/api/guilds/${page.dataset.guild}`;

document.getElementById('save-log-channel')?.addEventListener('click', async () => {
  const value = document.getElementById('log-channel').value;
  try {
    await api('PATCH', `${base}/settings`, { logChannelId: value === '' ? null : value });
    toast('Log channel saved.');
  } catch (error) {
    toast(error.message, 'err');
  }
});
