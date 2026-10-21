'use strict';

const page = document.getElementById('page');
const base = `/api/guilds/${page.dataset.guild}`;
const form = document.getElementById('register-form');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button[type=submit]');
  const value = (name) => form.elements[name].value || null;
  button.disabled = true;
  try {
    const result = await api('PUT', `${base}/register`, {
      channelId: value('channelId'),
      chatChannelId: value('chatChannelId'),
      maleRoleId: value('maleRoleId'),
      femaleRoleId: value('femaleRoleId'),
      unregisteredRoleId: value('unregisteredRoleId'),
    });
    toast(result.message ?? 'Saved.');
    setTimeout(() => location.reload(), 800);
  } catch (error) {
    toast(error.message, 'err');
    button.disabled = false;
  }
});

document.getElementById('register-off').addEventListener('click', async () => {
  if (!(await confirmDialog('Turn registration off and remove the panel?'))) return;
  try {
    const result = await api('DELETE', `${base}/register`);
    toast(result.message ?? 'Turned off.');
    setTimeout(() => location.reload(), 800);
  } catch (error) {
    toast(error.message, 'err');
  }
});
