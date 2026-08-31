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

#include <vector>

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

void Lobby::deleteRoom(const oatpp::String& roomName) {
  std::lock_guard<std::mutex> lock(m_roomsMutex);
  m_rooms.erase(roomName);
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

void Lobby::onAfterCreate_NonBlocking(const std::shared_ptr<AsyncWebSocket>& socket, const std::shared_ptr<const ParameterMap>& params) {

  ++ m_statistics->EVENT_PEER_CONNECTED;

  auto roomName = params->find("roomName")->second;
  auto nickname = params->find("nickname")->second;
  auto room = getOrCreateRoom(roomName);
  if (!room) {
    socket->getConnection().invalidate();
    return;
  }

  auto peer = std::make_shared<Peer>(socket, room, nickname, obtainNewPeerId());
  socket->setListener(peer);

  room->welcomePeer(peer);
  room->addPeer(peer);
  room->onboardPeer(peer);

}

void Lobby::onBeforeDestroy_NonBlocking(const std::shared_ptr<AsyncWebSocket>& socket) {

  ++ m_statistics->EVENT_PEER_DISCONNECTED;

  auto peer = std::static_pointer_cast<Peer>(socket->getListener());
  auto room = peer->getRoom();

  room->removePeerById(peer->getPeerId());
  room->goodbyePeer(peer);
  peer->invalidateSocket();

  if(room->isEmpty()) {
    deleteRoom(room->getName());
  }

}
