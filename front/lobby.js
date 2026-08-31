(() => {
  const openRoom = (room) => window.open(`/room/${encodeURIComponent(room)}`, '_blank', 'noopener,noreferrer');
  const privateRoom = () => crypto.randomUUID ? crypto.randomUUID() : crypto.getRandomValues(new Uint32Array(4)).join('-');
  document.getElementById('public-room-button')?.addEventListener('click', () => openRoom('reception'));
  document.getElementById('private-room-button')?.addEventListener('click', () => openRoom(privateRoom()));
})();
