'use strict';

const page = document.getElementById('page');
const base = `/api/guilds/${page.dataset.guild}`;

document.getElementById('giveaway-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  try {
    await api('POST', `${base}/giveaways`, {
      channelId: String(data.get('channelId')),
      prize: String(data.get('prize')),
      winnerCount: Number(data.get('winnerCount')),
      durationMinutes: Number(data.get('durationMinutes')),
    });
    toast('Giveaway started!');
    setTimeout(() => location.reload(), 700);
  } catch (error) {
    toast(error.message, 'err');
    button.disabled = false;
  }
});

document.querySelectorAll('[data-giveaway-delete]').forEach((button) => {
  button.addEventListener('click', async () => {
    if (!(await confirmDialog('Delete this giveaway? Active giveaways will be cancelled.'))) return;
    try {
      await api('DELETE', `${base}/giveaways`, { id: button.dataset.giveawayDelete });
      button.closest('tr')?.remove();
      toast('Giveaway deleted.');
    } catch (error) {
      toast(error.message, 'err');
    }
  });
});
