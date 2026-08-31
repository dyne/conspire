#ifndef CONSPIRE_CONFIG_VALIDATION_HPP
#define CONSPIRE_CONFIG_VALIDATION_HPP

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

#include "utils/ServerBoundaries.hpp"

namespace conspire::config {

inline std::optional<std::uint16_t> parsePort(std::string_view value) {
  if (value.empty()) return std::nullopt;

  std::uint32_t port = 0;
  for (const char character : value) {
    if (character < '0' || character > '9') return std::nullopt;
    port = port * 10 + static_cast<std::uint32_t>(character - '0');
    if (port > 65535) return std::nullopt;
  }
  return static_cast<std::uint16_t>(port);
}

inline bool validHost(std::string_view host) {
  return conspire::boundaries::validHost(host);
}

inline bool validStatsPath(std::string_view path) {
  return conspire::boundaries::validRelativePath(path) && path.size() <= 128;
}

inline std::string canonicalBaseUrl(std::string_view host, std::uint16_t port, bool useTls) {
  const auto defaultPort = useTls ? 443 : 80;
  std::string url = useTls ? "https://" : "http://";
  url.append(host);
  if (port != defaultPort) {
    url.push_back(':');
    url.append(std::to_string(port));
  }
  return url;
}

inline std::string websocketBaseUrl(std::string_view host, std::uint16_t port, bool useTls) {
  std::string url = useTls ? "wss://" : "ws://";
  url.append(host);
  url.push_back(':');
  url.append(std::to_string(port));
  return url;
}

} // namespace conspire::config

#endif
