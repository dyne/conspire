/** A generation-safe WebSocket owner.  It deliberately knows no chat details. */
export class ReconnectingTransport {
  constructor({ url, createSocket = (target) => new WebSocket(target), onState = () => {}, onMessage = () => {},
    onInvalidSession = () => {}, random = Math.random,
    setTimer = (...args) => globalThis.setTimeout(...args), clearTimer = (id) => globalThis.clearTimeout(id) }) {
    this.url = url; this.createSocket = createSocket; this.onState = onState; this.onMessage = onMessage;
    this.onInvalidSession = onInvalidSession; this.random = random; this.setTimer = setTimer; this.clearTimer = clearTimer;
    this.state = 'idle'; this.generation = 0; this.attempts = 0; this.socket = null; this.timer = null; this.stopped = false;
  }
  start() { this.stopped = false; this.connect(); }
  stop() { this.stopped = true; this.clearRetry(); this.socket?.close(); this.socket = null; this.setState('stopped'); }
  setState(state, detail) { this.state = state; this.onState(state, detail); }
  clearRetry() { if (this.timer !== null) this.clearTimer(this.timer); this.timer = null; }
  connect() {
    if (this.stopped || this.state === 'connecting' || this.state === 'handshaking') return;
    this.clearRetry(); this.setState('connecting'); const generation = ++this.generation;
    let socket;
    try { socket = this.createSocket(this.url); } catch { this.retry(generation); return; }
    this.socket = socket;
    socket.onopen = () => { if (generation !== this.generation || this.stopped) return; this.setState('handshaking'); this.onOpen?.(); };
    socket.onmessage = (event) => { if (generation === this.generation && !this.stopped) this.onMessage(event.data, generation); };
    socket.onerror = () => {};
    socket.onclose = (event) => { if (generation === this.generation && !this.stopped) this.retry(generation, event); };
  }
  send(value) { if (this.state !== 'online' || !this.socket || this.socket.readyState !== 1) return false; try { this.socket.send(value); return true; } catch { return false; } }
  hello(value) { if (this.state !== 'handshaking' || !this.socket || this.socket.readyState !== 1) return false; try { this.socket.send(value); return true; } catch { return false; } }
  ready() { if (this.stopped) return; this.clearRetry(); this.attempts = 0; this.setState('online'); }
  reconnectNow() {
    if (this.stopped) return;
    this.clearRetry(); ++this.generation;
    const previous = this.socket; this.socket = null;
    try { previous?.close(); } catch {}
    this.setState('idle'); this.connect();
  }
  invalidSession() { this.onInvalidSession(); this.retry(this.generation); }
  retry(generation) {
    if (this.stopped || generation !== this.generation || this.timer !== null) return;
    const cap = Math.min(30_000, 500 * (2 ** this.attempts));
    const delay = Math.floor(this.random() * cap); this.attempts += 1;
    this.setState('backoff', delay);
    this.timer = this.setTimer(() => { this.timer = null; this.connect(); }, delay);
  }
}
