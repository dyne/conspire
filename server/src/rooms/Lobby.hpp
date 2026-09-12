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

#ifndef ASYNC_SERVER_ROOMS_LOBBY_HPP
#define ASYNC_SERVER_ROOMS_LOBBY_HPP

#include "./Room.hpp"
#include "utils/Statistics.hpp"
#include "utils/SessionCredentials.hpp"

#include "oatpp-websocket/AsyncConnectionHandler.hpp"

#include <unordered_map>
#include <mutex>
#include <chrono>

class Lobby : public oatpp::websocket::AsyncConnectionHandler::SocketInstanceListener {
private:
  std::atomic<v_int64> m_peerIdCounter{1};
  std::unordered_map<oatpp::String, std::shared_ptr<Room>> m_rooms;
  std::mutex m_roomsMutex;
  struct SessionRecord {
    std::shared_ptr<Room> room;
    std::shared_ptr<Peer> peer;
    conspire::session::TokenDigest digest;
    conspire::session::SessionLease lease;
  };
  std::unordered_map<std::string, SessionRecord> m_sessions;
  struct PendingRecord {
    std::shared_ptr<AsyncWebSocket> socket;
    conspire::session::Clock::time_point deadline;
  };
  std::unordered_map<AsyncWebSocket*, PendingRecord> m_pending;
  std::mutex m_sessionsMutex;
  OATPP_COMPONENT(std::shared_ptr<Statistics>, m_statistics);
  void deleteRoomIfEmpty(const std::shared_ptr<Room>& room);
  static std::string digestKey(const conspire::session::TokenDigest& digest);
public:
  // State is intentionally private: room changes must retain the lock discipline
  // implemented by this aggregate.
  v_int64 obtainNewPeerId();
  std::shared_ptr<Room> getOrCreateRoom(const oatpp::String& roomName);
  std::shared_ptr<Room> getRoom(const oatpp::String& roomName);

  /** Ping every current room once. Scheduling and cancellation belong to an
   * owned lifecycle runner. */
  void runPingIteration();
  void expireSessions(conspire::session::Clock::time_point now = conspire::session::Clock::now());
  /** Validate the first frame before creating or rebinding a logical peer. */
  std::shared_ptr<Peer> acceptSessionHello(const std::shared_ptr<AsyncWebSocket>& socket,
                                           const oatpp::String& roomName, const oatpp::String& nickname,
                                           const oatpp::Object<MessageDto>& hello);
  void detachSessionTransport(const std::shared_ptr<AsyncWebSocket>& socket);

public:

  /**
   *  Called when socket is created
   */
  void onAfterCreate_NonBlocking(const std::shared_ptr<AsyncWebSocket>& socket, const std::shared_ptr<const ParameterMap>& params) override;

  /**
   *  Called before socket instance is destroyed.
   */
  void onBeforeDestroy_NonBlocking(const std::shared_ptr<AsyncWebSocket>& socket) override;

};


#endif //ASYNC_SERVER_ROOMS_LOBBY_HPP
