export function createChatState() {
  return {
    nextFileId: 1,
    peers: new Map(),
    files: new Map(),
    lastTypingAt: 0,
  };
}
