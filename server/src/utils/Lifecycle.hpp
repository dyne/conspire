#ifndef CONSPIRE_UTILS_LIFECYCLE_HPP
#define CONSPIRE_UTILS_LIFECYCLE_HPP

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <fstream>
#include <functional>
#include <mutex>
#include <string>
#include <thread>

#include <unistd.h>

namespace conspire::lifecycle {

// Owns a periodic worker. The callback performs exactly one iteration and is
// never invoked after stop() has joined the worker.
class PeriodicRunner {
private:
  std::atomic<bool> m_stopping{false};
  std::atomic<bool> m_running{false};
  std::atomic<bool> m_failed{false};
  std::mutex m_waitMutex;
  std::condition_variable m_wakeup;
  std::thread m_thread;

public:
  PeriodicRunner() = default;
  PeriodicRunner(const PeriodicRunner&) = delete;
  PeriodicRunner& operator=(const PeriodicRunner&) = delete;

  ~PeriodicRunner() { stop(); }

  bool start(std::chrono::steady_clock::duration interval,
             std::function<void()> iteration) {
    if (m_thread.joinable() || !iteration) return false;
    m_stopping.store(false, std::memory_order_release);
    m_failed.store(false, std::memory_order_release);
    m_running.store(true, std::memory_order_release);
    try {
      m_thread = std::thread([this, interval, iteration = std::move(iteration)]() mutable {
        std::unique_lock<std::mutex> lock(m_waitMutex);
        while (!m_stopping.load(std::memory_order_acquire)) {
          if (m_wakeup.wait_for(lock, interval, [this] {
                return m_stopping.load(std::memory_order_acquire);
              })) {
            break;
          }
          lock.unlock();
          try {
            iteration();
          } catch (...) {
            m_failed.store(true, std::memory_order_release);
            m_stopping.store(true, std::memory_order_release);
          }
          lock.lock();
        }
        m_running.store(false, std::memory_order_release);
      });
    } catch (...) {
      m_running.store(false, std::memory_order_release);
      m_stopping.store(true, std::memory_order_release);
      return false;
    }
    return true;
  }

  void stop() {
    m_stopping.store(true, std::memory_order_release);
    m_wakeup.notify_all();
    if (m_thread.joinable()) m_thread.join();
    m_running.store(false, std::memory_order_release);
  }

  bool running() const { return m_running.load(std::memory_order_acquire); }
  bool failed() const { return m_failed.load(std::memory_order_acquire); }
};

// The PID file owns only a path it created. Its destructor makes both normal
// and early-return cleanup deterministic; signal handlers never touch it.
class PidFile {
private:
  std::string m_path;

public:
  PidFile() = default;
  PidFile(const PidFile&) = delete;
  PidFile& operator=(const PidFile&) = delete;
  ~PidFile() { reset(); }

  bool create(const std::string& path) {
    reset();
    if (path.empty()) return true;
    std::ofstream file(path, std::ios::out | std::ios::trunc);
    if (!file) return false;
    file << getpid() << '\n';
    file.close();
    if (file.fail()) {
      std::remove(path.c_str());
      return false;
    }
    m_path = path;
    return true;
  }

  void reset() noexcept {
    if (!m_path.empty()) {
      std::remove(m_path.c_str());
      m_path.clear();
    }
  }

  bool active() const { return !m_path.empty(); }
};

} // namespace conspire::lifecycle

#endif
