export const MessageCode = Object.freeze({
  INFO: 0,
  PEER_JOINED: 1,
  PEER_LEFT: 2,
  PEER_MESSAGE: 3,
  PEER_MESSAGE_FILE: 4,
  PEER_IS_TYPING: 5,
  FILE_SHARE: 6,
  FILE_REQUEST_CHUNK: 7,
  FILE_CHUNK_DATA: 8
});

const knownCodes = new Set(Object.values(MessageCode));

export function parseProtocolMessage(payload) {
  if (typeof payload !== 'string' || payload.length > 8192) return null;
  let message;
  try { message = JSON.parse(payload); } catch { return null; }
  if (!message || typeof message !== 'object' || Array.isArray(message) || !knownCodes.has(message.code)) return null;
  return message;
}

export function roomFileUrl(roomUrl, serverFileId) {
  if (typeof roomUrl !== 'string' || !Number.isSafeInteger(serverFileId) || serverFileId < 0) return null;
  return `${roomUrl.replace(/\/$/, '')}/file/${encodeURIComponent(String(serverFileId))}`;
}

export function humanFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`;
}
