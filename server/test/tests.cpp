
#include "WSTest.hpp"
#include "utils/AppConfig.hpp"
#include "utils/Statistics.hpp"

#include "oatpp-test/UnitTest.hpp"
#include <cassert>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>

#include <unistd.h>

void runConfigTests() {
  unsetenv("EXTERNAL_ADDRESS");
  unsetenv("EXTERNAL_PORT");
  unsetenv("TLS_FILE_PRIVATE_KEY");
  unsetenv("TLS_FILE_CERT_CHAIN");
  unsetenv("URL_STATS_PATH");
  unsetenv("STATS_STATE_PATH");

  setenv("TLS_FILE_PRIVATE_KEY", "/missing/key.pem", 1);
  setenv("TLS_FILE_CERT_CHAIN", "/missing/chain.pem", 1);
  const char* plainArguments[] = {"conspire"};
  const auto plainConfig = conspire::config::fromCommandLine(
      oatpp::base::CommandLineArguments(1, plainArguments));
  assert(!plainConfig->useTLS);
  assert(plainConfig->host && *plainConfig->host == "localhost");
  assert(plainConfig->port && *plainConfig->port == 8080);
  assert(!plainConfig->tlsPrivateKeyPath);
  assert(!plainConfig->tlsCertificateChainPath);
  assert(*plainConfig->getCanonicalBaseUrl() == "http://localhost:8080");
  assert(*plainConfig->getWebsocketBaseUrl() == "ws://localhost:8080");
  assert(!plainConfig->statisticsStatePath);

  const char* persistentArguments[] = {
      "conspire", "--stats-state", "/var/lib/conspire/stats.json"};
  const auto persistentConfig = conspire::config::fromCommandLine(
      oatpp::base::CommandLineArguments(3, persistentArguments));
  assert(persistentConfig->statisticsStatePath &&
         *persistentConfig->statisticsStatePath == "/var/lib/conspire/stats.json");

  const char* missingStatePathArguments[] = {"conspire", "--stats-state"};
  bool missingStatePathRejected = false;
  try {
    static_cast<void>(conspire::config::fromCommandLine(
        oatpp::base::CommandLineArguments(2, missingStatePathArguments)));
  } catch (const std::runtime_error&) {
    missingStatePathRejected = true;
  }
  assert(missingStatePathRejected);

  unsetenv("TLS_FILE_PRIVATE_KEY");
  unsetenv("TLS_FILE_CERT_CHAIN");
  const char* tlsArguments[] = {
      "conspire", "--tls", "--tls-key", "test-key.pem",
      "--tls-chain", "test-chain.pem"};
  const auto tlsConfig = conspire::config::fromCommandLine(
      oatpp::base::CommandLineArguments(6, tlsArguments));
  assert(tlsConfig->useTLS);
  assert(tlsConfig->port && *tlsConfig->port == 8443);
  assert(tlsConfig->tlsPrivateKeyPath && *tlsConfig->tlsPrivateKeyPath == "test-key.pem");
  assert(tlsConfig->tlsCertificateChainPath && *tlsConfig->tlsCertificateChainPath == "test-chain.pem");
  assert(*tlsConfig->getCanonicalBaseUrl() == "https://localhost:8443");
  assert(*tlsConfig->getWebsocketBaseUrl() == "wss://localhost:8443");
}

void runStatisticsPersistenceTests() {
  const auto statePath = std::filesystem::temp_directory_path() /
      ("conspire-statistics-test-" + std::to_string(getpid()) + ".json");
  std::filesystem::remove(statePath);

  Statistics source;
  assert(source.loadState(statePath.string()) == Statistics::StateLoadResult::MISSING);
  source.EVENT_FRONT_PAGE_LOADED.store(17);
  source.EVENT_PEER_CONNECTED.store(9);
  source.EVENT_PEER_SEND_MESSAGE.store(23);
  source.FILE_SERVED_BYTES.store(4096);
  source.runStatIteration();
  assert(source.saveState(statePath.string()));

  const auto permissions = std::filesystem::status(statePath).permissions();
  assert((permissions & std::filesystem::perms::group_all) == std::filesystem::perms::none);
  assert((permissions & std::filesystem::perms::others_all) == std::filesystem::perms::none);

  Statistics restored;
  assert(restored.loadState(statePath.string()) == Statistics::StateLoadResult::LOADED);
  assert(restored.EVENT_FRONT_PAGE_LOADED.load() == 17);
  assert(restored.EVENT_PEER_CONNECTED.load() == 9);
  assert(restored.EVENT_PEER_SEND_MESSAGE.load() == 23);
  assert(restored.FILE_SERVED_BYTES.load() == 4096);

  {
    std::ofstream invalid(statePath, std::ios::binary | std::ios::trunc);
    invalid << "not-json";
  }
  assert(restored.loadState(statePath.string()) == Statistics::StateLoadResult::INVALID);
  std::filesystem::remove(statePath);
}

void runTests() {
  runConfigTests();
  runStatisticsPersistenceTests();
  OATPP_RUN_TEST(WSTest);
}

int main() {

  oatpp::Environment::init();

  runTests();

  /* Print how much objects were created during app running, and what have left-probably leaked */
  /* Disable object counting for release builds using '-D OATPP_DISABLE_ENV_OBJECT_COUNTERS' flag for better performance */
  std::cout << "\nEnvironment:\n";
  std::cout << "objectsCount = " << oatpp::Environment::getObjectsCount() << "\n";
  std::cout << "objectsCreated = " << oatpp::Environment::getObjectsCreated() << "\n\n";

  OATPP_ASSERT(oatpp::Environment::getObjectsCount() == 0);

  oatpp::Environment::destroy();

  return 0;
}
