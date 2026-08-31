import { handleFiles, submitMessage } from './chat.js';

(() => {
  const panel = document.getElementById('chat_participants');
  const overlay = document.getElementById('participants_overlay');
  const toggle = () => {
    panel?.classList.toggle('visible');
    overlay?.classList.toggle('visible');
  };

  document.getElementById('participants_toggle')?.addEventListener('click', toggle);
  overlay?.addEventListener('click', toggle);
  document.getElementById('send_button')?.addEventListener('click', submitMessage);
  document.forms.publish?.addEventListener('submit', (event) => { event.preventDefault(); submitMessage(); });
  document.getElementById('file_share_button_overlay')?.addEventListener('click', () => document.getElementById('file_share_button')?.click());
  document.getElementById('file_share_button')?.addEventListener('change', (event) => handleFiles(event.target.files));

  const count = document.getElementById('participant_count');
  if (panel && count) {
    const updateCount = () => { count.textContent = panel.querySelectorAll('.participant:not(.participant_deleted)').length; };
    new MutationObserver(updateCount).observe(panel, { childList: true, subtree: true });
    updateCount();
  }
})();
