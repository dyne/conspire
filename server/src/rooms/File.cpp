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

#include "File.hpp"

#include "dto/DTOs.hpp"
#include "rooms/Peer.hpp"
#include "utils/ServerBoundaries.hpp"

#include <algorithm>
#include <vector>

File::Subscriber::Subscriber(v_int64 id, const std::shared_ptr<File>& file)
  : m_id(id)
  , m_file(file)
  , m_valid(true)
  , m_progress(0)
{
  m_waitList.setListener(&m_waitListListener);
}

void File::Subscriber::bindWaitListListener(const std::shared_ptr<Subscriber>& self) {
  m_waitListListener.bind(self);
}

File::Subscriber::~Subscriber() {
  m_file->unsubscribe(m_id);
}

conspire::boundaries::ChunkRequest::Result File::Subscriber::provideFileChunk(
    v_uint64 requestId, v_int64 position, v_int64 size, const oatpp::String& data) {
  std::lock_guard<std::mutex> lock(m_chunkLock);
  const auto result = m_request.accept(requestId, position, size, data ? data->size() : 0);
  if (result != conspire::boundaries::ChunkRequest::Result::ACCEPTED) return result;
  // A completed duplicate is accepted above without touching the buffered data.
  // A second distinct accepted chunk while it is still unread is impossible.
  if (m_chunk != nullptr) return conspire::boundaries::ChunkRequest::Result::INVALID;
  m_chunk = data;
  m_waitList.notifyAll();
  return result;
}

void File::Subscriber::requestChunk(v_int64 size) {

  if(m_valid) {

    const auto requestId = m_request.begin(m_progress, size);
    auto message = MessageDto::createShared();
    message->code = MessageCodes::CODE_FILE_REQUEST_CHUNK;

    message->files = MessageDto::FilesList::createShared();

    auto file = FileDto::createShared();
    file->clientFileId = m_file->m_clientFileId;
    file->serverFileId = m_file->m_serverFileId;
    file->subscriberId = m_id;

    file->chunkPosition = m_progress;
    file->chunkSize = size;
    file->chunkRequestId = requestId;

    message->files->push_back(file);

    if (const auto host = m_file->m_host.lock()) host->sendMessageAsync(message);
    else {
      m_valid = false;
      m_request.cancel();
      m_waitList.notifyAll();
    }

  }

}

void File::Subscriber::reissueOutstandingRequest() {
  std::lock_guard<std::mutex> lock(m_chunkLock);
  if (!m_valid || !m_request.outstanding()) return;
  requestChunk(m_request.requestSize());
}

oatpp::async::CoroutineStarter File::Subscriber::waitForChunkAsync() {

  class WaitCoroutine : public oatpp::async::Coroutine<WaitCoroutine> {
  private:
    std::shared_ptr<Subscriber> m_subscriber;
  public:

    explicit WaitCoroutine(std::shared_ptr<Subscriber> subscriber)
      : m_subscriber(std::move(subscriber))
    {}

    Action act() override {
      std::lock_guard<std::mutex> lock(m_subscriber->m_chunkLock);
      if(m_subscriber->m_chunk || !m_subscriber->m_valid) {
        return finish();
      }
      return Action::createWaitListAction(&m_subscriber->m_waitList);
    }

  };

  return WaitCoroutine::start(shared_from_this());

}

oatpp::v_io_size File::Subscriber::readChunk(void *buffer, v_buff_size count, oatpp::async::Action& action) {

  std::lock_guard<std::mutex> lock(m_chunkLock);

  if(!m_valid) {
    throw std::runtime_error("File is not valid any more.");
  }

  if(m_progress < m_file->getFileSize()) {

    if (m_chunk) {
      const auto chunkBytes = m_chunk->size();
      const auto chunkSize = static_cast<v_int64>(chunkBytes);
      if(chunkSize > count) {
        throw std::runtime_error("Invalid chunk size");
      }
      std::memcpy(buffer, m_chunk->data(), chunkBytes);
      m_progress += chunkSize;
      m_chunk = nullptr;
      return chunkSize;
    }

    const auto remaining = static_cast<v_buff_size>(m_file->getFileSize() - m_progress);
    const auto boundedCount = std::min<v_buff_size>(
      count, static_cast<v_buff_size>(conspire::boundaries::Limits::chunkBytes));
    const auto requestSize = static_cast<v_int64>(std::min<v_buff_size>(boundedCount, remaining));
    requestChunk(requestSize);
    action = waitForChunkAsync().next(oatpp::async::Action::createActionByType(oatpp::async::Action::TYPE_REPEAT));
    return oatpp::IOError::RETRY_READ;

  }

  return 0;

}

v_int64 File::Subscriber::getId() {
  return m_id;
}

void File::Subscriber::invalidate() {
  std::lock_guard<std::mutex> lock(m_chunkLock);
  m_valid = false;
  m_request.cancel();
  m_waitList.notifyAll();
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// File

File::File(const std::shared_ptr<Peer>& host,
           v_int64 clientFileId,
           v_int64 serverFileId,
           const oatpp::String& fileName,
           v_int64 fileSize)
  : m_host(host)
  , m_clientFileId(clientFileId)
  , m_serverFileId(serverFileId)
  , m_fileName(fileName)
  , m_fileSize(fileSize)
  , m_subscriberIdCounter(1)
{}

void File::unsubscribe(v_int64 id) {
  std::lock_guard<std::mutex> lock(m_subscribersLock);
  m_subscribers.erase(id);
}

std::shared_ptr<File::Subscriber> File::subscribe() {
  std::lock_guard<std::mutex> lock(m_subscribersLock);
  if (!m_available) return nullptr;
  if (!conspire::boundaries::hasCapacity(m_subscribers.size(), conspire::boundaries::Limits::subscribersPerFile)) return nullptr;
  auto s = std::make_shared<Subscriber>(m_subscriberIdCounter ++, shared_from_this());
  s->bindWaitListListener(s);
  m_subscribers[s->getId()] = s;
  return s;
}

conspire::boundaries::ChunkRequest::Result File::provideFileChunk(v_int64 subscriberId, v_uint64 requestId,
                                                                   v_int64 position, v_int64 size,
                                                                   const oatpp::String& data) {

  std::shared_ptr<Subscriber> subscriber;
  {
    std::lock_guard<std::mutex> lock(m_subscribersLock);
    auto it = m_subscribers.find(subscriberId);
    if (it == m_subscribers.end()) return conspire::boundaries::ChunkRequest::Result::INVALID;
    subscriber = it->second.lock();
    if (!subscriber) {
      m_subscribers.erase(it);
      return conspire::boundaries::ChunkRequest::Result::INVALID;
    }
  }
  return subscriber->provideFileChunk(requestId, position, size, data);

}

std::shared_ptr<Peer> File::getHost() {
  return m_host.lock();
}

v_int64 File::getClientFileId() {
  return m_clientFileId;
}

v_int64 File::getServerFileId() {
  return m_serverFileId;
}

oatpp::String File::getFileName() {
  return m_fileName;
}

v_int64 File::getFileSize() {
  return m_fileSize;
}

void File::clearSubscribers() {
  std::vector<std::shared_ptr<Subscriber>> subscribers;
  {
    std::lock_guard<std::mutex> lock(m_subscribersLock);
    // This is the withdrawal/destruction boundary.  A request that already
    // looked the file up cannot register after this point; one registered
    // before it is included below and awakened by invalidate().
    m_available = false;
    subscribers.reserve(m_subscribers.size());
    for (auto& entry : m_subscribers) {
      if (auto subscriber = entry.second.lock()) subscribers.push_back(std::move(subscriber));
    }
    m_subscribers.clear();
  }
  for (const auto& subscriber : subscribers) subscriber->invalidate();
}

void File::reissueOutstandingRequests() {
  std::vector<std::shared_ptr<Subscriber>> subscribers;
  {
    std::lock_guard<std::mutex> lock(m_subscribersLock);
    subscribers.reserve(m_subscribers.size());
    for (auto it = m_subscribers.begin(); it != m_subscribers.end();) {
      if (auto subscriber = it->second.lock()) {
        subscribers.push_back(std::move(subscriber));
        ++it;
      } else {
        it = m_subscribers.erase(it);
      }
    }
  }
  for (const auto& subscriber : subscribers) subscriber->reissueOutstandingRequest();
}
