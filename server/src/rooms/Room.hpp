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

#ifndef ASYNC_SERVER_ROOMS_ROOM_HPP
#define ASYNC_SERVER_ROOMS_ROOM_HPP

#include "./File.hpp"
#include "./Peer.hpp"
#include "dto/DTOs.hpp"
#include "utils/Statistics.hpp"
#include "utils/SessionReliability.hpp"

#include "oatpp/macro/component.hpp"

#include <unordered_map>
#include <list>
#include <functional>

class Room {
private:
  // Never hold more than one aggregate lock. Copy shared ownership while a
  // collection lock is held, then call peers/files only after releasing it.
  oatpp::String m_name;
  std::atomic<v_int64> m_fileIdCounter;
  std::unordered_map<v_int64, std::shared_ptr<File>> m_fileById;
  std::unordered_map<v_int64, std::shared_ptr<Peer>> m_peerById;
  std::list<oatpp::Object<MessageDto>> m_history;
  conspire::session::RoomSequencer m_sequencer;
  // Serializes sequence assignment, history insertion, and broadcast
  // submission so every peer's write queue observes durable room order.
  mutable std::mutex m_durablePublishLock;
  // Serializes whole file batches against withdrawal/expiry cleanup while the
  // peer index and room index are updated under their own short-held locks.
  mutable std::mutex m_fileMutationLock;
  mutable std::mutex m_peerByIdLock;
  mutable std::mutex m_fileByIdLock;
  mutable std::mutex m_historyLock;
private:
  OATPP_COMPONENT(oatpp::Object<ConfigDto>, m_appConfig);
  OATPP_COMPONENT(std::shared_ptr<Statistics>, m_statistics);
public:

  Room(const oatpp::String& name)
    : m_name(name)
    , m_fileIdCounter(1)
  {
    ++ m_statistics->EVENT_ROOM_CREATED;
  }

  ~Room() {
    ++ m_statistics->EVENT_ROOM_DELETED;
  }

  /**
   * Get room name.
   * @return
   */
  oatpp::String getName();

  /**
   * Add peer to the room.
   * @param peer
   */
  bool addPeer(const std::shared_ptr<Peer>& peer);
  bool hasPeerCapacity() const;

  /**
   * Inform the audience about the new peer.
   * @param peer
   */
  void welcomePeer(const std::shared_ptr<Peer>& peer);

  /**
   * Send info about other peers and available chat history to peer.
   * @param peer
   */
  void onboardPeer(const std::shared_ptr<Peer>& peer);

  /**
   * Send peer left room message.
   * @param peer
   */
  void goodbyePeer(const std::shared_ptr<Peer>& peer);
  void publishConnectionState(const std::shared_ptr<Peer>& peer, bool connected);

  /**
   * Get peer by id.
   * @param peerId
   * @return
   */
  std::shared_ptr<Peer> getPeerById(v_int64 peerId);

  /**
   * Remove peer from the room.
   * @param peerId
   */
  void removePeerById(v_int64 peerId);

  /**
   * Add message to history.
   * @param message
   */
  void addHistoryMessage(const oatpp::Object<MessageDto>& message);
  void publishDurable(const oatpp::Object<MessageDto>& message,
                      const std::shared_ptr<Peer>& excluded = nullptr,
                      const std::function<void(v_uint64)>& beforeBroadcast = {});

  /**
   * Get list of history messages.
   * @return
   */
  oatpp::List<oatpp::Object<MessageDto>> getHistory();
  oatpp::List<oatpp::Object<PeerDto>> getPeers();
  oatpp::List<oatpp::Object<MessageDto>> getHistoryAfter(v_uint64 cursor, bool& resyncRequired);
  v_uint64 latestServerSeq();

  /**
   * Share file.
   * @param hostPeerId
   * @param fileClientId
   * @param fileName
   * @param fileSize
   * @return
   */
  std::vector<std::shared_ptr<File>> shareFiles(v_int64 hostPeerId,
                                                const MessageDto::FilesList& files);

  /**
   * Get file by id.
   * @param fileId
   * @return
   */
  std::shared_ptr<File> getFileById(v_int64 fileId);
  /** Remove files whose browser File source vanished after a page reload. */
  void withdrawPeerFiles(const std::shared_ptr<Peer>& peer);

  /**
   * Send message to all peers in the room.
   * @param message
   */
  void sendMessageAsync(const oatpp::Object<MessageDto>& message,
                        const std::shared_ptr<Peer>& excluded = nullptr);

  /**
   * Websocket-Ping all peers.
   */
  void pingAllPeers();

  /**
   * Check if room is empty (no peers in the room).
   * @return
   */
  bool isEmpty();

};

#endif //ASYNC_SERVER_ROOMS_ROOM_HPP
