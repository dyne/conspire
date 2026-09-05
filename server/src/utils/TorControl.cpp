#include "TorControl.hpp"

#include <algorithm>
#include <array>
#include <cerrno>
#include <cctype>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include <fcntl.h>
#include <netdb.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <sys/un.h>
#include <unistd.h>

#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/hmac.h>
#include <openssl/rand.h>

namespace conspire::tor {
namespace {

constexpr std::size_t MAX_LINE_BYTES = 8192;
constexpr std::size_t MAX_REPLY_BYTES = 64 * 1024;
constexpr std::size_t COOKIE_BYTES = 32;
constexpr std::size_t NONCE_BYTES = 32;
constexpr std::string_view SERVER_HASH_KEY =
    "Tor safe cookie authentication server-to-controller hash";
constexpr std::string_view CLIENT_HASH_KEY =
    "Tor safe cookie authentication controller-to-server hash";

class Descriptor {
private:
  int m_value = -1;
public:
  explicit Descriptor(int value = -1) : m_value(value) {}
  Descriptor(const Descriptor&) = delete;
  Descriptor& operator=(const Descriptor&) = delete;
  ~Descriptor() { if (m_value >= 0) ::close(m_value); }
  int get() const { return m_value; }
  int release() { const int value = m_value; m_value = -1; return value; }
};

std::string socketError(std::string_view action) {
  return std::string(action) + ": " + std::strerror(errno);
}

bool waitForConnect(int descriptor, std::chrono::milliseconds timeout,
                    std::string& error) {
  pollfd event{descriptor, POLLOUT, 0};
  const auto timeoutCount = timeout.count();
  const int boundedTimeout = timeoutCount > 30000 ? 30000 :
      timeoutCount < 1 ? 1 : static_cast<int>(timeoutCount);
  int result;
  do {
    result = ::poll(&event, 1, boundedTimeout);
  } while (result < 0 && errno == EINTR);
  if (result == 0) {
    error = "Tor control connection timed out";
    return false;
  }
  if (result < 0) {
    error = socketError("polling Tor control connection");
    return false;
  }
  int socketStatus = 0;
  socklen_t statusSize = sizeof(socketStatus);
  if (::getsockopt(descriptor, SOL_SOCKET, SO_ERROR, &socketStatus, &statusSize) != 0) {
    error = socketError("checking Tor control connection");
    return false;
  }
  if (socketStatus != 0) {
    error = "connecting to Tor control endpoint: " +
        std::string(std::strerror(socketStatus));
    return false;
  }
  return true;
}

bool connectWithTimeout(int descriptor, const sockaddr* address,
                        socklen_t addressSize, std::chrono::milliseconds timeout,
                        std::string& error) {
  const int flags = ::fcntl(descriptor, F_GETFL, 0);
  if (flags < 0 || ::fcntl(descriptor, F_SETFL, flags | O_NONBLOCK) != 0) {
    error = socketError("configuring Tor control socket");
    return false;
  }
  int result;
  do {
    result = ::connect(descriptor, address, addressSize);
  } while (result < 0 && errno == EINTR);
  if (result < 0 && errno != EINPROGRESS) {
    error = socketError("connecting to Tor control endpoint");
    return false;
  }
  if (result < 0 && !waitForConnect(descriptor, timeout, error)) return false;
  if (::fcntl(descriptor, F_SETFL, flags) != 0) {
    error = socketError("restoring Tor control socket flags");
    return false;
  }

  const auto seconds = timeout.count() / 1000;
  const auto microseconds = (timeout.count() % 1000) * 1000;
  timeval socketTimeout{static_cast<time_t>(seconds),
                        static_cast<suseconds_t>(microseconds)};
  if (::setsockopt(descriptor, SOL_SOCKET, SO_RCVTIMEO, &socketTimeout,
                   sizeof(socketTimeout)) != 0 ||
      ::setsockopt(descriptor, SOL_SOCKET, SO_SNDTIMEO, &socketTimeout,
                   sizeof(socketTimeout)) != 0) {
    error = socketError("setting Tor control socket timeout");
    return false;
  }
  return true;
}

std::optional<int> connectUnix(std::string_view path,
                               std::chrono::milliseconds timeout,
                               std::string& error) {
  if (path.empty() || path.size() >= sizeof(sockaddr_un::sun_path)) {
    error = "Tor control socket path is empty or too long";
    return std::nullopt;
  }
  Descriptor descriptor(::socket(AF_UNIX, SOCK_STREAM, 0));
  if (descriptor.get() < 0) {
    error = socketError("creating Tor Unix control socket");
    return std::nullopt;
  }
  sockaddr_un address{};
  address.sun_family = AF_UNIX;
  std::memcpy(address.sun_path, path.data(), path.size());
  address.sun_path[path.size()] = '\0';
  if (!connectWithTimeout(descriptor.get(), reinterpret_cast<sockaddr*>(&address),
                          sizeof(address), timeout, error)) return std::nullopt;
  return descriptor.release();
}

std::optional<int> connectTcp(std::string_view host, std::uint16_t port,
                              std::chrono::milliseconds timeout,
                              std::string& error) {
  addrinfo hints{};
  hints.ai_family = AF_UNSPEC;
  hints.ai_socktype = SOCK_STREAM;
  hints.ai_protocol = IPPROTO_TCP;
  addrinfo* addresses = nullptr;
  const auto service = std::to_string(port);
  const std::string hostString(host);
  const int lookup = ::getaddrinfo(hostString.c_str(), service.c_str(), &hints,
                                   &addresses);
  if (lookup != 0) {
    error = "resolving Tor control host: " + std::string(gai_strerror(lookup));
    return std::nullopt;
  }
  std::unique_ptr<addrinfo, decltype(&::freeaddrinfo)> owned(addresses,
                                                             ::freeaddrinfo);
  for (auto* address = addresses; address; address = address->ai_next) {
    Descriptor descriptor(::socket(address->ai_family, address->ai_socktype,
                                   address->ai_protocol));
    if (descriptor.get() < 0) continue;
    std::string candidateError;
    if (connectWithTimeout(descriptor.get(), address->ai_addr,
                           static_cast<socklen_t>(address->ai_addrlen), timeout,
                           candidateError)) return descriptor.release();
    error = std::move(candidateError);
  }
  if (error.empty()) error = "no usable Tor control address";
  return std::nullopt;
}

std::string hexEncode(const unsigned char* data, std::size_t size) {
  static constexpr char HEX[] = "0123456789ABCDEF";
  std::string encoded(size * 2, '0');
  for (std::size_t index = 0; index < size; ++index) {
    encoded[index * 2] = HEX[data[index] >> 4];
    encoded[index * 2 + 1] = HEX[data[index] & 0x0f];
  }
  return encoded;
}

std::optional<std::vector<unsigned char>> hexDecode(std::string_view text) {
  if (text.empty() || text.size() % 2 != 0) return std::nullopt;
  std::vector<unsigned char> decoded(text.size() / 2);
  const auto nibble = [](char character) -> int {
    if (character >= '0' && character <= '9') return character - '0';
    if (character >= 'a' && character <= 'f') return character - 'a' + 10;
    if (character >= 'A' && character <= 'F') return character - 'A' + 10;
    return -1;
  };
  for (std::size_t index = 0; index < decoded.size(); ++index) {
    const int high = nibble(text[index * 2]);
    const int low = nibble(text[index * 2 + 1]);
    if (high < 0 || low < 0) return std::nullopt;
    decoded[index] = static_cast<unsigned char>((high << 4) | low);
  }
  return decoded;
}

std::array<unsigned char, EVP_MAX_MD_SIZE> hmacSha256(
    std::string_view key, const std::vector<unsigned char>& message,
    unsigned int& outputSize) {
  std::array<unsigned char, EVP_MAX_MD_SIZE> output{};
  HMAC(EVP_sha256(), key.data(), static_cast<int>(key.size()), message.data(),
       message.size(), output.data(), &outputSize);
  return output;
}

std::optional<std::string> quotedValue(std::string_view line,
                                       std::string_view name) {
  const auto start = line.find(name);
  if (start == std::string_view::npos) return std::nullopt;
  std::size_t position = start + name.size();
  if (position >= line.size() || line[position] != '"') return std::nullopt;
  ++position;
  std::string value;
  while (position < line.size()) {
    const char character = line[position++];
    if (character == '"') return value;
    if (character != '\\') {
      value.push_back(character);
      continue;
    }
    if (position >= line.size()) return std::nullopt;
    const char escaped = line[position++];
    switch (escaped) {
      case 'n': value.push_back('\n'); break;
      case 'r': value.push_back('\r'); break;
      case 't': value.push_back('\t'); break;
      case '\\': value.push_back('\\'); break;
      case '"': value.push_back('"'); break;
      default:
        if (escaped < '0' || escaped > '7') {
          value.push_back(escaped);
          break;
        }
        unsigned int octet = static_cast<unsigned int>(escaped - '0');
        for (int count = 1; count < 3 && position < line.size() &&
             line[position] >= '0' && line[position] <= '7'; ++count) {
          octet = octet * 8 + static_cast<unsigned int>(line[position++] - '0');
        }
        if (octet > 255) return std::nullopt;
        value.push_back(static_cast<char>(octet));
    }
  }
  return std::nullopt;
}

std::optional<std::array<unsigned char, COOKIE_BYTES>> readCookie(
    const std::string& path) {
  std::ifstream input(path, std::ios::binary | std::ios::ate);
  if (!input || input.tellg() != static_cast<std::streamoff>(COOKIE_BYTES)) {
    return std::nullopt;
  }
  std::array<unsigned char, COOKIE_BYTES> cookie{};
  input.seekg(0, std::ios::beg);
  if (!input.read(reinterpret_cast<char*>(cookie.data()),
                  static_cast<std::streamsize>(cookie.size()))) return std::nullopt;
  return cookie;
}

bool writeAll(int descriptor, std::string_view content) {
  std::size_t written = 0;
  while (written < content.size()) {
    const auto result = ::write(descriptor, content.data() + written,
                                content.size() - written);
    if (result < 0) {
      if (errno == EINTR) continue;
      return false;
    }
    if (result == 0) return false;
    written += static_cast<std::size_t>(result);
  }
  return true;
}

bool savePrivateKey(const std::string& path, std::string_view privateKey) {
  if (path.empty() || !validPrivateKey(privateKey)) return false;
  const auto parent = std::filesystem::path(path).parent_path();
  std::error_code filesystemError;
  if (!parent.empty()) {
    std::filesystem::create_directories(parent, filesystemError);
    if (filesystemError) return false;
  }
  std::vector<char> temporary(path.begin(), path.end());
  constexpr std::string_view suffix = ".tmp.XXXXXX";
  temporary.insert(temporary.end(), suffix.begin(), suffix.end());
  temporary.push_back('\0');
  const int descriptor = ::mkstemp(temporary.data());
  if (descriptor < 0) return false;
  const std::string content = std::string(privateKey) + '\n';
  bool success = ::fchmod(descriptor, S_IRUSR | S_IWUSR) == 0 &&
      writeAll(descriptor, content) && ::fsync(descriptor) == 0;
  if (::close(descriptor) != 0) success = false;
  if (success && ::rename(temporary.data(), path.c_str()) != 0) success = false;
  if (!success) ::unlink(temporary.data());
  return success;
}

enum class KeyLoadResult { MISSING, VALID, INVALID };

KeyLoadResult loadPrivateKey(const std::string& path, std::string& privateKey) {
  const int rawDescriptor = ::open(path.c_str(), O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (rawDescriptor < 0) {
    return errno == ENOENT ? KeyLoadResult::MISSING : KeyLoadResult::INVALID;
  }
  Descriptor descriptor(rawDescriptor);
  struct stat metadata {};
  if (::fstat(descriptor.get(), &metadata) != 0 || !S_ISREG(metadata.st_mode) ||
      (metadata.st_mode & 077) != 0 || metadata.st_size <= 0 ||
      metadata.st_size > 1024) {
    return KeyLoadResult::INVALID;
  }
  privateKey.assign(static_cast<std::size_t>(metadata.st_size), '\0');
  std::size_t consumed = 0;
  while (consumed < privateKey.size()) {
    const auto result = ::read(descriptor.get(), privateKey.data() + consumed,
                               privateKey.size() - consumed);
    if (result < 0) {
      if (errno == EINTR) continue;
      return KeyLoadResult::INVALID;
    }
    if (result == 0) return KeyLoadResult::INVALID;
    consumed += static_cast<std::size_t>(result);
  }
  while (!privateKey.empty() &&
         (privateKey.back() == '\n' || privateKey.back() == '\r')) {
    privateKey.pop_back();
  }
  return validPrivateKey(privateKey) ? KeyLoadResult::VALID :
                                      KeyLoadResult::INVALID;
}

bool containsMethod(std::string_view methods, std::string_view method) {
  std::size_t position = 0;
  while (position <= methods.size()) {
    const auto end = methods.find(',', position);
    const auto token = methods.substr(position, end == std::string_view::npos ?
        methods.size() - position : end - position);
    if (token == method) return true;
    if (end == std::string_view::npos) break;
    position = end + 1;
  }
  return false;
}

std::string fieldValue(std::string_view line, std::string_view field) {
  const auto start = line.find(field);
  if (start == std::string_view::npos) return {};
  const auto valueStart = start + field.size();
  const auto end = line.find(' ', valueStart);
  return std::string(line.substr(valueStart, end == std::string_view::npos ?
      line.size() - valueStart : end - valueStart));
}

} // namespace

bool validServiceId(std::string_view serviceId) {
  if (serviceId.size() != 56) return false;
  return std::all_of(serviceId.begin(), serviceId.end(), [](char character) {
    return (character >= 'a' && character <= 'z') ||
           (character >= '2' && character <= '7');
  });
}

bool validPrivateKey(std::string_view privateKey) {
  constexpr std::string_view prefix = "ED25519-V3:";
  constexpr std::size_t encodedKeyBytes = 88;
  if (privateKey.size() != prefix.size() + encodedKeyBytes ||
      privateKey.substr(0, prefix.size()) != prefix ||
      privateKey.substr(privateKey.size() - 2) != "==") return false;
  const auto keyEnd = privateKey.end() - 2;
  return std::all_of(privateKey.begin() + static_cast<std::ptrdiff_t>(prefix.size()),
                     keyEnd, [](char character) {
    return (character >= 'A' && character <= 'Z') ||
           (character >= 'a' && character <= 'z') ||
           (character >= '0' && character <= '9') || character == '+' ||
           character == '/';
  });
}

std::string replyValue(const Reply& reply, std::string_view prefix) {
  for (const auto& line : reply.lines) {
    if (line.compare(0, prefix.size(), prefix) == 0) {
      return line.substr(prefix.size());
    }
  }
  return {};
}

OnionService::~OnionService() { stop(); }

bool OnionService::connectControl(const Options& options, std::string& error) {
  std::string unixError;
  if (!options.controlSocket.empty()) {
    auto descriptor = connectUnix(options.controlSocket, options.timeout, unixError);
    if (descriptor) {
      m_descriptor = *descriptor;
      m_controlEndpoint = "unix:" + options.controlSocket;
      return true;
    }
  }
  std::string tcpError;
  auto descriptor = connectTcp(options.controlHost, options.controlPort,
                               options.timeout, tcpError);
  if (descriptor) {
    m_descriptor = *descriptor;
    m_controlEndpoint = "tcp:" + options.controlHost + ":" +
        std::to_string(options.controlPort);
    return true;
  }
  error = "Tor control unavailable";
  if (!unixError.empty()) error += " (Unix: " + unixError + ")";
  if (!tcpError.empty()) error += " (TCP: " + tcpError + ")";
  return false;
}

bool OnionService::writeCommand(std::string_view command, std::string& error) {
  if (command.empty() || command.size() > MAX_LINE_BYTES ||
      command.find('\r') != std::string_view::npos ||
      command.find('\n') != std::string_view::npos) {
    error = "refusing invalid Tor control command";
    return false;
  }
  const std::string framed = std::string(command) + "\r\n";
  std::size_t written = 0;
  while (written < framed.size()) {
    const auto result = ::send(m_descriptor, framed.data() + written,
                               framed.size() - written, MSG_NOSIGNAL);
    if (result < 0) {
      if (errno == EINTR) continue;
      error = socketError("writing Tor control command");
      return false;
    }
    if (result == 0) {
      error = "Tor control connection closed while writing";
      return false;
    }
    written += static_cast<std::size_t>(result);
  }
  return true;
}

bool OnionService::readLine(std::string& line, std::string& error) {
  while (true) {
    const auto lineEnd = m_readBuffer.find("\r\n");
    if (lineEnd != std::string::npos) {
      line = m_readBuffer.substr(0, lineEnd);
      m_readBuffer.erase(0, lineEnd + 2);
      return true;
    }
    if (m_readBuffer.size() >= MAX_LINE_BYTES) {
      error = "Tor control reply line exceeds limit";
      return false;
    }
    std::array<char, 2048> chunk{};
    const auto received = ::recv(m_descriptor, chunk.data(), chunk.size(), 0);
    if (received < 0) {
      if (errno == EINTR) continue;
      error = socketError("reading Tor control reply");
      return false;
    }
    if (received == 0) {
      error = "Tor control connection closed while reading";
      return false;
    }
    m_readBuffer.append(chunk.data(), static_cast<std::size_t>(received));
  }
}

bool OnionService::readReply(Reply& reply, std::string& error) {
  reply = {};
  std::size_t total = 0;
  while (true) {
    std::string line;
    if (!readLine(line, error)) return false;
    total += line.size();
    if (total > MAX_REPLY_BYTES || line.size() < 4 ||
        !std::isdigit(static_cast<unsigned char>(line[0])) ||
        !std::isdigit(static_cast<unsigned char>(line[1])) ||
        !std::isdigit(static_cast<unsigned char>(line[2]))) {
      error = "malformed Tor control reply";
      return false;
    }
    const int status = (line[0] - '0') * 100 + (line[1] - '0') * 10 +
        (line[2] - '0');
    if (reply.status == 0) reply.status = status;
    if (status != reply.status || (line[3] != '-' && line[3] != ' ')) {
      error = "unsupported Tor control reply framing";
      return false;
    }
    reply.lines.push_back(line.substr(4));
    if (line[3] == ' ') return true;
  }
}

bool OnionService::sendCommand(std::string_view command, Reply& reply,
                               std::string& error) {
  if (!writeCommand(command, error) || !readReply(reply, error)) return false;
  if (reply.status != 250) {
    error = "Tor rejected " + std::string(command.substr(0, command.find(' '))) +
        " with status " + std::to_string(reply.status);
    if (!reply.lines.empty()) error += ": " + reply.lines.back();
    return false;
  }
  return true;
}

bool OnionService::authenticate(std::string& error) {
  Reply protocolInfo;
  if (!sendCommand("PROTOCOLINFO 1", protocolInfo, error)) return false;
  std::string authLine;
  for (const auto& line : protocolInfo.lines) {
    if (line.compare(0, 5, "AUTH ") == 0) {
      authLine = line;
      break;
    }
  }
  const auto methodsStart = authLine.find("METHODS=");
  if (methodsStart == std::string::npos) {
    error = "Tor PROTOCOLINFO omitted authentication methods";
    return false;
  }
  const auto methodsValueStart = methodsStart + 8;
  const auto methodsEnd = authLine.find(' ', methodsValueStart);
  const auto methods = std::string_view(authLine).substr(methodsValueStart,
      methodsEnd == std::string::npos ? authLine.size() - methodsValueStart :
                                       methodsEnd - methodsValueStart);

  Reply authentication;
  if (containsMethod(methods, "SAFECOOKIE")) {
    const auto cookiePath = quotedValue(authLine, "COOKIEFILE=");
    if (!cookiePath) {
      error = "Tor SAFECOOKIE did not provide a valid cookie path";
      return false;
    }
    const auto cookie = readCookie(*cookiePath);
    if (!cookie) {
      error = "Tor SAFECOOKIE file is unreadable or not 32 bytes";
      return false;
    }
    std::array<unsigned char, NONCE_BYTES> clientNonce{};
    if (RAND_bytes(clientNonce.data(), static_cast<int>(clientNonce.size())) != 1) {
      error = "failed to generate Tor SAFECOOKIE nonce";
      return false;
    }
    Reply challenge;
    if (!sendCommand("AUTHCHALLENGE SAFECOOKIE " +
        hexEncode(clientNonce.data(), clientNonce.size()), challenge, error)) {
      return false;
    }
    if (challenge.lines.empty()) {
      error = "Tor SAFECOOKIE challenge reply is empty";
      return false;
    }
    const auto serverHash = hexDecode(fieldValue(challenge.lines.front(),
                                                  "SERVERHASH="));
    const auto serverNonce = hexDecode(fieldValue(challenge.lines.front(),
                                                   "SERVERNONCE="));
    if (!serverHash || serverHash->size() != 32 || !serverNonce ||
        serverNonce->size() != NONCE_BYTES) {
      error = "Tor SAFECOOKIE challenge reply is malformed";
      return false;
    }
    std::vector<unsigned char> message;
    message.reserve(cookie->size() + clientNonce.size() + serverNonce->size());
    message.insert(message.end(), cookie->begin(), cookie->end());
    message.insert(message.end(), clientNonce.begin(), clientNonce.end());
    message.insert(message.end(), serverNonce->begin(), serverNonce->end());
    unsigned int hashSize = 0;
    const auto expectedServerHash = hmacSha256(SERVER_HASH_KEY, message, hashSize);
    if (hashSize != serverHash->size() ||
        CRYPTO_memcmp(expectedServerHash.data(), serverHash->data(), hashSize) != 0) {
      error = "Tor SAFECOOKIE server authentication failed";
      return false;
    }
    const auto clientHash = hmacSha256(CLIENT_HASH_KEY, message, hashSize);
    if (!sendCommand("AUTHENTICATE " +
        hexEncode(clientHash.data(), hashSize), authentication, error)) return false;
    return true;
  }
  if (containsMethod(methods, "NULL") &&
      m_controlEndpoint.compare(0, 5, "unix:") == 0) {
    return sendCommand("AUTHENTICATE", authentication, error);
  }
  error = "Tor control endpoint offers neither SAFECOOKIE nor "
          "permission-protected Unix NULL authentication";
  return false;
}

bool OnionService::add(const Options& options, std::string& error) {
  std::string privateKey;
  const auto keyResult = loadPrivateKey(options.keyPath, privateKey);
  if (keyResult == KeyLoadResult::INVALID) {
    error = "Tor onion key is invalid or unreadable: " + options.keyPath;
    return false;
  }
  const bool generating = keyResult == KeyLoadResult::MISSING;
  const std::string key = generating ? "NEW:ED25519-V3" : privateKey;
  Reply added;
  const std::string command = "ADD_ONION " + key + " Port=" +
      std::to_string(options.virtualPort) + "," + options.targetHost + ":" +
      std::to_string(options.targetPort);
  if (!sendCommand(command, added, error)) return false;
  const auto serviceId = replyValue(added, "ServiceID=");
  if (!validServiceId(serviceId)) {
    error = "Tor returned an invalid v3 onion service ID";
    return false;
  }
  if (generating) {
    const auto returnedKey = replyValue(added, "PrivateKey=");
    if (!validPrivateKey(returnedKey)) {
      error = "Tor did not return a valid persistent ED25519-V3 key";
      return false;
    }
    if (!savePrivateKey(options.keyPath, returnedKey)) {
      Reply ignored;
      std::string ignoredError;
      static_cast<void>(sendCommand("DEL_ONION " + serviceId, ignored,
                                    ignoredError));
      error = "failed to persist Tor onion key at " + options.keyPath;
      return false;
    }
  }
  m_serviceId = serviceId;
  m_hostname = serviceId + ".onion";
  return true;
}

bool OnionService::start(const Options& options, std::string& error) {
  stop();
  error.clear();
  if (!connectControl(options, error) || !authenticate(error) ||
      !add(options, error)) {
    closeConnection();
    return false;
  }
  return true;
}

void OnionService::closeConnection() noexcept {
  if (m_descriptor >= 0) ::close(m_descriptor);
  m_descriptor = -1;
  m_readBuffer.clear();
  m_controlEndpoint.clear();
}

void OnionService::stop() noexcept {
  if (m_descriptor >= 0 && !m_serviceId.empty()) {
    Reply ignored;
    std::string ignoredError;
    static_cast<void>(sendCommand("DEL_ONION " + m_serviceId, ignored,
                                  ignoredError));
    static_cast<void>(writeCommand("QUIT", ignoredError));
  }
  closeConnection();
  m_serviceId.clear();
  m_hostname.clear();
}

} // namespace conspire::tor
