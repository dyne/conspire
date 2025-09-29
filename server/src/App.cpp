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

#include "oatpp/network/Server.hpp"

#include <iostream>
#include <fstream>
#include <csignal>
#include <unistd.h>
#include <sys/types.h>
#include <atomic>
#include <thread>
#include <chrono>
#include <future>

// Global variables for signal handling
std::atomic<bool> g_shouldShutdown(false);
std::string g_pidFilePath;
std::atomic<int> g_signalCount(0);

// Function to remove PID file (signal-safe version)
void removePidFile() {
  if (!g_pidFilePath.empty()) {
    if (unlink(g_pidFilePath.c_str()) == 0) {
      // Can't use OATPP_LOGi in signal handler - not async-signal-safe
    }
    g_pidFilePath.clear();
  }
}

// Signal handler function
void signalHandler(int signal) {
  int count = ++g_signalCount;
  g_shouldShutdown = true;

  if (count >= 2) {
    // Force immediate exit after 2nd signal
    removePidFile();
    _exit(1); // Force immediate exit
  }
}

// Function to create PID file
bool createPidFile(const std::string& pidFilePath) {
  if (pidFilePath.empty()) {
    return true; // No PID file requested
  }

  std::ofstream pidFile(pidFilePath);
  if (!pidFile.is_open()) {
    OATPP_LOGe("canchat", "Failed to create PID file: {}", pidFilePath);
    return false;
  }

  pid_t pid = getpid();
  pidFile << pid << std::endl;
  pidFile.close();

  if (pidFile.fail()) {
    OATPP_LOGe("canchat", "Failed to write to PID file: {}", pidFilePath);
    return false;
  }

  OATPP_LOGi("canchat", "Created PID file: {} with PID: {}", pidFilePath, pid);
  g_pidFilePath = pidFilePath;
  return true;
}

// Function to remove PID file (non-signal version with logging)
void removePidFileWithLogging() {
  if (!g_pidFilePath.empty()) {
    if (unlink(g_pidFilePath.c_str()) == 0) {
      OATPP_LOGi("canchat", "Removed PID file: {}", g_pidFilePath);
    } else {
      OATPP_LOGe("canchat", "Failed to remove PID file: {}", g_pidFilePath);
    }
    g_pidFilePath.clear();
  }
}

// Function to setup signal handlers
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

  // Create PID file if requested
  if (!createPidFile(appConfig->pidFilePath ? appConfig->pidFilePath->c_str() : "")) {
    return; // Exit if PID file creation failed
  }

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

  std::thread pingThread([]{
    OATPP_COMPONENT(std::shared_ptr<Lobby>, lobby);
    while (!g_shouldShutdown) {
      // Check shutdown flag every second instead of waiting 30 seconds
      for (int i = 0; i < 30 && !g_shouldShutdown; i++) {
        std::this_thread::sleep_for(std::chrono::seconds(1));
      }
      if (!g_shouldShutdown) {
        try {
          lobby->runPingLoop(std::chrono::seconds(1)); // Quick ping check
        } catch (const std::exception& e) {
          if (!g_shouldShutdown) {
            OATPP_LOGw("canchat", "Exception in ping loop: {}", e.what());
          }
          break; // Exit loop on exception
        } catch (...) {
          if (!g_shouldShutdown) {
            OATPP_LOGw("canchat", "Unknown exception in ping loop");
          }
          break; // Exit loop on exception
        }
      }
    }
  });

  std::thread statThread([]{
    OATPP_COMPONENT(std::shared_ptr<Statistics>, statistics);
    while (!g_shouldShutdown) {
      // Check for shutdown every 100ms instead of running blocking stats loop
      for (int i = 0; i < 50 && !g_shouldShutdown; i++) {
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
      }
      // Skip running stats during shutdown to avoid hanging
      if (g_shouldShutdown) {
        break;
      }
      // Run stats in a quick, non-blocking way if possible
      try {
        // Instead of runStatLoop() which might block, we'll skip it during shutdown
        // The stats can be updated less frequently during normal operation
        if (!g_shouldShutdown) {
          statistics->runStatLoop();
        }
      } catch (...) {
        // Log and continue on any exception
        if (!g_shouldShutdown) {
          OATPP_LOGw("canchat", "Stats update failed, continuing...");
        }
        break;
      }
    }
    OATPP_LOGi("canchat", "Stats thread exiting cleanly");
  });

  OATPP_LOGi("canchat", "Conspire Chat Server v{} starting up", appConfig->version)

  if(appConfig->useTLS) {
    OATPP_LOGi("canchat", "clients are expected to connect at https://{}:{}/", appConfig->host, appConfig->port);
  } else {
    OATPP_LOGi("canchat", "clients are expected to connect at http://{}:{}/", appConfig->host, appConfig->port);
  }

  OATPP_LOGi("canchat", "canonical base URL={}", appConfig->getCanonicalBaseUrl())
  OATPP_LOGi("canchat", "statistics URL={}", appConfig->getStatsUrl())

  // Wait for shutdown signal
  while (!g_shouldShutdown) {
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
  }

  OATPP_LOGi("canchat", "Shutting down server...");

  // Stop server (this should interrupt the server.run() call)
  server.stop();

  // Give threads a brief moment to notice the shutdown flag
  std::this_thread::sleep_for(std::chrono::milliseconds(200));

  // Wait for server thread first (most important) - but with short timeout
  if (serverThread.joinable()) {
    OATPP_LOGi("canchat", "Waiting for server thread to finish...");
    auto future = std::async(std::launch::async, [&serverThread]() {
      serverThread.join();
    });

    if (future.wait_for(std::chrono::seconds(1)) == std::future_status::timeout) {
      OATPP_LOGw("canchat", "Server thread timeout, detaching");
      serverThread.detach();
    } else {
      OATPP_LOGi("canchat", "Server thread finished cleanly");
    }
  }

  // For auxiliary threads, don't wait at all - just detach immediately
  if (pingThread.joinable()) {
    OATPP_LOGi("canchat", "Detaching ping thread");
    pingThread.detach();
  }

  if (statThread.joinable()) {
    OATPP_LOGi("canchat", "Detaching stats thread");
    statThread.detach();
  }

  // Cleanup PID file
  removePidFileWithLogging();

  OATPP_LOGi("canchat", "Server shutdown complete");

  // Exit immediately - no additional sleep

}

int main(int argc, const char * argv[]) {

  oatpp::Environment::init();

  run(oatpp::base::CommandLineArguments(argc, argv));

  oatpp::Environment::destroy();

  return 0;
}
