#ifndef CONSPIRE_ROOMS_HEARTBEAT_HPP
#define CONSPIRE_ROOMS_HEARTBEAT_HPP

#include <chrono>
#include <cstdint>

// No executor or websocket dependency: callers supply a monotonic clock.
class Heartbeat {
public:
  using Clock = std::chrono::steady_clock;
  using TimePoint = Clock::time_point;
  enum class Tick { NONE, QUEUE_PING, EXPIRED };
  static constexpr auto probeInterval = std::chrono::seconds(30);
  static constexpr auto deadline = std::chrono::seconds(120);

  explicit Heartbeat(TimePoint now, std::uint64_t generation = 1)
    : m_lastInbound(now), m_lastProbe(now), m_generation(generation) {}
  void activate(TimePoint now, std::uint64_t generation) {
    m_lastInbound = m_lastProbe = now; m_generation = generation;
    m_pingQueued = m_pingOutstanding = false;
  }
  Tick tick(TimePoint now) {
    if (now - m_lastInbound >= deadline) return Tick::EXPIRED;
    if (m_pingQueued || m_pingOutstanding || now - m_lastProbe < probeInterval) return Tick::NONE;
    m_pingQueued = true; m_lastProbe = now; return Tick::QUEUE_PING;
  }
  bool writeCompleted(std::uint64_t generation, bool success) {
    if (generation != m_generation || !m_pingQueued) return false;
    m_pingQueued = false; m_pingOutstanding = success; return true;
  }
  bool inbound(TimePoint now, std::uint64_t generation) {
    if (generation != m_generation) return false;
    m_lastInbound = now; m_pingQueued = m_pingOutstanding = false; return true;
  }
  std::uint64_t generation() const { return m_generation; }
  bool pingQueued() const { return m_pingQueued; }
  bool pingOutstanding() const { return m_pingOutstanding; }
  std::int64_t idleMilliseconds(TimePoint now) const {
    return std::chrono::duration_cast<std::chrono::milliseconds>(now - m_lastInbound).count();
  }
private:
  TimePoint m_lastInbound, m_lastProbe;
  std::uint64_t m_generation;
  bool m_pingQueued = false, m_pingOutstanding = false;
};

// The first terminal cause owns the one cumulative transport-close event.
class TerminalCloseAccounting {
public:
  bool accountOnce() {
    if (m_accounted) return false;
    m_accounted = true;
    return true;
  }
private:
  bool m_accounted = false;
};
#endif
