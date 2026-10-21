'use strict';

const page = document.getElementById('page');
const base = `/api/guilds/${page.dataset.guild}`;
const form = document.getElementById('tag-form');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  try {
    const result = await api('PUT', `${base}/tag`, {
      text: form.elements.text.value.trim() || null,
      roleId: form.elements.roleId.value || null,
    });
    toast(result.message ?? 'Saved.');
    setTimeout(() => location.reload(), 700);
  } catch (error) {
    toast(error.message, 'err');
    button.disabled = false;
  }
});

document.getElementById('scan').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const result = await api('POST', `${base}/tag/scan`, {});
    toast(result.message ?? 'Scan started.');
  } catch (error) {
    toast(error.message, 'err');
    button.disabled = false;
  }
});
