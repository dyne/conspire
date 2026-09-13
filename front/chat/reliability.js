const MAX_OUTBOX = 100;
const MAX_SEEN = 2048;
const MAX_HANDSHAKE_INBOX = 256;

export function randomId(cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.getRandomValues) return null;
  const bytes = new Uint8Array(16); cryptoApi.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function createReliabilityState() {
  const outbox = new Map(); const abandoned = []; const seen = new Set();
  return {
    outbox, highestServerSeq: 0,
    enqueue(command) { if (outbox.size >= MAX_OUTBOX) return false; outbox.set(command.clientMessageId, command); return true; },
    acknowledge(id) { const command = outbox.get(id); if (command) command.delivery = 'sent'; outbox.delete(id); return command; },
    reject(id) {
      const command = outbox.get(id);
      if (!command) return null;
      command.delivery = 'not sent; retry manually';
      outbox.delete(id); abandoned.push(command);
      return command;
    },
    pending() { return [...outbox.values()]; },
    restoreCursor(sequence) {
      if (seen.size === 0 && this.highestServerSeq === 0 &&
          Number.isSafeInteger(sequence) && sequence > 0) this.highestServerSeq = sequence;
    },
    resetSequence() { seen.clear(); this.highestServerSeq = 0; },
    acceptSequence(sequence) {
      if (!Number.isSafeInteger(sequence) || sequence <= this.highestServerSeq || seen.has(sequence)) return false;
      if (seen.size >= MAX_SEEN && sequence !== this.highestServerSeq + 1) return false;
      seen.add(sequence);
      while (seen.delete(this.highestServerSeq + 1)) this.highestServerSeq += 1;
      return true;
    },
    replaceHistory(events = [], latestServerSeq = 0) {
      this.resetSequence();
      const sequences = events.map((event) => event?.serverSeq).filter(
        (sequence) => Number.isSafeInteger(sequence) && sequence > 0);
      this.highestServerSeq = sequences.length > 0
        ? Math.min(...sequences) - 1
        : (Number.isSafeInteger(latestServerSeq) && latestServerSeq > 0 ? latestServerSeq : 0);
    },
    abandon() {
      for (const command of outbox.values()) {
        command.delivery = 'not sent; retry manually';
        abandoned.push(command);
      }
      outbox.clear();
      return abandoned;
    },
    manualRetryOnly() { return [...abandoned]; },
  };
}

/** Holds frames that race ahead of SESSION_READY until its snapshot is applied. */
export function createHandshakeInbox(maxMessages = MAX_HANDSHAKE_INBOX) {
  const messages = [];
  return {
    push(message) {
      if (messages.length >= maxMessages) return false;
      messages.push(message);
      return true;
    },
    drain(handle) {
      const ready = messages.splice(0);
      for (const message of ready) handle(message);
    },
    clear() { messages.length = 0; },
    size() { return messages.length; },
  };
}

/** Replay only a live session's retained commands after SESSION_READY. */
export function retryPendingCommands(state, send) {
  for (const command of state.pending()) {
    const { delivery, ...wireCommand } = command;
    send(JSON.stringify(wireCommand));
  }
}

/** Replaces (rather than appends) a server snapshot, rendering each sequence once. */
export function reconcileReplay(state, events, resyncRequired, replace, render, latestServerSeq = 0) {
  if (resyncRequired) { state.replaceHistory(events || [], latestServerSeq); replace(); }
  // `render` owns sequence admission. This avoids accepting a sequence here
  // and then rejecting the same event in the normal durable-message renderer.
  for (const event of events || []) render(event);
}
