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

#include "Lobby.hpp"
#include "utils/ServerBoundaries.hpp"

#include "oatpp/data/stream/BufferStream.hpp"

#include <vector>

namespace {

class PendingHello final : public oatpp::websocket::AsyncWebSocket::Listener {
  Lobby* m_lobby;
  oatpp::String m_roomName;
  oatpp::String m_nickname;
  oatpp::data::stream::BufferOutputStream m_buffer;
  bool m_consumed = false;
  OATPP_COMPONENT(std::shared_ptr<oatpp::data::mapping::ObjectMapper>, m_objectMapper);
  OATPP_COMPONENT(oatpp::Object<ConfigDto>, m_appConfig);
public:
  PendingHello(Lobby* lobby, const oatpp::String& roomName, const oatpp::String& nickname)
    : m_lobby(lobby), m_roomName(roomName), m_nickname(nickname) {}
  CoroutineStarter reject(const std::shared_ptr<AsyncWebSocket>& socket) {
    // Deliberately generic: it lets a browser discard an unusable local bearer
    // without revealing whether a token was unknown, expired, or cross-room.
    auto error = MessageDto::createShared();
    error->code = MessageCodes::CODE_API_ERROR;
    error->message = "Session unavailable.";
    class RejectCoroutine final : public oatpp::async::Coroutine<RejectCoroutine> {
      std::shared_ptr<AsyncWebSocket> m_socket;
      oatpp::String m_message;
    public:
      RejectCoroutine(std::shared_ptr<AsyncWebSocket> socket, oatpp::String message)
        : m_socket(std::move(socket)), m_message(std::move(message)) {}
      Action act() override {
        return std::move(m_socket->sendOneFrameTextAsync(m_message)
          .next(m_socket->sendCloseAsync())).next(new oatpp::async::Error("Session unavailable"));
      }
    };
    return RejectCoroutine::start(socket, m_objectMapper->writeToString(error));
  }
  CoroutineStarter readMessage(const std::shared_ptr<AsyncWebSocket>& socket, v_uint8, p_char8 data,
                               oatpp::v_io_size size) override {
    if (m_consumed) { socket->getConnection().invalidate(); return nullptr; }
    if (size > 0) {
      const auto limit = *m_appConfig->maxMessageSizeBytes;
      const auto position = m_buffer.getCurrentPosition();
      if (position < 0 || static_cast<v_uint64>(position) > limit ||
          static_cast<v_uint64>(size) > limit - static_cast<v_uint64>(position)) {
        socket->getConnection().invalidate();
        return nullptr;
      }
      m_buffer.writeSimple(data, size);
      return nullptr;
    }
    m_consumed = true;
    try {
      const auto hello = m_objectMapper->readFromString<oatpp::Object<MessageDto>>(m_buffer.toString());
      if (!m_lobby->acceptSessionHello(socket, m_roomName, m_nickname, hello)) return reject(socket);
    } catch (const std::runtime_error&) { return reject(socket); }
    return nullptr;
  }
  CoroutineStarter onPing(const std::shared_ptr<AsyncWebSocket>&, const oatpp::String&) override { return nullptr; }
  CoroutineStarter onPong(const std::shared_ptr<AsyncWebSocket>&, const oatpp::String&) override { return nullptr; }
  CoroutineStarter onClose(const std::shared_ptr<AsyncWebSocket>&, v_uint16, const oatpp::String&) override { return nullptr; }
};

} // namespace

std::string Lobby::digestKey(const conspire::session::TokenDigest& digest) {
  return {reinterpret_cast<const char*>(digest.data()), digest.size()};
}

v_int64 Lobby::obtainNewPeerId() {
  return m_peerIdCounter ++;
}

std::shared_ptr<Room> Lobby::getOrCreateRoom(const oatpp::String& roomName) {
  std::lock_guard<std::mutex> lock(m_roomsMutex);
  const auto existing = m_rooms.find(roomName);
  if (existing != m_rooms.end()) return existing->second;
  if (!conspire::boundaries::hasCapacity(m_rooms.size(), conspire::boundaries::Limits::rooms)) return nullptr;
  auto room = std::make_shared<Room>(roomName);
  m_rooms.emplace(roomName, room);
  return room;
}

std::shared_ptr<Room> Lobby::getRoom(const oatpp::String& roomName) {
  std::lock_guard<std::mutex> lock(m_roomsMutex);
  auto it = m_rooms.find(roomName);
  if(it != m_rooms.end()) {
    return it->second;
  }
  return nullptr;
}

void Lobby::deleteRoomIfEmpty(const std::shared_ptr<Room>& room) {
  std::lock_guard<std::mutex> lock(m_roomsMutex);
  const auto found = m_rooms.find(room->getName());
  if (found != m_rooms.end() && found->second == room && room->isEmpty()) m_rooms.erase(found);
}

void Lobby::runPingIteration() {
  std::vector<std::shared_ptr<Room>> rooms;
  {
    std::lock_guard<std::mutex> lock(m_roomsMutex);
    rooms.reserve(m_rooms.size());
    for (const auto& room : m_rooms) rooms.push_back(room.second);
  }
  for (const auto& room : rooms) room->pingAllPeers();
}

std::shared_ptr<Peer> Lobby::acceptSessionHello(const std::shared_ptr<AsyncWebSocket>& socket,
                                                const oatpp::String& roomName, const oatpp::String& nickname,
                                                const oatpp::Object<MessageDto>& hello) {
  if (!hello || !hello->code || *hello->code != MessageCodes::CODE_SESSION_HELLO ||
      !hello->protocolVersion || *hello->protocolVersion != 2 || !hello->lastServerSeq ||
      !hello->fileCapabilityId || !conspire::session::validBase64UrlId(*hello->fileCapabilityId, 16)) return nullptr;
  const auto now = conspire::session::Clock::now();
  {
    std::lock_guard<std::mutex> lock(m_sessionsMutex);
    const auto pending = m_pending.find(socket.get());
    if (pending == m_pending.end() || now >= pending->second.deadline) return nullptr;
    m_pending.erase(pending); // exactly one application hello per transport
  }
  std::shared_ptr<Peer> peer;
  std::string token;
  bool resumed = false;
  if (hello->resumeToken) {
    if (!conspire::session::validBase64UrlId(*hello->resumeToken, 32)) return nullptr;
    const auto digest = conspire::session::digestToken(*hello->resumeToken);
    {
      std::lock_guard<std::mutex> lock(m_sessionsMutex);
      const auto it = m_sessions.find(digestKey(digest));
      if (it == m_sessions.end() || !conspire::session::constantTimeDigestEqual(it->second.digest, digest) ||
          it->second.room->getName() != roomName || !it->second.lease.resume(now)) return nullptr;
      peer = it->second.peer;
    }
    // Do not take a peer state lock while the registry lock is held.  The old
    // transport is selected atomically and invalidated only after both locks.
    const auto replaced = peer->replaceSocket(socket);
    if (replaced && replaced != socket) replaced->getConnection().invalidate();
    resumed = true;
  } else {
    if (!conspire::session::makeResumeToken(token)) return nullptr;
    const auto digest = conspire::session::digestToken(token);
    auto room = getOrCreateRoom(roomName);
    if (!(room && room->hasPeerCapacity())) return nullptr;
    peer = std::make_shared<Peer>(socket, room, nickname, obtainNewPeerId());
    if (!room->addPeer(peer)) return nullptr;
    {
      std::lock_guard<std::mutex> lock(m_sessionsMutex);
      m_sessions.emplace(digestKey(digest), SessionRecord{room, peer, digest, {}});
    }
    room->welcomePeer(peer);
  }
  if (!peer || (!resumed && token.empty())) return nullptr;
  socket->setListener(peer);
  auto ready = MessageDto::createShared();
  ready->code = MessageCodes::CODE_SESSION_READY;
  ready->protocolVersion = 2;
  ready->resumed = resumed;
  ready->peerId = peer->getPeerId();
  ready->peerName = peer->getNickname();
  ready->peers = peer->getRoom()->getPeers();
  ready->latestServerSeq = peer->getRoom()->latestServerSeq();
  bool resyncRequired = false;
  ready->history = peer->getRoom()->getHistoryAfter(*hello->lastServerSeq, resyncRequired);
  ready->resyncRequired = resyncRequired;
  // The raw bearer is never retained by the registry; on resume it is echoed
  // only on the already-authenticated private transport.
  ready->resumeToken = resumed ? hello->resumeToken : oatpp::String(token.c_str());
  peer->sendMessageAsync(ready);
  if (!resumed) { ++m_statistics->EVENT_PEER_CONNECTED; }
  else { ++m_statistics->EVENT_PEER_RESUMED; peer->getRoom()->publishConnectionState(peer, true); }
  return peer;
}

void Lobby::detachSessionTransport(const std::shared_ptr<AsyncWebSocket>& socket) {
  const auto peer = std::dynamic_pointer_cast<Peer>(socket->getListener());
  if (!peer || !peer->detachIfCurrent(socket)) return;
  std::shared_ptr<Room> room;
  {
    std::lock_guard<std::mutex> lock(m_sessionsMutex);
    for (auto& entry : m_sessions) {
      if (entry.second.peer == peer) {
        entry.second.lease.detach(conspire::session::Clock::now());
        room = entry.second.room;
        break;
      }
    }
  }
  if (room) { ++m_statistics->EVENT_PEER_DISCONNECTED; room->publishConnectionState(peer, false); }
}

void Lobby::expireSessions(conspire::session::Clock::time_point now) {
  std::vector<SessionRecord> expired;
  std::vector<std::shared_ptr<AsyncWebSocket>> pendingExpired;
  {
    std::lock_guard<std::mutex> lock(m_sessionsMutex);
    for (auto it = m_pending.begin(); it != m_pending.end();) {
      if (now >= it->second.deadline) { pendingExpired.push_back(it->second.socket); it = m_pending.erase(it); }
      else ++it;
    }
    for (auto it = m_sessions.begin(); it != m_sessions.end();) {
      if (it->second.lease.expires(now)) {
        expired.push_back(it->second);
        it = m_sessions.erase(it);
      } else ++it;
    }
  }
  for (const auto& socket : pendingExpired) socket->getConnection().invalidate();
  // All callbacks/broadcasts happen after dropping the registry lock.
  for (const auto& session : expired) {
    session.room->removePeerById(session.peer->getPeerId());
    session.room->goodbyePeer(session.peer);
    ++m_statistics->EVENT_SESSION_EXPIRED;
    deleteRoomIfEmpty(session.room);
  }
}

void Lobby::onAfterCreate_NonBlocking(const std::shared_ptr<AsyncWebSocket>& socket, const std::shared_ptr<const ParameterMap>& params) {
  auto roomName = params->find("roomName")->second;
  auto nickname = params->find("nickname")->second;
  {
    std::lock_guard<std::mutex> lock(m_sessionsMutex);
    m_pending.emplace(socket.get(), PendingRecord{socket, conspire::session::Clock::now() + std::chrono::seconds(10)});
  }
  socket->setListener(std::make_shared<PendingHello>(this, roomName, nickname));

}

void Lobby::onBeforeDestroy_NonBlocking(const std::shared_ptr<AsyncWebSocket>& socket) {

  {
    std::lock_guard<std::mutex> lock(m_sessionsMutex);
    m_pending.erase(socket.get());
  }
  detachSessionTransport(socket);

}
