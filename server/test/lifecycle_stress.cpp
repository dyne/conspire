#include "utils/Lifecycle.hpp"

#include <atomic>
#include <cassert>
#include <chrono>
#include <random>
#include <thread>

#ifndef CONSPIRE_STRESS_SEED
#define CONSPIRE_STRESS_SEED 424242
#endif

int main() {
  std::mt19937 random(CONSPIRE_STRESS_SEED);
  std::uniform_int_distribution<int> interval(1, 3);

  // Bounded, deterministic churn models concurrent room/stat worker shutdown.
  // A failure prints the compile-time seed in the test command/configuration.
  for (int round = 0; round < 200; ++round) {
    std::atomic<int> calls{0};
    conspire::lifecycle::PeriodicRunner runner;
    assert(runner.start(std::chrono::milliseconds(interval(random)), [&calls] { ++calls; }));
    std::this_thread::sleep_for(std::chrono::milliseconds(interval(random)));
    runner.stop();
    const auto callsAtStop = calls.load();
    runner.stop();
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
    assert(calls.load() == callsAtStop);
    assert(!runner.running());
    assert(!runner.failed());
  }
}
