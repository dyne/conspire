
#include "WSTest.hpp"
#include "utils/AppConfig.hpp"

#include "oatpp-test/UnitTest.hpp"
#include <cassert>
#include <cstdlib>
#include <iostream>

void runConfigTests() {
  unsetenv("EXTERNAL_ADDRESS");
  unsetenv("EXTERNAL_PORT");
  unsetenv("TLS_FILE_PRIVATE_KEY");
  unsetenv("TLS_FILE_CERT_CHAIN");
  unsetenv("URL_STATS_PATH");

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

void runTests() {
  runConfigTests();
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
