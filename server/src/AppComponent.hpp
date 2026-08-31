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

#ifndef AppComponent_hpp
#define AppComponent_hpp

#include "rooms/Lobby.hpp"
#include "dto/Config.hpp"
#include "utils/AppConfig.hpp"
#include "utils/ServerBoundaries.hpp"
#include "utils/Statistics.hpp"

#include "oatpp-openssl/server/ConnectionProvider.hpp"

#include "oatpp/web/server/interceptor/RequestInterceptor.hpp"
#include "oatpp/web/server/AsyncHttpConnectionHandler.hpp"
#include "oatpp/web/server/HttpRouter.hpp"

#include "oatpp/network/tcp/server/ConnectionProvider.hpp"

#include "oatpp/json/ObjectMapper.hpp"

#include "oatpp/macro/component.hpp"
#include "oatpp/base/CommandLineArguments.hpp"

#include "oatpp/utils/Conversion.hpp"


/**
 *  Class which creates and holds Application components and registers components in oatpp::Environment
 *  Order of components initialization is from top to bottom
 */
class AppComponent {
private:

  class RedirectInterceptor : public oatpp::web::server::interceptor::RequestInterceptor {
  private:
    OATPP_COMPONENT(oatpp::Object<ConfigDto>, componentAppConfig);
  public:

    std::shared_ptr<OutgoingResponse> intercept(const std::shared_ptr<IncomingRequest>& request) override {
      auto host = request->getHeader(oatpp::web::protocol::http::Header::HOST);
      auto siteHost = componentAppConfig->getHostString();
      const auto path = request->getStartingLine().path.toString();
      if(!host || !conspire::boundaries::validHost(*host) || !conspire::boundaries::validRequestPath(*path)) {
        return OutgoingResponse::createShared(oatpp::web::protocol::http::Status::CODE_400, nullptr);
      }
      if(!host || host != siteHost) {
        auto response = OutgoingResponse::createShared(oatpp::web::protocol::http::Status::CODE_301, nullptr);
        response->putHeader("Location", componentAppConfig->getCanonicalBaseUrl() + path);
        response->putHeader("Cache-Control", "no-store");
        return response;
      }
      return nullptr;
    }

  };

private:
  oatpp::base::CommandLineArguments m_cmdArgs;
public:
  AppComponent(const oatpp::base::CommandLineArguments& cmdArgs)
    : m_cmdArgs(cmdArgs)
  {}
public:

  /**
   * Create config component
   */
  OATPP_CREATE_COMPONENT(oatpp::Object<ConfigDto>, appConfig)([this] {
    return conspire::config::fromCommandLine(m_cmdArgs);

  }());

  /**
   * Create Async Executor
   */
  OATPP_CREATE_COMPONENT(std::shared_ptr<oatpp::async::Executor>, executor)([] {
    return std::make_shared<oatpp::async::Executor>();
  }());

  /**
   *  Create ConnectionProvider component which listens on the port
   */
  OATPP_CREATE_COMPONENT(std::shared_ptr<oatpp::network::ServerConnectionProvider>, serverConnectionProvider)([] {

    OATPP_COMPONENT(oatpp::Object<ConfigDto>, componentAppConfig);

    std::shared_ptr<oatpp::network::ServerConnectionProvider> result;

    if(componentAppConfig->useTLS) {

      OATPP_LOGd("oatpp::openssl::Config", "key_path='{}'", componentAppConfig->tlsPrivateKeyPath);
      OATPP_LOGd("oatpp::openssl::Config", "chn_path='{}'", componentAppConfig->tlsCertificateChainPath);

      auto config = oatpp::openssl::Config::createDefaultServerConfigShared(
              componentAppConfig->tlsCertificateChainPath->c_str(),
              componentAppConfig->tlsPrivateKeyPath->c_str());
      result = oatpp::openssl::server::ConnectionProvider::createShared(config, {"0.0.0.0", componentAppConfig->port, oatpp::network::Address::IP_4});
    } else {
      result = oatpp::network::tcp::server::ConnectionProvider::createShared({"0.0.0.0", componentAppConfig->port, oatpp::network::Address::IP_4});
    }

    return result;

  }());

  /**
   *  Create Router component
   */
  OATPP_CREATE_COMPONENT(std::shared_ptr<oatpp::web::server::HttpRouter>, httpRouter)([] {
    return oatpp::web::server::HttpRouter::createShared();
  }());

  /**
   *  Create ConnectionHandler component which uses Router component to route requests
   */
  OATPP_CREATE_COMPONENT(std::shared_ptr<oatpp::network::ConnectionHandler>, serverConnectionHandler)("http", [] {
    OATPP_COMPONENT(std::shared_ptr<oatpp::web::server::HttpRouter>, router); // get Router component
    OATPP_COMPONENT(std::shared_ptr<oatpp::async::Executor>, componentExecutor); // get Async executor component
    auto handler = oatpp::web::server::AsyncHttpConnectionHandler::createShared(router, componentExecutor);
    handler->addRequestInterceptor(std::make_shared<RedirectInterceptor>());
    return handler;
  }());

  /**
   *  Create ObjectMapper component to serialize/deserialize DTOs in Contoller's API
   */
  OATPP_CREATE_COMPONENT(std::shared_ptr<oatpp::data::mapping::ObjectMapper>, apiObjectMapper)([] {
    auto mapper = std::make_shared<oatpp::json::ObjectMapper>();
    mapper->serializerConfig().mapper.includeNullFields = false;
    return mapper;
  }());

  /**
   *  Create statistics object
   */
  OATPP_CREATE_COMPONENT(std::shared_ptr<Statistics>, statistics)([] {
    return std::make_shared<Statistics>();
  }());

  /**
   *  Create chat lobby component.
   */
  OATPP_CREATE_COMPONENT(std::shared_ptr<Lobby>, lobby)([] {
    return std::make_shared<Lobby>();
  }());

  /**
   *  Create websocket connection handler
   */
  OATPP_CREATE_COMPONENT(std::shared_ptr<oatpp::network::ConnectionHandler>, websocketConnectionHandler)("websocket", [] {
    OATPP_COMPONENT(std::shared_ptr<oatpp::async::Executor>, componentExecutor);
    OATPP_COMPONENT(std::shared_ptr<Lobby>, componentLobby);
    auto connectionHandler = oatpp::websocket::AsyncConnectionHandler::createShared(componentExecutor);
    connectionHandler->setSocketInstanceListener(componentLobby);
    return connectionHandler;
  }());

};

#endif /* AppComponent_hpp */
