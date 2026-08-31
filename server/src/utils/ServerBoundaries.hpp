#ifndef CONSPIRE_SERVER_BOUNDARIES_HPP
#define CONSPIRE_SERVER_BOUNDARIES_HPP

#include <cstddef>
#include <string>
#include <string_view>

namespace conspire::boundaries {

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
  for (const char character : filename) {
    result.push_back(character == '"' || character == '\r' || character == '\n' ? '_' : character);
  }
  return result.empty() ? "download" : result;
}

inline bool validFileDescriptor(std::string_view filename, std::size_t size, std::size_t maximumSize) {
  return !filename.empty() && filename.size() <= 255 && size <= maximumSize;
}

} // namespace conspire::boundaries

#endif
