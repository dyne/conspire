/***************************************************************************
 *
 * Project:   ______                ______ _
 *           / _____)              / _____) |          _
 *          | /      ____ ____ ___| /     | | _   ____| |_
 *          | |     / _  |  _ (___) |     | || \ / _  |  _)
 *          | \____( ( | | | | |  | \_____| | | ( ( | | |__
 *           \______)_||_|_| |_|   \______)_| |_|\_||_|\___)
 *
 *
 * Copyright 2020-present, Leonid Stryzhevskyi <lganzzzo@gmail.com>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 ***************************************************************************/

#include "Statistics.hpp"

#include <cerrno>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <string_view>
#include <vector>

#include <fcntl.h>
#include <unistd.h>

namespace {

constexpr std::size_t MAX_STATE_BYTES = 1024 * 1024;
constexpr std::size_t MAX_STATE_POINTS = 1000;

bool validPoint(const oatpp::Object<StatPointDto>& point) {
  return point && point->timestamp && point->evFrontpageLoaded &&
         point->evPeerConnected && point->evPeerDisconnected &&
         point->evPeerZombieDropped && point->evPeerSendMessage &&
         point->evPeerShareFile && point->evRoomCreated &&
         point->evRoomDeleted && point->fileServedBytes &&
         *point->timestamp > 0;
}

bool writeAll(int descriptor, std::string_view data) {
  std::size_t written = 0;
  while (written < data.size()) {
    const auto result = ::write(descriptor, data.data() + written, data.size() - written);
    if (result < 0) {
      if (errno == EINTR) continue;
      return false;
    }
    if (result == 0) return false;
    written += static_cast<std::size_t>(result);
  }
  return true;
}

bool writeAtomically(const std::string& path, std::string_view data) {
  std::vector<char> temporary(path.begin(), path.end());
  constexpr std::string_view suffix = ".tmp.XXXXXX";
  temporary.insert(temporary.end(), suffix.begin(), suffix.end());
  temporary.push_back('\0');

  const int descriptor = ::mkstemp(temporary.data());
  if (descriptor < 0) return false;

  bool success = writeAll(descriptor, data);
  if (success && ::fsync(descriptor) != 0) success = false;
  if (::close(descriptor) != 0) success = false;
  if (success && ::rename(temporary.data(), path.c_str()) != 0) success = false;
  if (success) {
    const auto parent = std::filesystem::path(path).parent_path();
    const auto directory = parent.empty() ? std::filesystem::path(".") : parent;
    const int directoryDescriptor = ::open(directory.c_str(), O_RDONLY | O_DIRECTORY);
    if (directoryDescriptor < 0 || ::fsync(directoryDescriptor) != 0) success = false;
    if (directoryDescriptor >= 0 && ::close(directoryDescriptor) != 0) success = false;
  }
  if (!success) ::unlink(temporary.data());
  return success;
}

} // namespace

void Statistics::takeSample() {

  auto maxPeriodMicro = m_maxPeriod.count();
  auto pushIntervalMicro = m_pushInterval.count();

  std::lock_guard<std::mutex> guard(m_dataLock);

  auto nowMicro = oatpp::Environment::getMicroTickCount();

  oatpp::Object<StatPointDto> point;

  if (m_dataPoints->size() > 0) {
    const auto& p = m_dataPoints->back();
    if(nowMicro - *p->timestamp < pushIntervalMicro) {
      point = p;
    }
  }

  if (!point) {

    point = StatPointDto::createShared();
    point->timestamp = nowMicro;

    m_dataPoints->push_back(point);

    auto diffMicro = nowMicro - *m_dataPoints->front()->timestamp;
    while(diffMicro > maxPeriodMicro) {
      m_dataPoints->pop_front();
      diffMicro = nowMicro - *m_dataPoints->front()->timestamp;
    }

  }

  point->evFrontpageLoaded = EVENT_FRONT_PAGE_LOADED.load();

  point->evPeerConnected = EVENT_PEER_CONNECTED.load();
  point->evPeerDisconnected = EVENT_PEER_DISCONNECTED.load();
  point->evPeerZombieDropped = EVENT_PEER_ZOMBIE_DROPPED.load();
  point->evPeerSendMessage = EVENT_PEER_SEND_MESSAGE.load();
  point->evPeerShareFile = EVENT_PEER_SHARE_FILE.load();

  point->evRoomCreated = EVENT_ROOM_CREATED.load();
  point->evRoomDeleted = EVENT_ROOM_DELETED.load();

  point->fileServedBytes = FILE_SERVED_BYTES.load();

}

oatpp::String Statistics::getJsonData() {
  std::lock_guard<std::mutex> guard(m_dataLock);
  return m_objectMapper.writeToString(m_dataPoints);
}

Statistics::StateLoadResult Statistics::loadState(const std::string& path) {
  std::ifstream input(path, std::ios::binary | std::ios::ate);
  if (!input) {
    std::error_code error;
    const bool exists = std::filesystem::exists(path, error);
    return !error && !exists ? StateLoadResult::MISSING : StateLoadResult::INVALID;
  }

  const auto end = input.tellg();
  const auto stateSize = static_cast<std::streamoff>(end);
  if (stateSize <= 0 || stateSize > static_cast<std::streamoff>(MAX_STATE_BYTES)) {
    return StateLoadResult::INVALID;
  }
  std::string content(static_cast<std::size_t>(stateSize), '\0');
  input.seekg(0, std::ios::beg);
  if (!input.read(content.data(), static_cast<std::streamsize>(content.size()))) {
    return StateLoadResult::INVALID;
  }

  oatpp::List<oatpp::Object<StatPointDto>> loaded;
  try {
    loaded = m_objectMapper.readFromString<oatpp::List<oatpp::Object<StatPointDto>>>(
        content.c_str());
  } catch (...) {
    return StateLoadResult::INVALID;
  }
  if (!loaded || loaded->empty() || loaded->size() > MAX_STATE_POINTS) {
    return StateLoadResult::INVALID;
  }

  v_int64 previousTimestamp = 0;
  for (const auto& point : *loaded) {
    if (!validPoint(point) || *point->timestamp < previousTimestamp) {
      return StateLoadResult::INVALID;
    }
    previousTimestamp = *point->timestamp;
  }

  const auto& latest = loaded->back();
  EVENT_FRONT_PAGE_LOADED.store(*latest->evFrontpageLoaded);
  EVENT_PEER_CONNECTED.store(*latest->evPeerConnected);
  EVENT_PEER_DISCONNECTED.store(*latest->evPeerDisconnected);
  EVENT_PEER_ZOMBIE_DROPPED.store(*latest->evPeerZombieDropped);
  EVENT_PEER_SEND_MESSAGE.store(*latest->evPeerSendMessage);
  EVENT_PEER_SHARE_FILE.store(*latest->evPeerShareFile);
  EVENT_ROOM_CREATED.store(*latest->evRoomCreated);
  EVENT_ROOM_DELETED.store(*latest->evRoomDeleted);
  FILE_SERVED_BYTES.store(*latest->fileServedBytes);

  const auto nowMicro = oatpp::Environment::getMicroTickCount();
  const auto oldestTimestamp = nowMicro - m_maxPeriod.count();
  auto retained = oatpp::List<oatpp::Object<StatPointDto>>::createShared();
  for (const auto& point : *loaded) {
    if (*point->timestamp >= oldestTimestamp && *point->timestamp <= nowMicro) {
      retained->push_back(point);
    }
  }

  std::lock_guard<std::mutex> guard(m_dataLock);
  m_dataPoints = std::move(retained);
  return StateLoadResult::LOADED;
}

bool Statistics::saveState(const std::string& path) {
  if (path.empty()) return false;
  const auto json = getJsonData();
  if (!json || json->empty() || json->size() > MAX_STATE_BYTES) return false;
  return writeAtomically(path, *json);
}

void Statistics::runStatIteration() {
  takeSample();
}
