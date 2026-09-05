#ifndef CONSPIRE_UTILS_APP_CONFIG_HPP
#define CONSPIRE_UTILS_APP_CONFIG_HPP

#include "dto/Config.hpp"
#include "utils/ConfigValidation.hpp"

#include "oatpp/base/CommandLineArguments.hpp"

#include <cstdlib>
#include <filesystem>
#include <stdexcept>

namespace conspire::config {

inline oatpp::Object<ConfigDto> fromCommandLine(const oatpp::base::CommandLineArguments& arguments) {
  auto config = ConfigDto::createShared();
  config->useTLS = arguments.hasArgument("--tls");
  config->host = std::getenv("EXTERNAL_ADDRESS");
  if (!config->host) config->host = arguments.getNamedArgumentValue("--host", "localhost");
  if (!config->host || !validHost(*config->host)) throw std::runtime_error("Invalid host!");

  const char* portText = std::getenv("EXTERNAL_PORT");
  if (!portText) portText = arguments.getNamedArgumentValue("--port", config->useTLS ? "8443" : "8080");
  const auto port = parsePort(portText ? portText : "");
  if (!port) throw std::runtime_error("Invalid port!");
  config->port = *port;

  if (config->useTLS) {
    config->tlsPrivateKeyPath = std::getenv("TLS_FILE_PRIVATE_KEY");
    if (!config->tlsPrivateKeyPath) config->tlsPrivateKeyPath = arguments.getNamedArgumentValue("--tls-key", "" CERT_PEM_PATH);
    config->tlsCertificateChainPath = std::getenv("TLS_FILE_CERT_CHAIN");
    if (!config->tlsCertificateChainPath) config->tlsCertificateChainPath = arguments.getNamedArgumentValue("--tls-chain", "" CERT_CRT_PATH);
  }
  config->statisticsUrl = std::getenv("URL_STATS_PATH");
  if (!config->statisticsUrl) config->statisticsUrl = arguments.getNamedArgumentValue("--url-stats", "admin/stats.json");
  if (!config->statisticsUrl || !validStatsPath(*config->statisticsUrl)) throw std::runtime_error("Invalid statistics path!");
  config->statisticsStatePath = std::getenv("STATS_STATE_PATH");
  if (!config->statisticsStatePath) {
    config->statisticsStatePath = arguments.getNamedArgumentValue("--stats-state");
  }
  if (arguments.hasArgument("--stats-state") && !config->statisticsStatePath) {
    throw std::runtime_error("Missing statistics state path!");
  }
  if (config->statisticsStatePath && !validStateFilePath(*config->statisticsStatePath)) {
    throw std::runtime_error("Invalid statistics state path!");
  }

  config->torEnabled = !arguments.hasArgument("--no-tor");
  config->torControlSocket = std::getenv("TOR_CONTROL_SOCKET");
  if (!config->torControlSocket) {
    config->torControlSocket = arguments.getNamedArgumentValue(
        "--tor-control-socket", "/run/tor/control");
  }
  if (arguments.hasArgument("--tor-control-socket") && !config->torControlSocket) {
    throw std::runtime_error("Missing Tor control socket path!");
  }
  if (config->torControlSocket && !validStateFilePath(*config->torControlSocket)) {
    throw std::runtime_error("Invalid Tor control socket path!");
  }

  config->torControlHost = std::getenv("TOR_CONTROL_HOST");
  if (!config->torControlHost) {
    config->torControlHost = arguments.getNamedArgumentValue(
        "--tor-control-host", "127.0.0.1");
  }
  if (!config->torControlHost || !validLoopbackHost(*config->torControlHost)) {
    throw std::runtime_error("Tor control host must be loopback!");
  }
  const char* torControlPortText = std::getenv("TOR_CONTROL_PORT");
  if (!torControlPortText) {
    torControlPortText = arguments.getNamedArgumentValue("--tor-control-port", "9051");
  }
  const auto torControlPort = parsePort(torControlPortText ? torControlPortText : "");
  if (!torControlPort || *torControlPort == 0) {
    throw std::runtime_error("Invalid Tor control port!");
  }
  config->torControlPort = *torControlPort;

  const char* torBackendPortText = std::getenv("TOR_BACKEND_PORT");
  std::string defaultTorBackendPort(portText);
  if (config->useTLS) {
    defaultTorBackendPort = *config->port == 8080 ? "8081" : "8080";
  }
  if (!torBackendPortText) {
    torBackendPortText = arguments.getNamedArgumentValue(
        "--tor-backend-port", defaultTorBackendPort.c_str());
  }
  const auto torBackendPort = parsePort(torBackendPortText ? torBackendPortText : "");
  if (!torBackendPort || (config->torEnabled && (*torBackendPort == 0 ||
      (config->useTLS && *torBackendPort == *config->port)))) {
    throw std::runtime_error("Invalid Tor backend port!");
  }
  config->torBackendPort = *torBackendPort;

  const char* torVirtualPortText = std::getenv("TOR_VIRTUAL_PORT");
  if (!torVirtualPortText) {
    torVirtualPortText = arguments.getNamedArgumentValue("--tor-virtual-port", "80");
  }
  const auto torVirtualPort = parsePort(torVirtualPortText ? torVirtualPortText : "");
  if (!torVirtualPort || *torVirtualPort == 0) {
    throw std::runtime_error("Invalid Tor virtual port!");
  }
  config->torVirtualPort = *torVirtualPort;

  config->torKeyPath = std::getenv("TOR_KEY_PATH");
  if (!config->torKeyPath) config->torKeyPath = arguments.getNamedArgumentValue("--tor-key");
  if (arguments.hasArgument("--tor-key") && !config->torKeyPath) {
    throw std::runtime_error("Missing Tor key path!");
  }
  if (!config->torKeyPath && config->statisticsStatePath) {
    config->torKeyPath = (std::filesystem::path(*config->statisticsStatePath)
        .parent_path() / "onion.key").string();
  }
  if (!config->torKeyPath) config->torKeyPath = "conspire-onion.key";
  if (!validStateFilePath(*config->torKeyPath)) {
    throw std::runtime_error("Invalid Tor key path!");
  }
  config->pidFilePath = arguments.getNamedArgumentValue("--pid");
  config->version = CONSPIRE_VERSION;
  return config;
}

} // namespace conspire::config

#endif
