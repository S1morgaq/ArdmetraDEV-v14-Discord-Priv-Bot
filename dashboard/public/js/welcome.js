'use strict';

const page = document.getElementById('page');
const base = `/api/guilds/${page.dataset.guild}`;
const form = document.getElementById('welcome-form');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button[type=submit]');
  const value = (name) => form.elements[name].value.trim() || null;
  button.disabled = true;
  try {
    await api('PUT', `${base}/welcome`, {
      channelId: value('channelId'),
      goodbyeChannelId: value('goodbyeChannelId'),
      autoRoleId: value('autoRoleId'),
      message: value('message'),
      goodbyeMessage: value('goodbyeMessage'),
    });
    toast('Welcome settings saved.');
  } catch (error) {
    toast(error.message, 'err');
  } finally {
    button.disabled = false;
  }
});

document.getElementById('send-test').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const result = await api('POST', `${base}/welcome/test`, {});
    toast(result.message ?? 'Test card sent.');
  } catch (error) {
    toast(error.message, 'err');
  } finally {
    button.disabled = false;
  }
});
