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

#include "Room.hpp"
#include "utils/ServerBoundaries.hpp"

#include <vector>

oatpp::String Room::getName() {
  return m_name;
}

bool Room::addPeer(const std::shared_ptr<Peer>& peer) {
  std::lock_guard<std::mutex> guard(m_peerByIdLock);
  if (!conspire::boundaries::hasCapacity(m_peerById.size(), conspire::boundaries::Limits::peersPerRoom)) return false;
  m_peerById[peer->getPeerId()] = peer;
  return true;
}

bool Room::hasPeerCapacity() const {
  std::lock_guard<std::mutex> guard(m_peerByIdLock);
  return conspire::boundaries::hasCapacity(m_peerById.size(), conspire::boundaries::Limits::peersPerRoom);
}

void Room::welcomePeer(const std::shared_ptr<Peer>& peer) {

  /* Inform all that peer have joined the room */

  auto joinedMessage = MessageDto::createShared();
  joinedMessage->code = MessageCodes::CODE_PEER_JOINED;
  joinedMessage->peerId = peer->getPeerId();
  joinedMessage->peerName = peer->getNickname();
  joinedMessage->message = peer->getNickname() + " - joined room";

  // The joining transport receives its single v2 snapshot through
  // SESSION_READY; existing peers receive the live durable announcement.
  publishDurable(joinedMessage, peer);

}

void Room::onboardPeer(const std::shared_ptr<Peer>& peer) {

  auto infoMessage = MessageDto::createShared();
  infoMessage->code = MessageCodes::CODE_INFO;
  infoMessage->peerId = peer->getPeerId();
  infoMessage->peerName = peer->getNickname();

  infoMessage->peers = getPeers();
  infoMessage->history = getHistory();
  peer->sendMessageAsync(infoMessage);

}

oatpp::List<oatpp::Object<PeerDto>> Room::getPeers() {
  auto result = oatpp::List<oatpp::Object<PeerDto>>::createShared();
  std::vector<std::shared_ptr<Peer>> peers;
  {
    std::lock_guard<std::mutex> guard(m_peerByIdLock);
    peers.reserve(m_peerById.size());
    for (const auto& entry : m_peerById) peers.push_back(entry.second);
  }
  for (const auto& current : peers) {
    auto p = PeerDto::createShared();
    p->peerId = current->getPeerId();
    p->peerName = current->getNickname();
    result->push_back(p);
  }
  return result;
}

void Room::goodbyePeer(const std::shared_ptr<Peer>& peer) {

  auto message = MessageDto::createShared();
  message->code = MessageCodes::CODE_PEER_LEFT;
  message->peerId = peer->getPeerId();
  message->message = peer->getNickname() + " - left room";

  publishDurable(message);

}

void Room::publishConnectionState(const std::shared_ptr<Peer>& peer, bool connected) {
  auto message = MessageDto::createShared();
  message->code = MessageCodes::CODE_PEER_CONNECTION_STATE;
  message->peerId = peer->getPeerId();
  message->connected = connected;
  sendMessageAsync(message); // transient: deliberately not sequenced/history retained
}

std::shared_ptr<Peer> Room::getPeerById(v_int64 peerId) {
  std::lock_guard<std::mutex> guard(m_peerByIdLock);
  return conspire::boundaries::findById(m_peerById, peerId);
}

void Room::removePeerById(v_int64 peerId) {
  std::shared_ptr<Peer> peer;
  {
    std::lock_guard<std::mutex> guard(m_peerByIdLock);
    const auto it = m_peerById.find(peerId);
    if (it == m_peerById.end()) return;
    peer = it->second;
    m_peerById.erase(it);
  }
  std::vector<std::shared_ptr<File>> files;
  {
    std::lock_guard<std::mutex> mutation(m_fileMutationLock);
    files = peer->takeFilesSnapshot();
    std::lock_guard<std::mutex> guard(m_fileByIdLock);
    for (const auto& file : files) m_fileById.erase(file->getServerFileId());
  }
  for (const auto& file : files) file->clearSubscribers();

}

void Room::addHistoryMessage(const oatpp::Object<MessageDto>& message) {
  std::lock_guard<std::mutex> guard(m_historyLock);

  const auto sequence = m_sequencer.next();
  if (!sequence) throw std::overflow_error("room server sequence exhausted");
  message->serverSeq = *sequence;

  if(!m_appConfig->maxRoomHistoryMessages || *m_appConfig->maxRoomHistoryMessages == 0) {
    return;
  }

  m_history.push_back(message);

  conspire::boundaries::retainLast(m_history, *m_appConfig->maxRoomHistoryMessages);

}

void Room::publishDurable(const oatpp::Object<MessageDto>& message,
                          const std::shared_ptr<Peer>& excluded,
                          const std::function<void(v_uint64)>& beforeBroadcast) {
  std::lock_guard<std::mutex> order(m_durablePublishLock);
  addHistoryMessage(message);
  if (beforeBroadcast) beforeBroadcast(*message->serverSeq);
  sendMessageAsync(message, excluded);
}

v_uint64 Room::latestServerSeq() {
  std::lock_guard<std::mutex> guard(m_historyLock);
  return m_sequencer.latest();
}

oatpp::List<oatpp::Object<MessageDto>> Room::getHistoryAfter(v_uint64 cursor, bool& resyncRequired) {
  auto result = oatpp::List<oatpp::Object<MessageDto>>::createShared();
  std::lock_guard<std::mutex> guard(m_historyLock);
  const auto earliest = !m_history.empty() && m_history.front()->serverSeq
    ? std::optional<v_uint64>(*m_history.front()->serverSeq) : std::nullopt;
  resyncRequired = conspire::session::requiresReplayResync(cursor, m_sequencer.latest(), earliest);
  for (const auto& message : m_history) {
    if (resyncRequired || (message->serverSeq && *message->serverSeq > cursor)) result->push_back(message);
  }
  return result;
}

oatpp::List<oatpp::Object<MessageDto>> Room::getHistory() {

  if(!m_appConfig->maxRoomHistoryMessages || *m_appConfig->maxRoomHistoryMessages == 0) {
    return nullptr;
  }

  auto result = oatpp::List<oatpp::Object<MessageDto>>::createShared();

  std::lock_guard<std::mutex> guard(m_historyLock);

  for(auto& message : m_history) {
    result->push_back(message);
  }

  return result;

}

std::vector<std::shared_ptr<File>> Room::shareFiles(v_int64 hostPeerId,
                                                    const MessageDto::FilesList& descriptors) {
  std::lock_guard<std::mutex> mutation(m_fileMutationLock);
  auto host = getPeerById(hostPeerId);
  if(!host || !descriptors ||
     !conspire::boundaries::hasCapacityFor(host->getFilesSnapshot().size(), descriptors->size(),
                                            conspire::boundaries::Limits::filesPerPeer)) return {};

  std::vector<std::shared_ptr<File>> files;
  files.reserve(descriptors->size());
  for (const auto& descriptor : *descriptors) {
    const v_int64 serverFileId = m_fileIdCounter ++;
    files.push_back(std::make_shared<File>(host, descriptor->clientFileId, serverFileId,
                                          descriptor->name, descriptor->size, descriptor->mediaType));
  }
  std::unordered_map<v_int64, std::shared_ptr<File>> prepared;
  prepared.reserve(files.size());
  for (const auto& file : files) prepared.emplace(file->getServerFileId(), file);
  host->addFiles(files);
  {
    std::lock_guard<std::mutex> guard(m_fileByIdLock);
    m_fileById.merge(prepared);
  }
  if (!prepared.empty()) throw std::logic_error("generated duplicate server file id");
  for (std::size_t index = 0; index < files.size(); ++index)
    ++ m_statistics->EVENT_PEER_SHARE_FILE;
  return files;

}

std::shared_ptr<File> Room::getFileById(v_int64 fileId) {
  std::lock_guard<std::mutex> guard(m_fileByIdLock);
  return conspire::boundaries::findById(m_fileById, fileId);
}

void Room::withdrawPeerFiles(const std::shared_ptr<Peer>& peer) {
  std::vector<std::shared_ptr<File>> files;
  {
    std::lock_guard<std::mutex> mutation(m_fileMutationLock);
    files = peer->takeFilesSnapshot();
    if (files.empty()) return;
    std::lock_guard<std::mutex> guard(m_fileByIdLock);
    for (const auto& file : files) m_fileById.erase(file->getServerFileId());
  }
  for (const auto& file : files) file->clearSubscribers();

  auto unavailable = MessageDto::createShared();
  unavailable->code = MessageCodes::CODE_PEER_MESSAGE_FILE;
  unavailable->peerId = peer->getPeerId();
  unavailable->peerName = peer->getNickname();
  unavailable->files = MessageDto::FilesList::createShared();
  for (const auto& file : files) {
    auto descriptor = FileDto::createShared();
    descriptor->serverFileId = file->getServerFileId();
    descriptor->name = file->getFileName();
    descriptor->size = file->getFileSize();
    descriptor->available = false;
    unavailable->files->push_back(descriptor);
  }
  publishDurable(unavailable);
}

void Room::sendMessageAsync(const oatpp::Object<MessageDto>& message,
                            const std::shared_ptr<Peer>& excluded) {
  std::vector<std::shared_ptr<Peer>> peers;
  {
    std::lock_guard<std::mutex> guard(m_peerByIdLock);
    peers.reserve(m_peerById.size());
    for (const auto& pair : m_peerById) peers.push_back(pair.second);
  }
  for (const auto& peer : peers) {
    if (peer != excluded) peer->sendMessageAsync(message);
  }
}

void Room::pingAllPeers() {
  std::vector<std::shared_ptr<Peer>> peers;
  {
    std::lock_guard<std::mutex> guard(m_peerByIdLock);
    peers.reserve(m_peerById.size());
    for (const auto& pair : m_peerById) peers.push_back(pair.second);
  }
  for (const auto& peer : peers) {
    const auto generation = peer->socketGeneration();
    if(peer->sendPingAsync() == Heartbeat::Tick::EXPIRED) {
      // A resume can replace this transport between the liveness observation
      // and invalidation; never close that newer generation.
      if (peer->invalidateSocketIfCurrent(generation, Peer::CloseReason::HEARTBEAT_TIMEOUT))
        ++ m_statistics->EVENT_PEER_ZOMBIE_DROPPED;
    }
  }
}

bool Room::isEmpty() {
  std::lock_guard<std::mutex> guard(m_peerByIdLock);
  return m_peerById.size() == 0;
}
