#include "utils/ConfigValidation.hpp"
#include "utils/ServerBoundaries.hpp"
#include "utils/Lifecycle.hpp"
#include "rooms/Heartbeat.hpp"
#include "utils/SessionReliability.hpp"

#include <cassert>
#include <cstdint>
#include <limits>
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
  using HeartbeatClock = Heartbeat::Clock;
  const auto heartbeatStart = HeartbeatClock::time_point{};
  Heartbeat heartbeat(heartbeatStart, 7);
  TerminalCloseAccounting closeAccounting;
  assert(closeAccounting.accountOnce()); // protocol error records a classified close
  assert(!closeAccounting.accountOnce()); // later onClose/invalidation cannot double count
  assert(heartbeat.tick(heartbeatStart + std::chrono::milliseconds(29999)) == Heartbeat::Tick::NONE);
  assert(heartbeat.tick(heartbeatStart + std::chrono::seconds(30)) == Heartbeat::Tick::QUEUE_PING);
  assert(heartbeat.pingQueued());
  assert(heartbeat.tick(heartbeatStart + std::chrono::seconds(60)) == Heartbeat::Tick::NONE);
  assert(!heartbeat.writeCompleted(8, true));
  assert(heartbeat.writeCompleted(7, true));
  assert(heartbeat.pingOutstanding());
  assert(heartbeat.tick(heartbeatStart + std::chrono::milliseconds(119999)) == Heartbeat::Tick::NONE);
  assert(heartbeat.tick(heartbeatStart + std::chrono::milliseconds(120000)) == Heartbeat::Tick::EXPIRED);
  heartbeat.activate(heartbeatStart, 9);
  assert(heartbeat.tick(heartbeatStart + std::chrono::seconds(30)) == Heartbeat::Tick::QUEUE_PING);
  assert(heartbeat.tick(heartbeatStart + std::chrono::milliseconds(120000)) == Heartbeat::Tick::EXPIRED);
  heartbeat.activate(heartbeatStart, 10);
  assert(heartbeat.inbound(heartbeatStart + std::chrono::seconds(119), 10));
  assert(heartbeat.tick(heartbeatStart + std::chrono::seconds(120)) == Heartbeat::Tick::QUEUE_PING);
  assert(heartbeat.tick(heartbeatStart + std::chrono::milliseconds(238999)) == Heartbeat::Tick::NONE);
  assert(heartbeat.tick(heartbeatStart + std::chrono::seconds(239)) == Heartbeat::Tick::EXPIRED);
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
  assert(conspire::config::validStateFilePath("/var/lib/conspire/stats.json"));
  assert(conspire::config::validStateFilePath("relative stats.json"));
  assert(!conspire::config::validStateFilePath(""));
  assert(!conspire::config::validStateFilePath("stats\n.json"));
  assert(conspire::config::validLoopbackHost("127.0.0.1"));
  assert(conspire::config::validLoopbackHost("::1"));
  assert(conspire::config::validLoopbackHost("localhost"));
  assert(!conspire::config::validLoopbackHost("control.example"));
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
  assert(conspire::boundaries::validFileDescriptor("generic-large.bin", 9 * 1024 * 1024));
  assert(conspire::boundaries::validImageMediaType("image/jpeg"));
  assert(conspire::boundaries::validImageMediaType("image/png"));
  assert(conspire::boundaries::validImageMediaType("image/webp"));
  assert(!conspire::boundaries::validImageMediaType("image/gif"));
  assert(!conspire::boundaries::validImageMediaType("IMAGE/PNG"));
  assert(!conspire::boundaries::validImageMediaType(std::string(33, 'a')));
  assert(!conspire::boundaries::validImageMediaType("image/\xC3\xA9"));
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
  assert(conspire::boundaries::hasCapacityFor(20, 12, 32));
  assert(!conspire::boundaries::hasCapacityFor(20, 13, 32));
  assert(!conspire::boundaries::hasCapacityFor(33, 0, 32));
  assert(conspire::boundaries::Limits::chunkBytes == 64 * 1024);
  conspire::boundaries::ChunkRequest chunkRequest;
  using ChunkResult = conspire::boundaries::ChunkRequest::Result;
  assert(chunkRequest.accept(1, 0, 3, 3) == ChunkResult::INVALID);
  const auto firstRequest = chunkRequest.begin(4, 3);
  assert(firstRequest != 0);
  assert(chunkRequest.begin(4, 3) == firstRequest);
  assert(chunkRequest.accept(firstRequest, 0, 3, 3) == ChunkResult::INVALID);
  assert(chunkRequest.accept(firstRequest, 4, 2, 2) == ChunkResult::INVALID);
  assert(chunkRequest.accept(firstRequest, 4, 3, 2) == ChunkResult::INVALID);
  assert(chunkRequest.accept(firstRequest, 4, 3, 3) == ChunkResult::ACCEPTED);
  assert(chunkRequest.accept(firstRequest, 4, 3, 3) == ChunkResult::DUPLICATE);
  assert(chunkRequest.accept(firstRequest + 1, 4, 3, 3) == ChunkResult::INVALID);
  const auto secondRequest = chunkRequest.begin(7, 1);
  assert(secondRequest != firstRequest);
  assert(chunkRequest.accept(firstRequest, 4, 3, 3) == ChunkResult::DUPLICATE);
  assert(chunkRequest.outstanding());
  assert(chunkRequest.accept(secondRequest, 7, 1, 1) == ChunkResult::ACCEPTED);
  const auto thirdRequest = chunkRequest.begin(8, 1);
  assert(chunkRequest.accept(firstRequest, 4, 2, 2) == ChunkResult::INVALID);
  chunkRequest.cancel();
  assert(chunkRequest.accept(thirdRequest, 8, 1, 1) == ChunkResult::INVALID);
  assert(conspire::boundaries::urlPathSegment("a b/\"") == "a%20b%2F%22");
  assert(conspire::boundaries::javascriptString("</script>\"\\\n") == "\"\\u003C/script\\u003E\\\"\\\\\\n\"");
  assert(conspire::boundaries::htmlText("1<&\"'") == "1&lt;&amp;&quot;&#39;");
  assert(conspire::boundaries::pageTitle("1.2.3") == "Conspire v1.2.3 by Dyne.org");
  assert(conspire::boundaries::pageTitle("v1.2.3") == "Conspire v1.2.3 by Dyne.org");
  std::string page = "<title>%%%CONSPIRE_TITLE%%%</title><p>%%%CONSPIRE_TITLE%%%</p>";
  assert(conspire::boundaries::replaceLiteral(page, "%%%CONSPIRE_TITLE%%%",
                                               conspire::boundaries::pageTitle("1.2.3")));
  assert(page == "<title>Conspire v1.2.3 by Dyne.org</title>"
                 "<p>Conspire v1.2.3 by Dyne.org</p>");
  assert(!conspire::boundaries::replaceLiteral(page, "%%%MISSING%%%", "unused"));
  assert(coverageFixture(true) == 1);

  using conspire::session::DedupeWindow;
  using conspire::session::RoomSequencer;
  const std::string messageId = "AAAAAAAAAAAAAAAAAAAAAA";
  assert(conspire::session::validBase64UrlId(messageId, 16));
  assert(conspire::session::validClientMessageId(messageId));
  assert(!conspire::session::validClientMessageId("not-a-128-bit-id"));
  assert(!conspire::session::validClientMessageId(std::string(65, 'A')));
  RoomSequencer sequencer;
  assert(sequencer.next() == 1);
  assert(sequencer.next() == 2);
  assert(!sequencer.advanceTo(1));
  assert(sequencer.advanceTo(9));
  assert(sequencer.latest() == 9);
  assert(!conspire::session::requiresReplayResync(0, 0, std::nullopt));
  assert(conspire::session::requiresReplayResync(3, 5, std::nullopt));
  assert(!conspire::session::requiresReplayResync(5, 5, std::nullopt));
  assert(conspire::session::requiresReplayResync(6, 5, std::nullopt));
  assert(conspire::session::requiresReplayResync(2, 7, 4));
  assert(!conspire::session::requiresReplayResync(3, 7, 4));
  assert(sequencer.advanceTo(std::numeric_limits<std::uint64_t>::max()));
  assert(!sequencer.next());
  DedupeWindow dedupe(2);
  assert(dedupe.remember(messageId, 9));
  assert(dedupe.find(messageId) == 9);
  assert(!dedupe.remember(messageId, 10));
  const std::string secondId = "BBBBBBBBBBBBBBBBBBBBBB";
  const std::string thirdId = "CCCCCCCCCCCCCCCCCCCCCC";
  assert(dedupe.remember(secondId, 10));
  assert(!dedupe.remember(thirdId, 11)); // capacity rejects; accepted IDs persist
  assert(dedupe.find(messageId) == 9);
  assert(dedupe.find(secondId) == 10);
  assert(!dedupe.find(thirdId));

  const auto sessionStart = conspire::session::Clock::time_point{};
  conspire::session::SessionLease lease;
  lease.detach(sessionStart);
  assert(lease.disconnected());
  assert(lease.canResume(sessionStart + std::chrono::milliseconds(299999)));
  assert(lease.resume(sessionStart + std::chrono::milliseconds(299999)));
  assert(!lease.disconnected());
  lease.detach(sessionStart);
  assert(!lease.canResume(sessionStart + std::chrono::seconds(300)));
  assert(lease.expires(sessionStart + std::chrono::seconds(300)));
  assert(!lease.resume(sessionStart + std::chrono::seconds(300)));
  conspire::session::PendingHelloLease pendingHello(sessionStart);
  assert(pendingHello.accept(sessionStart + std::chrono::seconds(9)));
  assert(!pendingHello.accept(sessionStart + std::chrono::seconds(9)));
  conspire::session::PendingHelloLease expiredHello(sessionStart);
  assert(!expiredHello.accept(sessionStart + std::chrono::seconds(10)));
  assert(expiredHello.expires(sessionStart + std::chrono::seconds(10)));
  // Deterministic old-socket destruction after a replacement must be a no-op.
  int oldSocket = 0;
  int replacementSocket = 0;
  conspire::session::TransportGeneration transport;
  const auto oldGeneration = transport.replace(&oldSocket);
  const auto replacementGeneration = transport.replace(&replacementSocket);
  assert(!transport.detachIfCurrent(&oldSocket, oldGeneration));
  assert(transport.isCurrent(&replacementSocket, replacementGeneration));
  assert(!transport.isCurrent(&oldSocket, oldGeneration));
  assert(transport.detachIfCurrent(&replacementSocket, replacementGeneration));

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
