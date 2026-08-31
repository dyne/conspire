#ifndef CONSPIRE_SERVER_BOUNDARIES_HPP
#define CONSPIRE_SERVER_BOUNDARIES_HPP

#include <cstddef>
#include <cstdint>
#include <limits>
#include <string>
#include <string_view>

namespace conspire::boundaries {

/** Limits for values controlled by HTTP or websocket clients. */
struct Limits {
  static constexpr std::size_t roomId = 64;
  static constexpr std::size_t message = 8 * 1024;
  static constexpr std::size_t filename = 255;
  static constexpr std::size_t filesPerMessage = 16;
  static constexpr std::size_t fileBytes = 100 * 1024 * 1024;
  static constexpr std::size_t chunkBytes = 64 * 1024;
  static constexpr std::size_t rooms = 256;
  static constexpr std::size_t peersPerRoom = 64;
  static constexpr std::size_t filesPerPeer = 32;
  static constexpr std::size_t subscribersPerFile = 32;
};

inline bool hasCapacity(std::size_t current, std::size_t maximum) {
  return maximum != 0 && current < maximum;
}

inline bool containsControl(std::string_view value) {
  for (const char rawCharacter : value) {
    const auto character = static_cast<unsigned char>(rawCharacter);
    if (character < 0x20 || character == 0x7f) return true;
  }
  return false;
}

inline bool validRoomId(std::string_view value) {
  if (value.empty() || value.size() > Limits::roomId) return false;
  for (const char rawCharacter : value) {
    const auto character = static_cast<unsigned char>(rawCharacter);
    if (!((character >= 'a' && character <= 'z') ||
          (character >= 'A' && character <= 'Z') ||
          (character >= '0' && character <= '9') ||
          character == '-' || character == '_')) return false;
  }
  return true;
}

inline bool validMessageContent(std::string_view value) {
  return value.size() <= Limits::message && !containsControl(value);
}

inline bool validFileDescriptor(std::string_view filename, std::int64_t size,
                                std::size_t maximumSize = Limits::fileBytes) {
  return !filename.empty() && filename.size() <= Limits::filename &&
         !containsControl(filename) && size >= 0 &&
         static_cast<std::uint64_t>(size) <= maximumSize;
}

inline bool validChunk(std::int64_t position, std::int64_t declaredSize,
                       std::size_t receivedSize, std::int64_t totalSize) {
  if (position < 0 || declaredSize < 0 || totalSize < 0 ||
      receivedSize > Limits::chunkBytes ||
      static_cast<std::uint64_t>(declaredSize) != receivedSize) return false;
  const auto start = static_cast<std::uint64_t>(position);
  const auto size = static_cast<std::uint64_t>(declaredSize);
  const auto total = static_cast<std::uint64_t>(totalSize);
  return start <= total && size <= total - start;
}

inline bool validHost(std::string_view value) {
  if (value.empty() || value.size() > 255 || containsControl(value)) return false;
  for (const char rawCharacter : value) {
    const auto character = static_cast<unsigned char>(rawCharacter);
    if (!((character >= 'a' && character <= 'z') ||
          (character >= 'A' && character <= 'Z') ||
          (character >= '0' && character <= '9') || character == '.' ||
          character == '-' || character == ':' || character == '[' || character == ']')) return false;
  }
  return true;
}

inline bool validRelativePath(std::string_view value) {
  return !value.empty() && value.front() != '/' && value.find("..") == std::string_view::npos &&
         value.find('?') == std::string_view::npos && value.find('#') == std::string_view::npos &&
         !containsControl(value);
}

inline bool validRequestPath(std::string_view value) {
  return !value.empty() && value.front() == '/' && value.find("//") != 0 &&
         value.find("..") == std::string_view::npos && !containsControl(value);
}

inline bool allowedOrigin(std::string_view origin, std::string_view canonicalOrigin,
                          bool allowLocalDevelopmentOrigin = false) {
  if (origin == canonicalOrigin) return true;
  if (!allowLocalDevelopmentOrigin) return false;
  return origin == "http://localhost" || origin == "http://127.0.0.1" ||
         origin == "http://[::1]";
}

inline std::string urlPathSegment(std::string_view value) {
  static constexpr char hex[] = "0123456789ABCDEF";
  std::string result;
  result.reserve(value.size() * 3);
  for (const char rawCharacter : value) {
    const auto character = static_cast<unsigned char>(rawCharacter);
    if ((character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') ||
        (character >= '0' && character <= '9') || character == '-' || character == '_' || character == '.') {
      result.push_back(static_cast<char>(character));
    } else {
      result.push_back('%'); result.push_back(hex[character >> 4]); result.push_back(hex[character & 0x0f]);
    }
  }
  return result;
}

inline std::string javascriptString(std::string_view value) {
  std::string result;
  result.reserve(value.size() + 2);
  result.push_back('"');
  for (const char rawCharacter : value) {
    const auto character = static_cast<unsigned char>(rawCharacter);
    switch (character) {
      case '\\': result += "\\\\"; break;
      case '"': result += "\\\""; break;
      case '\n': result += "\\n"; break;
      case '\r': result += "\\r"; break;
      case '\t': result += "\\t"; break;
      case '<': result += "\\u003C"; break;
      case '>': result += "\\u003E"; break;
      default:
        if (character < 0x20 || character == 0x7f) { result += "\\u00"; result += "0123456789ABCDEF"[character >> 4]; result += "0123456789ABCDEF"[character & 0x0f]; }
        else result.push_back(static_cast<char>(character));
    }
  }
  result.push_back('"');
  return result;
}

template <typename Collection>
void retainLast(Collection& values, std::size_t maximum) {
  while (values.size() > maximum) values.pop_front();
}

template <typename Map, typename Id>
auto findById(const Map& values, const Id& id) -> typename Map::mapped_type {
  const auto found = values.find(id);
  return found == values.end() ? nullptr : found->second;
}

inline std::string attachmentFilename(std::string_view filename) {
  std::string result;
  result.reserve(filename.size());
  for (const char rawCharacter : filename) {
    const auto character = static_cast<unsigned char>(rawCharacter);
    // HTTP quoted-string only permits visible ASCII excluding DQUOTE and backslash.
    result.push_back(character < 0x20 || character >= 0x7f || character == '"' ||
                     character == '\\' ? '_' : static_cast<char>(character));
  }
  return result.empty() ? "download" : result;
}

} // namespace conspire::boundaries

#endif
