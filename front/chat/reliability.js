const MAX_OUTBOX = 100;
const MAX_SEEN = 2048;

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
    pending() { return [...outbox.values()]; },
    acceptSequence(sequence) {
      if (!Number.isSafeInteger(sequence) || sequence <= 0 || seen.has(sequence)) return false;
      seen.add(sequence); this.highestServerSeq = Math.max(this.highestServerSeq, sequence);
      if (seen.size > MAX_SEEN) seen.delete(seen.values().next().value);
      return true;
    },
    replaceHistory() { seen.clear(); this.highestServerSeq = 0; },
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

/** Replay only a live session's retained commands after SESSION_READY. */
export function retryPendingCommands(state, send) {
  for (const command of state.pending()) {
    const { delivery, ...wireCommand } = command;
    send(JSON.stringify(wireCommand));
  }
}

/** Replaces (rather than appends) a server snapshot, rendering each sequence once. */
export function reconcileReplay(state, events, resyncRequired, replace, render) {
  if (resyncRequired) { state.replaceHistory(); replace(); }
  // `render` owns sequence admission. This avoids accepting a sequence here
  // and then rejecting the same event in the normal durable-message renderer.
  for (const event of events || []) render(event);
}
