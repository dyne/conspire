#ifndef ASYNC_SERVER_UTILS_SESSION_RELIABILITY_HPP
#define ASYNC_SERVER_UTILS_SESSION_RELIABILITY_HPP

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <deque>
#include <limits>
#include <optional>
#include <string>
#include <unordered_map>

namespace conspire::session {

using Clock = std::chrono::steady_clock;
constexpr auto gracePeriod = std::chrono::seconds(300);
constexpr auto pendingHelloPeriod = std::chrono::seconds(10);
constexpr std::size_t maxClientMessageIdBytes = 64;
constexpr std::size_t maxDedupeEntries = 1024;

inline bool validBase64UrlId(const std::string& value, std::size_t expectedBytes) {
  const std::size_t encodedBytes = (expectedBytes * 4U + 2U) / 3U;
  if (value.size() != encodedBytes) return false;
  for (const char character : value) {
    const auto c = static_cast<unsigned char>(character);
    if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
          (c >= '0' && c <= '9') || c == '-' || c == '_')) return false;
  }
  return true;
}

inline bool validClientMessageId(const std::string& value) {
  return !value.empty() && value.size() <= maxClientMessageIdBytes &&
         validBase64UrlId(value, 16);
}

class RoomSequencer {
  std::uint64_t m_latest = 0;
public:
  [[nodiscard]] std::optional<std::uint64_t> next() {
    if (m_latest == std::numeric_limits<std::uint64_t>::max()) return std::nullopt;
    return ++m_latest;
  }
  [[nodiscard]] std::uint64_t latest() const { return m_latest; }
  [[nodiscard]] bool advanceTo(std::uint64_t value) {
    if (value < m_latest) return false;
    m_latest = value;
    return true;
  }
};

class DedupeWindow {
  std::unordered_map<std::string, std::uint64_t> m_sequences;
  std::deque<std::string> m_order;
  std::size_t m_limit;
public:
  explicit DedupeWindow(std::size_t limit = maxDedupeEntries) : m_limit(limit) {}
  [[nodiscard]] std::optional<std::uint64_t> find(const std::string& id) const {
    const auto it = m_sequences.find(id);
    return it == m_sequences.end() ? std::nullopt : std::optional<std::uint64_t>(it->second);
  }
  [[nodiscard]] bool remember(const std::string& id, std::uint64_t sequence) {
    if (!validClientMessageId(id) || sequence == 0 || m_limit == 0 || m_sequences.count(id)) return false;
    // Accepted commands remain retryable until session expiry.  Evicting an
    // accepted ID here would allow a delayed retry to repeat its side effect.
    if (m_order.size() >= m_limit) return false;
    m_order.push_back(id);
    m_sequences.emplace(id, sequence);
    return true;
  }
  [[nodiscard]] std::size_t size() const { return m_order.size(); }
  [[nodiscard]] bool full() const { return m_order.size() >= m_limit; }
};

/** Pure monotonic lifecycle used by the transport registry and its tests. */
class SessionLease {
  std::optional<Clock::time_point> m_deadline;
public:
  void detach(Clock::time_point now) { m_deadline = now + gracePeriod; }
  [[nodiscard]] bool disconnected() const { return m_deadline.has_value(); }
  [[nodiscard]] bool canResume(Clock::time_point now) const { return m_deadline && now < *m_deadline; }
  [[nodiscard]] bool expires(Clock::time_point now) const { return m_deadline && now >= *m_deadline; }
  [[nodiscard]] bool resume(Clock::time_point now) {
    if (!canResume(now)) return false;
    m_deadline.reset();
    return true;
  }
};

class PendingHelloLease {
  Clock::time_point m_deadline;
  bool m_consumed = false;
public:
  explicit PendingHelloLease(Clock::time_point created) : m_deadline(created + pendingHelloPeriod) {}
  [[nodiscard]] bool accept(Clock::time_point now) {
    if (m_consumed || now >= m_deadline) return false;
    m_consumed = true;
    return true;
  }
  [[nodiscard]] bool expires(Clock::time_point now) const { return !m_consumed && now >= m_deadline; }
};

/** Generation fence model shared by deterministic stale-transport tests. */
class TransportGeneration {
  const void* m_current = nullptr;
  std::uint64_t m_generation = 0;
public:
  [[nodiscard]] std::uint64_t replace(const void* transport) {
    m_current = transport;
    return ++m_generation;
  }
  [[nodiscard]] bool isCurrent(const void* transport, std::uint64_t generation) const {
    return transport == m_current && generation == m_generation;
  }
  [[nodiscard]] bool detachIfCurrent(const void* transport, std::uint64_t generation) {
    if (!isCurrent(transport, generation)) return false;
    m_current = nullptr;
    return true;
  }
};

} // namespace conspire::session

#endif
