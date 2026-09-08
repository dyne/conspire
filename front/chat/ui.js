import { handleFiles, submitMessage } from './chat.js';

(() => {
  const panel = document.getElementById('chat_participants');
  const overlay = document.getElementById('participants_overlay');
  const background = [
    document.getElementById('chat_status'),
    document.getElementById('chat_history_wrapper'),
    document.getElementById('chat_input_container'),
  ];
  const toggleButton = document.getElementById('participants_toggle');
  const narrow = () => matchMedia('(max-width: 768px)').matches;
  const closeDrawer = ({ restoreFocus = true } = {}) => {
    if (!panel || !overlay || !toggleButton || !narrow()) return;
    panel.classList.remove('visible');
    overlay.classList.remove('visible');
    panel.setAttribute('aria-hidden', 'true');
    panel.inert = true;
    background.forEach((element) => { if (element) element.inert = false; });
    toggleButton.setAttribute('aria-expanded', 'false');
    if (restoreFocus) toggleButton.focus();
  };
  const openDrawer = () => {
    if (!panel || !overlay || !toggleButton || !narrow()) return;
    panel.classList.add('visible');
    overlay.classList.add('visible');
    panel.setAttribute('aria-hidden', 'false');
    panel.inert = false;
    background.forEach((element) => { if (element) element.inert = true; });
    toggleButton.setAttribute('aria-expanded', 'true');
    panel.querySelector('#participants_heading')?.focus();
  };
  const toggle = () => (panel?.classList.contains('visible') ? closeDrawer() : openDrawer());
  const resetDrawerForViewport = () => {
    if (narrow()) closeDrawer({ restoreFocus: false });
    else if (panel && toggleButton) {
      panel.classList.remove('visible');
      panel.removeAttribute('aria-hidden');
      panel.inert = false;
      background.forEach((element) => { if (element) element.inert = false; });
      toggleButton.setAttribute('aria-expanded', 'false');
    }
  };

  toggleButton?.addEventListener('click', toggle);
  overlay?.addEventListener('click', () => closeDrawer());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && panel?.classList.contains('visible')) closeDrawer();
  });
  matchMedia('(max-width: 768px)').addEventListener('change', resetDrawerForViewport);
  resetDrawerForViewport();
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
