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

#include "Peer.hpp"
#include "Room.hpp"
#include "utils/ServerBoundaries.hpp"

#include "oatpp/network/tcp/Connection.hpp"
#include "oatpp/encoding/Base64.hpp"
#include "oatpp/base/Log.hpp"

namespace {

std::string boundedCloseDetail(const oatpp::String& detail) {
  constexpr std::size_t maxBytes = 120;
  if (!detail) return {};
  const std::string value(*detail);
  std::string safe;
  safe.reserve(std::min(value.size(), maxBytes));
  for (std::size_t index = 0; index < value.size() && safe.size() < maxBytes;) {
    const auto lead = static_cast<unsigned char>(value[index]);
    std::size_t length = lead < 0x80U ? 1 : lead >= 0xc2U && lead <= 0xdfU ? 2 :
                         lead >= 0xe0U && lead <= 0xefU ? 3 : lead >= 0xf0U && lead <= 0xf4U ? 4 : 0;
    bool valid = length != 0 && index + length <= value.size();
    for (std::size_t offset = 1; valid && offset < length; ++offset)
      valid = (static_cast<unsigned char>(value[index + offset]) & 0xc0U) == 0x80U;
    if (!valid || safe.size() + length > maxBytes) { safe.push_back('?'); ++index; continue; }
    safe.append(value, index, length); index += length;
  }
  return safe;
}

} // namespace

void Peer::sendMessageAsync(const oatpp::Object<MessageDto>& message) {
  static constexpr std::size_t maxOutboundFrames = 256;
  static constexpr std::size_t maxOutboundBytes = 2 * 1024 * 1024;
  std::shared_ptr<AsyncWebSocket> socket;
  std::uint64_t generation = 0;
  {
    std::lock_guard<std::mutex> lock(m_stateLock);
    socket = m_socket;
    generation = m_socketGeneration;
  }
  if (!socket) return;

  const auto payload = m_objectMapper->writeToString(message);
  bool startDrain = false;
  bool overflow = false;
  {
    std::lock_guard<std::mutex> lock(m_outboundLock);
    const auto payloadBytes = payload ? static_cast<std::size_t>(payload->size()) : 0U;
    overflow = m_outboundFrames.size() >= maxOutboundFrames ||
               payloadBytes > maxOutboundBytes - std::min(m_outboundBytes, maxOutboundBytes);
    if (!overflow) {
      m_outboundFrames.push_back({socket, generation, payload});
      m_outboundBytes += payloadBytes;
      if (!m_outboundDrainActive) {
        m_outboundDrainActive = true;
        startDrain = true;
      }
    }
  }
  if (overflow) {
    invalidateSocketIfCurrent(generation, CloseReason::WRITE_ERROR);
    return;
  }
  if (startDrain) startOutboundDrain();
}

bool Peer::takeOutboundFrame(OutboundFrame& frame) {
  std::lock_guard<std::mutex> lock(m_outboundLock);
  if (m_outboundFrames.empty()) {
    m_outboundDrainActive = false;
    return false;
  }
  frame = std::move(m_outboundFrames.front());
  m_outboundFrames.pop_front();
  if (frame.payload) m_outboundBytes -= frame.payload->size();
  return true;
}

bool Peer::isCurrentBinding(const OutboundFrame& frame) const {
  std::lock_guard<std::mutex> lock(m_stateLock);
  return frame.socket == m_socket && frame.generation == m_socketGeneration;
}

void Peer::startOutboundDrain() {
  class DrainCoroutine final : public oatpp::async::Coroutine<DrainCoroutine> {
    std::shared_ptr<Peer> m_peer;
    OutboundFrame m_frame;
  public:
    explicit DrainCoroutine(std::shared_ptr<Peer> peer) : m_peer(std::move(peer)) {}
    Action act() override { return nextFrame(); }
    Action nextFrame() {
      while (m_peer->takeOutboundFrame(m_frame)) {
        if (!m_peer->isCurrentBinding(m_frame)) continue;
        return oatpp::async::synchronize(&m_peer->m_writeLock,
            m_frame.socket->sendOneFrameTextAsync(m_frame.payload)).next(yieldTo(&DrainCoroutine::sent));
      }
      return finish();
    }
    Action sent() { return nextFrame(); }
    Action handleError(oatpp::async::Error*) override {
      m_peer->invalidateSocketIfCurrent(m_frame.generation, Peer::CloseReason::WRITE_ERROR);
      return nextFrame();
    }
  };
  m_asyncExecutor->execute<DrainCoroutine>(shared_from_this());

}

Heartbeat::Tick Peer::sendPingAsync() {

  class SendPingCoroutine : public oatpp::async::Coroutine<SendPingCoroutine> {
  private:
    oatpp::async::Lock* m_lock;
    std::shared_ptr<AsyncWebSocket> m_websocket;
    Peer* m_peer;
    std::uint64_t m_generation;
  public:

    SendPingCoroutine(oatpp::async::Lock* lock, const std::shared_ptr<AsyncWebSocket>& websocket,
                      Peer* peer, std::uint64_t generation)
      : m_lock(lock)
      , m_websocket(websocket)
      , m_peer(peer)
      , m_generation(generation)
    {}

    Action act() override {
      return oatpp::async::synchronize(m_lock, m_websocket->sendPingAsync(nullptr)).next(yieldTo(&SendPingCoroutine::written));
    }
    Action written() { m_peer->pingWriteCompleted(m_generation, true); return finish(); }
    Action handleError(oatpp::async::Error*) override {
      if (m_peer->pingWriteCompleted(m_generation, false))
        m_peer->invalidateSocketIfCurrent(m_generation, Peer::CloseReason::WRITE_ERROR);
      return finish();
    }

  };

  std::shared_ptr<AsyncWebSocket> socket;
  std::uint64_t generation = 0;
  Heartbeat::Tick tick;
  {
    std::lock_guard<std::mutex> lock(m_stateLock);
    tick = m_heartbeat.tick(Heartbeat::Clock::now());
    if (tick != Heartbeat::Tick::QUEUE_PING) return tick;
    socket = m_socket;
    generation = m_socketGeneration;
  }
  if(socket) {
    m_asyncExecutor->execute<SendPingCoroutine>(&m_writeLock, socket, this, generation);
    return Heartbeat::Tick::QUEUE_PING;
  }
  return Heartbeat::Tick::NONE;

}

bool Peer::pingWriteCompleted(std::uint64_t generation, bool success) {
  std::lock_guard<std::mutex> lock(m_stateLock);
  return m_heartbeat.writeCompleted(generation, success);
}

oatpp::async::CoroutineStarter Peer::onApiError(const oatpp::String& errorMessage,
                                                const oatpp::String& clientMessageId) {
  recordProtocolError();

  class SendErrorCoroutine : public oatpp::async::Coroutine<SendErrorCoroutine> {
  private:
    oatpp::async::Lock* m_lock;
    std::shared_ptr<AsyncWebSocket> m_websocket;
    oatpp::String m_message;
  public:

    SendErrorCoroutine(oatpp::async::Lock* lock,
                       const std::shared_ptr<AsyncWebSocket>& websocket,
                       const oatpp::String& message)
      : m_lock(lock)
      , m_websocket(websocket)
      , m_message(message)
    {}

    Action act() override {
      /* synchronized async pipeline */
      return oatpp::async::synchronize(
        /* Async write-lock to prevent concurrent writes to socket */
        m_lock,
        /* send error message, then close-frame */
        std::move(m_websocket->sendOneFrameTextAsync(m_message).next(m_websocket->sendCloseAsync()))
      ).next(
        /* async error after error message and close-frame are sent */
        new oatpp::async::Error("API Error")
      );
    }

  };

  auto message = MessageDto::createShared();
  message->code = MessageCodes::CODE_API_ERROR;
  message->message = errorMessage;
  message->clientMessageId = clientMessageId;

  return SendErrorCoroutine::start(&m_writeLock, m_socket, m_objectMapper->writeToString(message));

}

oatpp::async::CoroutineStarter Peer::validateFilesList(const MessageDto::FilesList& filesList) {

  if(filesList->size() == 0)
    return onApiError("Files list is empty.");

  for(auto& fileDto : *filesList) {

    if (!fileDto)
      return onApiError("File structure is not provided.");
    if (!fileDto->clientFileId)
      return onApiError("File clientId is not provided.");
    if (!fileDto->name)
      return onApiError("File name is not provided.");
    if (!fileDto->size)
      return onApiError("File size is not provided.");

  }

  return nullptr;

}

oatpp::async::CoroutineStarter Peer::handleFilesMessage(const oatpp::Object<MessageDto>& message) {

  if (!message)
    return onApiError("No message provided.");
  if (!message->clientMessageId || !conspire::session::validClientMessageId(*message->clientMessageId))
    return onApiError("Invalid client message id.");
  auto files = message->files;
  if (!files || files->size() == 0 || files->size() > conspire::boundaries::Limits::filesPerMessage)
    return onApiError("Invalid files list.", message->clientMessageId);
  for (const auto& file : *files) {
    if (!file || !file->clientFileId || !file->name || !file->size ||
        !conspire::boundaries::validFileDescriptor(*file->name, *file->size))
      return onApiError("Invalid file descriptor.", message->clientMessageId);
  }

  std::lock_guard<std::mutex> commandLock(m_commandLock);
  if (const auto prior = m_dedupe.find(*message->clientMessageId)) {
    sendMessageAck(message->clientMessageId, *prior);
    return nullptr;
  }
  if (m_dedupe.full()) return onApiError("Retryable command capacity reached.", message->clientMessageId);
  auto fileMessage = MessageDto::createShared();
  fileMessage->code = MessageCodes::CODE_PEER_MESSAGE_FILE;
  fileMessage->peerId = m_peerId;
  fileMessage->peerName = m_nickname;
  fileMessage->timestamp = oatpp::Environment::getMicroTickCount();
  fileMessage->files = MessageDto::FilesList::createShared();

  const auto sharedFiles = m_room->shareFiles(m_peerId, files);
  if (sharedFiles.empty()) return onApiError("File limit reached.", message->clientMessageId);
  for(const auto& file : sharedFiles) {

    auto sharedFile = FileDto::createShared();
    sharedFile->serverFileId = file->getServerFileId();
    sharedFile->name = file->getFileName();
    sharedFile->size = file->getFileSize();

    fileMessage->files->push_back(sharedFile);

  }

  m_room->publishDurable(fileMessage, nullptr, [&](v_uint64 sequence) {
    if (!m_dedupe.remember(*message->clientMessageId, sequence))
      throw std::logic_error("preflighted retryable command was not recordable");
  });
  sendMessageAck(message->clientMessageId, *fileMessage->serverSeq);

  return nullptr;

}

oatpp::async::CoroutineStarter Peer::handleFileChunkMessage(const oatpp::Object<MessageDto>& message) {

  if (!message)
    return onApiError("No message provided.");
  auto filesList = message->files;
  if(!filesList)
    return onApiError("No file provided.");

  if(filesList->size() != 1)
    return onApiError("Invalid files count. Expected - 1.");

  auto fileDto = filesList->front();
  if (!fileDto)
    return onApiError("File structure is not provided.");
  if (!fileDto->serverFileId)
    return onApiError("File clientId is not provided.");
  if (!fileDto->subscriberId)
    return onApiError("File subscriberId is not provided.");
  if (!fileDto->data)
    return onApiError("File chunk data is not provided.");

  auto file = m_room->getFileById(fileDto->serverFileId);

  if(!file) return nullptr; // Ignore if file doesn't exist. File may be deleted already.

  const auto host = file->getHost();
  if(!host || host->getPeerId() != getPeerId())
    return onApiError("Wrong file host.");

  auto data = oatpp::encoding::Base64::decode(fileDto->data);
  if (!data || !fileDto->chunkPosition || !fileDto->chunkSize || !fileDto->chunkRequestId ||
      !conspire::boundaries::validChunk(*fileDto->chunkPosition, *fileDto->chunkSize,
                                        data->size(), file->getFileSize()))
    return onApiError("Invalid file chunk.");
  const auto result = file->provideFileChunk(fileDto->subscriberId, *fileDto->chunkRequestId,
                                             *fileDto->chunkPosition, *fileDto->chunkSize, data);
  if (result == conspire::boundaries::ChunkRequest::Result::INVALID)
    return onApiError("Unexpected file chunk.");

  return nullptr;

}

oatpp::async::CoroutineStarter Peer::handleMessage(const oatpp::Object<MessageDto>& message) {

  if(!message) {
    return onApiError("No message provided.");
  }
  if(!message->code) {
    return onApiError("No message code provided.");
  }

  switch(*message->code) {

    case MessageCodes::CODE_PEER_MESSAGE:
      if(!message->message || !conspire::boundaries::validMessageContent(*message->message))
        return onApiError("Invalid message content.", message->clientMessageId);
      if (!message->clientMessageId || !conspire::session::validClientMessageId(*message->clientMessageId))
        return onApiError("Invalid client message id.");
      {
        std::lock_guard<std::mutex> commandLock(m_commandLock);
        if (const auto prior = m_dedupe.find(*message->clientMessageId)) {
          sendMessageAck(message->clientMessageId, *prior);
          return nullptr;
        }
        if (m_dedupe.full()) return onApiError("Retryable command capacity reached.", message->clientMessageId);
        m_room->publishDurable(message, nullptr, [&](v_uint64 sequence) {
          if (!m_dedupe.remember(*message->clientMessageId, sequence))
            throw std::logic_error("preflighted retryable command was not recordable");
        });
        const auto sequence = message->serverSeq;
        sendMessageAck(message->clientMessageId, *sequence);
        ++ m_statistics->EVENT_PEER_SEND_MESSAGE;
      }
      break;

    case MessageCodes::CODE_PEER_IS_TYPING:
      m_room->sendMessageAsync(message); break;

    case MessageCodes::CODE_FILE_SHARE:
      return handleFilesMessage(message);

    case MessageCodes::CODE_FILE_CHUNK_DATA:
      return handleFileChunkMessage(message);

    default:
      return onApiError("Invalid client message code.");

  }

  return nullptr;

}

void Peer::sendMessageAck(const oatpp::String& clientMessageId, v_uint64 serverSeq) {
  auto ack = MessageDto::createShared();
  ack->code = MessageCodes::CODE_MESSAGE_ACK;
  ack->clientMessageId = clientMessageId;
  ack->serverSeq = serverSeq;
  sendMessageAsync(ack);
}

std::shared_ptr<Room> Peer::getRoom() {
  return m_room;
}

oatpp::String Peer::getNickname() {
  return m_nickname;
}

v_int64 Peer::getPeerId() {
  return m_peerId;
}

void Peer::addFiles(const std::vector<std::shared_ptr<File>>& files) {
  std::list<std::shared_ptr<File>> additions(files.begin(), files.end());
  std::lock_guard<std::mutex> lock(m_stateLock);
  m_files.splice(m_files.end(), additions);
}

std::vector<std::shared_ptr<File>> Peer::getFilesSnapshot() {
  std::lock_guard<std::mutex> lock(m_stateLock);
  return {m_files.begin(), m_files.end()};
}

bool Peer::setFileCapability(const oatpp::String& capabilityId) {
  std::lock_guard<std::mutex> lock(m_stateLock);
  const std::string next = capabilityId ? *capabilityId : std::string{};
  const bool changed = !m_fileCapabilityId.empty() && m_fileCapabilityId != next;
  m_fileCapabilityId = next;
  return changed;
}

std::vector<std::shared_ptr<File>> Peer::takeFilesSnapshot() {
  std::lock_guard<std::mutex> lock(m_stateLock);
  std::vector<std::shared_ptr<File>> files{m_files.begin(), m_files.end()};
  m_files.clear();
  return files;
}

void Peer::reissueOutstandingFileRequests() {
  const auto files = getFilesSnapshot();
  for (const auto& file : files) file->reissueOutstandingRequests();
}

void Peer::invalidateSocket(CloseReason reason) {
  std::shared_ptr<AsyncWebSocket> socket;
  std::uint64_t generation = 0;
  std::int64_t idleMilliseconds = 0;
  CloseReason winningReason;
  bool accountClose = false;
  {
    std::lock_guard<std::mutex> lock(m_stateLock);
    accountClose = selectCloseReasonLocked(reason);
    winningReason = m_closeReason;
    generation = m_socketGeneration;
    idleMilliseconds = m_heartbeat.idleMilliseconds(Heartbeat::Clock::now());
    socket = m_socket;
  }
  if(socket) {
    if (accountClose) ++ m_statistics->EVENT_PEER_TRANSPORT_CLOSED;
    OATPP_LOGi("heartbeat", "peer={} generation={} close_reason={} idle_ms={}", m_peerId, generation,
               static_cast<int>(winningReason), idleMilliseconds);
    socket->getConnection().invalidate();
  }
}

bool Peer::invalidateSocketIfCurrent(std::uint64_t generation, CloseReason reason) {
  std::shared_ptr<AsyncWebSocket> socket;
  std::int64_t idleMilliseconds = 0;
  CloseReason winningReason = CloseReason::NONE;
  bool accountClose = false;
  {
    std::lock_guard<std::mutex> lock(m_stateLock);
    if (generation != m_socketGeneration) return false;
    accountClose = selectCloseReasonLocked(reason);
    winningReason = m_closeReason;
    idleMilliseconds = m_heartbeat.idleMilliseconds(Heartbeat::Clock::now());
    socket = m_socket;
  }
  if (socket) {
    if (accountClose) ++m_statistics->EVENT_PEER_TRANSPORT_CLOSED;
    OATPP_LOGi("heartbeat", "peer={} generation={} close_reason={} idle_ms={}", m_peerId, generation,
               static_cast<int>(winningReason), idleMilliseconds);
    socket->getConnection().invalidate();
  }
  return socket != nullptr;
}

std::shared_ptr<oatpp::websocket::AsyncWebSocket> Peer::replaceSocket(
    const std::shared_ptr<oatpp::websocket::AsyncWebSocket>& socket) {
  if (!socket) return nullptr;
  std::lock_guard<std::mutex> transportLock(m_transportLock);
  std::lock_guard<std::mutex> lock(m_stateLock);
  auto previous = std::move(m_socket);
  m_socketGeneration = m_transportGeneration.replace(socket.get());
  m_socket = socket;
  m_messageBuffer.setCurrentPosition(0);
  m_closeReason = CloseReason::NONE;
  m_closeAccounting = TerminalCloseAccounting{};
  m_heartbeat.activate(Heartbeat::Clock::now(), m_socketGeneration);
  return previous;
}

bool Peer::detachIfCurrent(const std::shared_ptr<AsyncWebSocket>& socket, std::uint64_t generation) {
  std::lock_guard<std::mutex> transportLock(m_transportLock);
  std::lock_guard<std::mutex> lock(m_stateLock);
  if (!m_transportGeneration.isCurrent(socket.get(), generation) || socket != m_socket) return false;
  m_socket.reset();
  static_cast<void>(m_transportGeneration.detachIfCurrent(socket.get(), generation));
  return true;
}

bool Peer::detachIfCurrent(const std::shared_ptr<AsyncWebSocket>& socket) {
  std::lock_guard<std::mutex> transportLock(m_transportLock);
  std::lock_guard<std::mutex> lock(m_stateLock);
  if (!m_transportGeneration.isCurrent(socket.get(), m_socketGeneration) || socket != m_socket) return false;
  m_socket.reset();
  static_cast<void>(m_transportGeneration.detachIfCurrent(socket.get(), m_socketGeneration));
  return true;
}

std::uint64_t Peer::socketGeneration() const {
  std::lock_guard<std::mutex> lock(m_stateLock);
  return m_socketGeneration;
}

bool Peer::selectCloseReasonLocked(CloseReason reason) {
  if (m_closeReason == CloseReason::NONE) m_closeReason = reason;
  return m_closeAccounting.accountOnce();
}

void Peer::recordProtocolError() {
  bool accountClose = false;
  {
    std::lock_guard<std::mutex> lock(m_stateLock);
    accountClose = selectCloseReasonLocked(CloseReason::PROTOCOL_ERROR);
  }
  if (accountClose) ++ m_statistics->EVENT_PEER_TRANSPORT_CLOSED;
}

oatpp::async::CoroutineStarter Peer::onPing(const std::shared_ptr<AsyncWebSocket>& socket, const oatpp::String& message) {
  { std::lock_guard<std::mutex> lock(m_stateLock);
    if (socket != m_socket) return nullptr;
    m_heartbeat.inbound(Heartbeat::Clock::now(), m_socketGeneration); }
  return oatpp::async::synchronize(&m_writeLock, socket->sendPongAsync(message));
}

oatpp::async::CoroutineStarter Peer::onPong(const std::shared_ptr<AsyncWebSocket>& socket, const oatpp::String&) {
  std::lock_guard<std::mutex> lock(m_stateLock);
  if (socket == m_socket) m_heartbeat.inbound(Heartbeat::Clock::now(), m_socketGeneration);
  return nullptr; // do nothing
}

oatpp::async::CoroutineStarter Peer::onClose(const std::shared_ptr<AsyncWebSocket>& socket, v_uint16 code, const oatpp::String& detail) {
  std::lock_guard<std::mutex> lock(m_stateLock);
  if (socket == m_socket) {
    const bool accountClose = selectCloseReasonLocked(CloseReason::REMOTE_CLOSE);
    m_closeCode = code;
    m_closeDetail = boundedCloseDetail(detail);
    if (accountClose) ++ m_statistics->EVENT_PEER_TRANSPORT_CLOSED;
    OATPP_LOGi("heartbeat", "peer={} generation={} close_reason={} close_code={}", m_peerId,
               m_socketGeneration, static_cast<int>(m_closeReason), code);
  }
  return nullptr; // do nothing
}

oatpp::async::CoroutineStarter Peer::readMessage(const std::shared_ptr<AsyncWebSocket>& socket, v_uint8, p_char8 data, oatpp::v_io_size size) {
  // Keep the handoff fence through validation and command dispatch. A stale
  // callback either completes before replacement or observes a different
  // current socket; it can never consume the new transport's buffer/state.
  std::lock_guard<std::mutex> transportLock(m_transportLock);
  {
    std::lock_guard<std::mutex> lock(m_stateLock);
    if (socket != m_socket) return nullptr;
    m_heartbeat.inbound(Heartbeat::Clock::now(), m_socketGeneration);
  }

  const auto maxMessageSize = *m_appConfig->maxMessageSizeBytes;
  const auto currentPosition = m_messageBuffer.getCurrentPosition();
  if(size > 0 && (currentPosition < 0 ||
                  static_cast<v_uint64>(currentPosition) > maxMessageSize ||
                  static_cast<v_uint64>(size) > maxMessageSize - static_cast<v_uint64>(currentPosition))) {
    return onApiError("Message size exceeds max allowed size.");
  }

  if(size == 0) { // message transfer finished

    auto wholeMessage = m_messageBuffer.toString();
    m_messageBuffer.setCurrentPosition(0);

    oatpp::Object<MessageDto> message;

    try {
      message = m_objectMapper->readFromString<oatpp::Object<MessageDto>>(wholeMessage);
    } catch (const std::runtime_error& e) {
      return onApiError("Can't parse message");
    }

    if (!message) return onApiError("No message provided.");
    message->peerName = m_nickname;
    message->peerId = m_peerId;
    message->timestamp = oatpp::Environment::getMicroTickCount();

    return handleMessage(message);

  } else if(size > 0) { // message frame received
    m_messageBuffer.writeSimple(data, size);
  }

  return nullptr; // do nothing

}
