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

#include "controller/StatisticsController.hpp"
#include "controller/FileController.hpp"
#include "controller/RoomsController.hpp"
#include "controller/StaticController.hpp"

#include "./AppComponent.hpp"
#include "utils/Lifecycle.hpp"

#include "oatpp/network/Server.hpp"

#include <iostream>
#include <csignal>
#include <thread>
#include <chrono>

// The handler is deliberately limited to assigning a sig_atomic_t. Logging,
// cleanup, and joining happen in run(), where ordinary C++ is safe.
volatile std::sig_atomic_t g_shutdownSignal = 0;

void signalHandler(int signal) { g_shutdownSignal = signal; }

void setupSignalHandlers() {
  struct sigaction sa;
  sa.sa_handler = signalHandler;
  sigemptyset(&sa.sa_mask);
  sa.sa_flags = 0;

  // Handle common termination signals
  sigaction(SIGINT, &sa, nullptr);   // Ctrl+C
  sigaction(SIGTERM, &sa, nullptr);  // Termination signal
  sigaction(SIGHUP, &sa, nullptr);   // Hang up signal
  sigaction(SIGQUIT, &sa, nullptr);  // Quit signal
}

void run(const oatpp::base::CommandLineArguments& args) {

  g_shutdownSignal = 0;

  // Print version and exit if '--version' is present
  if(args.hasArgument("--version")) {
    std::cout << "Conspire Chat Server v" << CONSPIRE_VERSION << std::endl;
    return;
  }

  // Print help and exit if '-h' or '--help' is present
  if(args.hasArgument("-h") || args.hasArgument("--help")) {
    std::cout << R"HELP(
Conspire Chat Server v)HELP" << CONSPIRE_VERSION << R"HELP(
Usage: conspire [options]
Options:
  --host <address>         Bind address (default: localhost)
  --port <port>            Port to listen on (default: 8080)
  --tls-key <path>         Path to TLS private key file (default: "privkey.pem")
  --tls-chain <path>       Path to TLS certificate chain file (default: "fullchain.pem")
  --url-stats <path>       Statistics endpoint path (default: admin/stats.json)
  --pid <path>             Path to PID file to create
  --front <path>           Path to frontend static files (default: front)
  --version                Show version information
  -h, --help               Show this help message
)HELP" << std::endl;
    return;
  }

  /* Register Components in scope of run() method */
  AppComponent components(args);

  OATPP_COMPONENT(oatpp::Object<ConfigDto>, appConfig);

  // Setup signal handlers
  setupSignalHandlers();

  conspire::lifecycle::PidFile pidFile;
  const std::string pidFilePath = appConfig->pidFilePath ? appConfig->pidFilePath->std_str() : "";
  if (!pidFile.create(pidFilePath)) {
    OATPP_LOGe("conspire", "Failed to create PID file: {}", pidFilePath);
    return; // Exit if PID file creation failed
  }
  if (pidFile.active()) OATPP_LOGi("conspire", "Created PID file: {}", pidFilePath);

  /* Get router component */
  OATPP_COMPONENT(std::shared_ptr<oatpp::web::server::HttpRouter>, router);

  /* Create RoomsController and add all of its endpoints to router */
  router->addController(std::make_shared<RoomsController>());
  router->addController(std::make_shared<StaticController>());
  router->addController(std::make_shared<FileController>());
  router->addController(std::make_shared<StatisticsController>());

  /* Get connection handler component */
  OATPP_COMPONENT(std::shared_ptr<oatpp::network::ConnectionHandler>, connectionHandler, "http");

  /* Get connection provider component */
  OATPP_COMPONENT(std::shared_ptr<oatpp::network::ServerConnectionProvider>, connectionProvider);

  /* Create server which takes provided TCP connections and passes them to HTTP connection handler */
  oatpp::network::Server server(connectionProvider, connectionHandler);

  std::thread serverThread([&server]{
    server.run();
  });

  OATPP_COMPONENT(std::shared_ptr<Lobby>, lobby);
  OATPP_COMPONENT(std::shared_ptr<Statistics>, statistics);
  conspire::lifecycle::PeriodicRunner pingRunner;
  conspire::lifecycle::PeriodicRunner statisticsRunner;
  const bool pingStarted = pingRunner.start(std::chrono::seconds(30), [lobby] {
    lobby->runPingIteration();
  });
  const bool statisticsStarted = statisticsRunner.start(std::chrono::seconds(1), [statistics] {
    statistics->runStatIteration();
  });
  if (!pingStarted || !statisticsStarted) {
    OATPP_LOGe("conspire", "Failed to start lifecycle workers");
    pingRunner.stop();
    statisticsRunner.stop();
    server.stop();
    if (serverThread.joinable()) serverThread.join();
    return;
  }

  OATPP_LOGi("conspire", "Conspire Chat Server v{} starting up", appConfig->version)

  if(appConfig->useTLS) {
    OATPP_LOGi("conspire", "clients are expected to connect at https://{}:{}/", appConfig->host, appConfig->port);
  } else {
    OATPP_LOGi("conspire", "clients are expected to connect at http://{}:{}/", appConfig->host, appConfig->port);
  }

  OATPP_LOGi("conspire", "canonical base URL={}", appConfig->getCanonicalBaseUrl())
  OATPP_LOGi("conspire", "statistics URL={}", appConfig->getStatsUrl())

  // Wait for shutdown signal
  while (g_shutdownSignal == 0 && !pingRunner.failed() && !statisticsRunner.failed()) {
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
  }

  OATPP_LOGi("conspire", "Shutting down server...");

  // Each owned worker is woken and joined before components/environment die.
  pingRunner.stop();
  statisticsRunner.stop();
  server.stop();
  if (serverThread.joinable()) serverThread.join();
  pidFile.reset();

  OATPP_LOGi("conspire", "Server shutdown complete");

}

int main(int argc, const char * argv[]) {

  oatpp::Environment::init();

  run(oatpp::base::CommandLineArguments(argc, argv));

  oatpp::Environment::destroy();

  return 0;
}
