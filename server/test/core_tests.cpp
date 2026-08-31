#include "utils/ConfigValidation.hpp"
#include "utils/ServerBoundaries.hpp"

#include <cassert>
#include <cstdint>
#include <string>
#include <deque>
#include <memory>
#include <unordered_map>

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
  assert(conspire::boundaries::attachmentFilename("a\"\r\nb") == "a___b");
  assert(conspire::boundaries::attachmentFilename("") == "download");
  assert(conspire::boundaries::validFileDescriptor("a", 0, 1));
  assert(!conspire::boundaries::validFileDescriptor("", 0, 1));
  assert(!conspire::boundaries::validFileDescriptor("a", 2, 1));
  assert(coverageFixture(true) == 1);
}
