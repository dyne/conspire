#ifndef CONSPIRE_UTILS_APP_CONFIG_HPP
#define CONSPIRE_UTILS_APP_CONFIG_HPP

#include "dto/Config.hpp"
#include "utils/ConfigValidation.hpp"

#include "oatpp/base/CommandLineArguments.hpp"

#include <cstdlib>
#include <stdexcept>

namespace conspire::config {

inline oatpp::Object<ConfigDto> fromCommandLine(const oatpp::base::CommandLineArguments& arguments) {
  auto config = ConfigDto::createShared();
  config->host = std::getenv("EXTERNAL_ADDRESS");
  if (!config->host) config->host = arguments.getNamedArgumentValue("--host", "localhost");
  if (!config->host || !validHost(*config->host)) throw std::runtime_error("Invalid host!");

  const char* portText = std::getenv("EXTERNAL_PORT");
  if (!portText) portText = arguments.getNamedArgumentValue("--port", "8443");
  const auto port = parsePort(portText ? portText : "");
  if (!port) throw std::runtime_error("Invalid port!");
  config->port = *port;

  config->tlsPrivateKeyPath = std::getenv("TLS_FILE_PRIVATE_KEY");
  if (!config->tlsPrivateKeyPath) config->tlsPrivateKeyPath = arguments.getNamedArgumentValue("--tls-key", "" CERT_PEM_PATH);
  config->tlsCertificateChainPath = std::getenv("TLS_FILE_CERT_CHAIN");
  if (!config->tlsCertificateChainPath) config->tlsCertificateChainPath = arguments.getNamedArgumentValue("--tls-chain", "" CERT_CRT_PATH);
  config->statisticsUrl = std::getenv("URL_STATS_PATH");
  if (!config->statisticsUrl) config->statisticsUrl = arguments.getNamedArgumentValue("--url-stats", "admin/stats.json");
  if (!config->statisticsUrl || !validStatsPath(*config->statisticsUrl)) throw std::runtime_error("Invalid statistics path!");
  config->pidFilePath = arguments.getNamedArgumentValue("--pid");
  config->frontPath = arguments.getNamedArgumentValue("--front", "front");
  config->version = CONSPIRE_VERSION;
  return config;
}

} // namespace conspire::config

#endif
