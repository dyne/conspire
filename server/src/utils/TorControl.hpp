#ifndef CONSPIRE_UTILS_TOR_CONTROL_HPP
#define CONSPIRE_UTILS_TOR_CONTROL_HPP

#include <chrono>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace conspire::tor {

struct Options {
  std::string controlSocket = "/run/tor/control";
  std::string controlHost = "127.0.0.1";
  std::uint16_t controlPort = 9051;
  std::string keyPath = "conspire-onion.key";
  std::string targetHost = "127.0.0.1";
  std::uint16_t targetPort = 8080;
  std::uint16_t virtualPort = 80;
  std::chrono::milliseconds timeout{2000};
};

struct Reply {
  int status = 0;
  std::vector<std::string> lines;
};

bool validServiceId(std::string_view serviceId);
bool validPrivateKey(std::string_view privateKey);
std::string replyValue(const Reply& reply, std::string_view prefix);

class OnionService {
private:
  int m_descriptor = -1;
  std::string m_serviceId;
  std::string m_hostname;
  std::string m_controlEndpoint;
  std::string m_readBuffer;

  bool connectControl(const Options& options, std::string& error);
  bool authenticate(std::string& error);
  bool add(const Options& options, std::string& error);
  bool sendCommand(std::string_view command, Reply& reply, std::string& error);
  bool writeCommand(std::string_view command, std::string& error);
  bool readReply(Reply& reply, std::string& error);
  bool readLine(std::string& line, std::string& error);
  void closeConnection() noexcept;

public:
  OnionService() = default;
  OnionService(const OnionService&) = delete;
  OnionService& operator=(const OnionService&) = delete;
  ~OnionService();

  bool start(const Options& options, std::string& error);
  void stop() noexcept;
  bool active() const { return m_descriptor >= 0 && !m_serviceId.empty(); }
  const std::string& hostname() const { return m_hostname; }
  const std::string& controlEndpoint() const { return m_controlEndpoint; }
};

} // namespace conspire::tor

#endif
