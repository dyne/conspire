#include "utils/ConfigValidation.hpp"
#include "utils/ServerBoundaries.hpp"
#include "utils/Lifecycle.hpp"

#include <cassert>
#include <cstdint>
#include <string>
#include <deque>
#include <memory>
#include <unordered_map>
#include <atomic>
#include <chrono>
#include <filesystem>
#include <thread>

int coverageFixture(bool includeOptionalPath);

int main() {
  using conspire::config::canonicalBaseUrl;
  using conspire::config::parsePort;
  using conspire::config::websocketBaseUrl;

  assert(!parsePort(""));
  assert(!parsePort("-1"));
  assert(!parsePort("65536"));
  assert(!parsePort("42x"));
  assert(parsePort("0") == std::uint16_t{0});
  assert(parsePort("65535") == std::uint16_t{65535});
  assert(parsePort("00080") == std::uint16_t{80});

  assert(canonicalBaseUrl("example.test", 443, true) == "https://example.test");
  assert(canonicalBaseUrl("example.test", 8443, true) == "https://example.test:8443");
  assert(canonicalBaseUrl("example.test", 80, false) == "http://example.test");
  assert(websocketBaseUrl("example.test", 443, true) == "wss://example.test:443");
  assert(websocketBaseUrl("example.test", 80, false) == "ws://example.test:80");
  assert(conspire::config::validHost("example.test:8443"));
  assert(!conspire::config::validHost("example.test\r\nInjected: yes"));
  assert(!conspire::config::validHost("evil/path"));
  assert(conspire::config::validStatsPath("admin/stats.json"));
  assert(!conspire::config::validStatsPath("../stats.json"));
  assert(!conspire::config::validStatsPath("/stats.json"));
  assert(conspire::boundaries::validRequestPath("/room/one"));
  assert(!conspire::boundaries::validRequestPath("//evil.test"));
  assert(!conspire::boundaries::validRequestPath("/room\r\none"));
  assert(conspire::boundaries::allowedOrigin("https://example.test", "https://example.test"));
  assert(!conspire::boundaries::allowedOrigin("https://evil.test", "https://example.test"));
  assert(conspire::boundaries::allowedOrigin("http://localhost", "https://example.test", true));

  std::deque<int> history{1, 2, 3, 4};
  conspire::boundaries::retainLast(history, 2);
  assert((history == std::deque<int>{3, 4}));
  conspire::boundaries::retainLast(history, 0);
  assert(history.empty());

  std::unordered_map<std::int64_t, std::shared_ptr<int>> entries;
  entries.emplace(7, std::make_shared<int>(9));
  assert(*conspire::boundaries::findById(entries, std::int64_t{7}) == 9);
  assert(!conspire::boundaries::findById(entries, std::int64_t{8}));

  assert(conspire::boundaries::attachmentFilename("report.txt") == "report.txt");
  assert(conspire::boundaries::attachmentFilename("a\"\\\r\nb\xC3\xA9") == "a____b__");
  assert(conspire::boundaries::attachmentFilename("") == "download");
  assert(conspire::boundaries::validFileDescriptor("a", 0, 1));
  assert(!conspire::boundaries::validFileDescriptor("", 0, 1));
  assert(!conspire::boundaries::validFileDescriptor("a", 2, 1));
  assert(!conspire::boundaries::validFileDescriptor("a\n", 0));
  assert(!conspire::boundaries::validFileDescriptor("a", -1));
  assert(conspire::boundaries::validRoomId("room_42-A"));
  assert(!conspire::boundaries::validRoomId("room/42"));
  assert(!conspire::boundaries::validRoomId("room\n42"));
  assert(!conspire::boundaries::validRoomId(std::string(65, 'a')));
  assert(conspire::boundaries::validMessageContent("plain text"));
  assert(!conspire::boundaries::validMessageContent("line\nfeed"));
  assert(!conspire::boundaries::validMessageContent(std::string(8193, 'a')));
  assert(conspire::boundaries::validChunk(0, 3, 3, 3));
  assert(!conspire::boundaries::validChunk(-1, 3, 3, 3));
  assert(!conspire::boundaries::validChunk(2, 2, 2, 3));
  assert(!conspire::boundaries::validChunk(0, 4, 3, 4));
  assert(conspire::boundaries::hasCapacity(31, 32));
  assert(!conspire::boundaries::hasCapacity(32, 32));
  assert(!conspire::boundaries::hasCapacity(0, 0));
  assert(conspire::boundaries::Limits::chunkBytes == 64 * 1024);
  conspire::boundaries::ChunkRequest chunkRequest;
  assert(!chunkRequest.accept(0, 3, 3));
  chunkRequest.begin(4, 3);
  assert(!chunkRequest.accept(0, 3, 3));
  assert(!chunkRequest.accept(4, 2, 2));
  assert(!chunkRequest.accept(4, 3, 2));
  assert(chunkRequest.accept(4, 3, 3));
  assert(!chunkRequest.accept(4, 3, 3));
  chunkRequest.begin(7, 1);
  chunkRequest.cancel();
  assert(!chunkRequest.accept(7, 1, 1));
  assert(conspire::boundaries::urlPathSegment("a b/\"") == "a%20b%2F%22");
  assert(conspire::boundaries::javascriptString("</script>\"\\\n") == "\"\\u003C/script\\u003E\\\"\\\\\\n\"");
  assert(coverageFixture(true) == 1);

  std::atomic<int> iterations{0};
  conspire::lifecycle::PeriodicRunner runner;
  assert(runner.start(std::chrono::milliseconds(1), [&iterations] { ++iterations; }));
  assert(!runner.start(std::chrono::milliseconds(1), [] {}));
  std::this_thread::sleep_for(std::chrono::milliseconds(10));
  runner.stop();
  const auto stoppedAt = iterations.load();
  runner.stop();
  std::this_thread::sleep_for(std::chrono::milliseconds(3));
  assert(iterations.load() == stoppedAt);
  assert(!runner.running());

  conspire::lifecycle::PeriodicRunner failingRunner;
  assert(failingRunner.start(std::chrono::milliseconds(1), [] { throw std::runtime_error("startup failure"); }));
  std::this_thread::sleep_for(std::chrono::milliseconds(10));
  failingRunner.stop();
  assert(failingRunner.failed());

  const auto pidPath = (std::filesystem::temp_directory_path() / "conspire-core-test.pid").string();
  std::filesystem::remove(pidPath);
  {
    conspire::lifecycle::PidFile pidFile;
    assert(pidFile.create(pidPath));
    assert(pidFile.active());
    assert(std::filesystem::exists(pidPath));
  }
  assert(!std::filesystem::exists(pidPath));
}
