export function humanFileSize(bytes, spin) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  let size = value;
  let unit = -1;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  let result = unit < 0 ? `${size} B` : `${size.toFixed(1)} ${units[unit]}`;
  return result;
}

export function insertTextAtSelection(field, text) {
  const start = Number.isInteger(field.selectionStart) ? field.selectionStart : field.value.length;
  const end = Number.isInteger(field.selectionEnd) ? field.selectionEnd : start;
  field.setRangeText(text, start, end, 'end');
}

export function formatChatAnnouncement(type, details = {}) {
  const name = details.peerName || 'A participant';
  if (type === 'message') return `${name} said: ${details.message || ''}`.trim();
  if (type === 'joined') return `${name} joined the room.`;
  if (type === 'left') return `${name} left the room.`;
  if (type === 'typing') return `${name} is typing.`;
  if (type === 'stoppedTyping') return `${name} stopped typing.`;
  if (type === 'file') return `${name} shared ${details.count === 1 ? 'a file' : `${details.count || 0} files`}.`;
  if (type === 'transfer') return `File transfer progress: ${details.progress || 'updated'}.`;
  return details.message || '';
}
