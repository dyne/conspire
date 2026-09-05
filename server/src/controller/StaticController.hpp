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

#ifndef StaticController_hpp
#define StaticController_hpp

#include "EmbeddedFrontend.hpp"
#include "dto/Config.hpp"
#include "utils/ServerBoundaries.hpp"
#include "oatpp/web/server/api/ApiController.hpp"

#include "oatpp/macro/codegen.hpp"
#include "oatpp/macro/component.hpp"

#include OATPP_CODEGEN_BEGIN(ApiController) /// <-- Begin Code-Gen

class StaticController : public oatpp::web::server::api::ApiController {
private:
  typedef StaticController __ControllerType;
private:
  OATPP_COMPONENT(oatpp::Object<ConfigDto>, m_config);
  OATPP_COMPONENT(std::shared_ptr<Statistics>, m_statistics);
private:

  static oatpp::String loadAsset(std::string_view path) {
    const auto asset = conspire::frontend::findAsset(path);
    OATPP_ASSERT_HTTP(!asset.empty(), Status::CODE_404, "Asset Not Found:(");
    return {asset.data(), static_cast<v_buff_size>(asset.size())};
  }

  static std::string renderPage(oatpp::String file, const oatpp::String& version) {
    std::string page = *file;
    const auto title = conspire::boundaries::pageTitle(version ? *version : "unknown");
    conspire::boundaries::replaceLiteral(page, "%%%CONSPIRE_TITLE%%%", title);
    return page;
  }
public:
  StaticController(OATPP_COMPONENT(std::shared_ptr<ObjectMapper>, objectMapper))
    : oatpp::web::server::api::ApiController(objectMapper)
  {}
public:

  ENDPOINT_ASYNC("GET", "/", Root) {

    ENDPOINT_ASYNC_INIT(Root)

    Action act() override {
      ++ controller->m_statistics->EVENT_FRONT_PAGE_LOADED;
      auto response = controller->createResponse(Status::CODE_200,
          controller->renderPage(controller->loadAsset("index.html"), controller->m_config->version));
      response->putHeader(Header::CONTENT_TYPE, "text/html");
      response->putHeader("Content-Security-Policy", "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'");
      response->putHeader("X-Content-Type-Options", "nosniff");
      response->putHeader("Referrer-Policy", "no-referrer");
      response->putHeader("Cache-Control", "no-store");
      return _return(response);
    }  };

  ENDPOINT_ASYNC("GET", "style.css", RootCSS) {
    ENDPOINT_ASYNC_INIT(RootCSS)

    Action act() override {
      auto response = controller->createResponse(Status::CODE_200,
                                                 controller->loadAsset("style.css"));
      response->putHeader(Header::CONTENT_TYPE, "text/css");
      response->putHeader("X-Content-Type-Options", "nosniff");
      response->putHeader("Cache-Control", "no-store");
      return _return(response);
    }
  };

  ENDPOINT_ASYNC("GET", "lobby.js", LobbyJS) {
    ENDPOINT_ASYNC_INIT(LobbyJS)

    Action act() override {
      auto response = controller->createResponse(Status::CODE_200,
                                                 controller->loadAsset("lobby.js"));
      response->putHeader(Header::CONTENT_TYPE, "text/javascript");
      response->putHeader("X-Content-Type-Options", "nosniff");
      response->putHeader("Cache-Control", "no-store");
      return _return(response);
    }
  };

  ENDPOINT_ASYNC("GET", "dashboard", Dashboard) {
    ENDPOINT_ASYNC_INIT(Dashboard)

    Action act() override {
      auto response = controller->createResponse(Status::CODE_200,
          controller->renderPage(controller->loadAsset("dashboard/index.html"),
                                 controller->m_config->version));
      response->putHeader(Header::CONTENT_TYPE, "text/html");
      response->putHeader("Content-Security-Policy",
          "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; "
          "style-src 'self' 'unsafe-inline'; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; "
          "base-uri 'none'; object-src 'none'; frame-ancestors 'none'");
      response->putHeader("X-Content-Type-Options", "nosniff");
      response->putHeader("Referrer-Policy", "no-referrer");
      response->putHeader("Cache-Control", "no-store");
      return _return(response);
    }
  };

  ENDPOINT_ASYNC("GET", "dashboard/", DashboardSlash) {
    ENDPOINT_ASYNC_INIT(DashboardSlash)

    Action act() override {
      auto response = controller->createResponse(Status::CODE_200,
          controller->renderPage(controller->loadAsset("dashboard/index.html"),
                                 controller->m_config->version));
      response->putHeader(Header::CONTENT_TYPE, "text/html");
      response->putHeader("Content-Security-Policy",
          "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; "
          "style-src 'self' 'unsafe-inline'; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; "
          "base-uri 'none'; object-src 'none'; frame-ancestors 'none'");
      response->putHeader("X-Content-Type-Options", "nosniff");
      response->putHeader("Referrer-Policy", "no-referrer");
      response->putHeader("Cache-Control", "no-store");
      return _return(response);
    }
  };

  ENDPOINT_ASYNC("GET", "dashboard/style.css", DashboardCSS) {
    ENDPOINT_ASYNC_INIT(DashboardCSS)

    Action act() override {
      auto response = controller->createResponse(Status::CODE_200,
                                                 controller->loadAsset("dashboard/style.css"));
      response->putHeader(Header::CONTENT_TYPE, "text/css");
      response->putHeader("X-Content-Type-Options", "nosniff");
      response->putHeader("Cache-Control", "no-store");
      return _return(response);
    }
  };

  ENDPOINT_ASYNC("GET", "dashboard/app.js", DashboardJS) {
    ENDPOINT_ASYNC_INIT(DashboardJS)

    Action act() override {
      oatpp::data::stream::BufferOutputStream stream;
      const auto statsPath = conspire::boundaries::javascriptString(
          "/" + *controller->m_config->statisticsUrl);
      stream << "globalThis.ConspireDashboardConfig = {statsUrl: "
             << statsPath.c_str() << "};\n\n";
      stream << controller->loadAsset("dashboard/app.js");

      auto response = controller->createResponse(Status::CODE_200, stream.toString());
      response->putHeader(Header::CONTENT_TYPE, "text/javascript");
      response->putHeader("X-Content-Type-Options", "nosniff");
      response->putHeader("Cache-Control", "no-store");
      return _return(response);
    }
  };

  ENDPOINT_ASYNC("GET", "dashboard/sample-stats.json", DashboardSampleStats) {
    ENDPOINT_ASYNC_INIT(DashboardSampleStats)

    Action act() override {
      auto response = controller->createResponse(Status::CODE_200,
          controller->loadAsset("dashboard/sample-stats.json"));
      response->putHeader(Header::CONTENT_TYPE, "application/json");
      response->putHeader("X-Content-Type-Options", "nosniff");
      response->putHeader("Cache-Control", "no-store");
      return _return(response);
    }
  };

  ENDPOINT_ASYNC("GET", "room/{roomId}", ChatHTML) {

    ENDPOINT_ASYNC_INIT(ChatHTML)

    Action act() override {
      const auto roomId = request->getPathVariable("roomId");
      OATPP_ASSERT_HTTP(roomId && conspire::boundaries::validRoomId(*roomId), Status::CODE_400, "Invalid room id");
      auto text = controller->renderPage(controller->loadAsset("chat/index.html"),
                                         controller->m_config->version);
      conspire::boundaries::replaceLiteral(text, "%%%ROOM_ID%%%", conspire::boundaries::urlPathSegment(*roomId));
      auto response = controller->createResponse(Status::CODE_200, text);
      response->putHeader(Header::CONTENT_TYPE, "text/html");
      response->putHeader("Content-Security-Policy", "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'");
      response->putHeader("X-Content-Type-Options", "nosniff");
      response->putHeader("Referrer-Policy", "no-referrer");
      response->putHeader("Cache-Control", "no-store");
      return _return(response);
    }  };

  ENDPOINT_ASYNC("GET", "room/{roomId}/chat.js", ChatJS) {

    ENDPOINT_ASYNC_INIT(ChatJS)

    Action act() override {
      const auto roomId = request->getPathVariable("roomId");
      OATPP_ASSERT_HTTP(roomId && conspire::boundaries::validRoomId(*roomId), Status::CODE_400, "Invalid room id");
      auto fileCache = controller->loadAsset("chat/chat.js");

      oatpp::data::stream::BufferOutputStream stream;

      const auto baseUrl = *controller->m_config->getWebsocketBaseUrl();
      const auto encodedRoom = conspire::boundaries::urlPathSegment(*roomId);
      const auto websocketUrl = conspire::boundaries::javascriptString(baseUrl + "/api/ws/room/" + encodedRoom);
      const auto roomUrl = conspire::boundaries::javascriptString("/room/" + encodedRoom);
      stream << "globalThis.ConspireChatConfig = {urlWebsocket: " << websocketUrl.c_str() << ", urlRoom: " << roomUrl.c_str() << "};\n";
      stream << "\n";

      stream << fileCache;

      auto response = controller->createResponse(Status::CODE_200, stream.toString());
      response->putHeader(Header::CONTENT_TYPE, "text/javascript");
      response->putHeader("X-Content-Type-Options", "nosniff");
      response->putHeader("Cache-Control", "no-store");
      return _return(response);
    }

  };

  ENDPOINT_ASYNC("GET", "room/{roomId}/protocol.js", ProtocolJS) {
    ENDPOINT_ASYNC_INIT(ProtocolJS)

    Action act() override {
      auto response = controller->createResponse(Status::CODE_200,
                                                 controller->loadAsset("chat/protocol.js"));
      response->putHeader(Header::CONTENT_TYPE, "text/javascript");
      response->putHeader("X-Content-Type-Options", "nosniff");
      response->putHeader("Cache-Control", "no-store");
      return _return(response);
    }
  };

  ENDPOINT_ASYNC("GET", "room/{roomId}/format.js", FormatJS) {
    ENDPOINT_ASYNC_INIT(FormatJS)

    Action act() override {
      const auto roomId = request->getPathVariable("roomId");
      OATPP_ASSERT_HTTP(roomId && conspire::boundaries::validRoomId(*roomId), Status::CODE_400, "Invalid room id");
      auto response = controller->createResponse(Status::CODE_200,
                                                 controller->loadAsset("chat/format.js"));
      response->putHeader(Header::CONTENT_TYPE, "text/javascript");
      response->putHeader("X-Content-Type-Options", "nosniff");
      response->putHeader("Cache-Control", "no-store");
      return _return(response);
    }
  };

  ENDPOINT_ASYNC("GET", "room/{roomId}/state.js", StateJS) {
    ENDPOINT_ASYNC_INIT(StateJS)

    Action act() override {
      const auto roomId = request->getPathVariable("roomId");
      OATPP_ASSERT_HTTP(roomId && conspire::boundaries::validRoomId(*roomId), Status::CODE_400, "Invalid room id");
      auto response = controller->createResponse(Status::CODE_200,
                                                 controller->loadAsset("chat/state.js"));
      response->putHeader(Header::CONTENT_TYPE, "text/javascript");
      response->putHeader("X-Content-Type-Options", "nosniff");
      response->putHeader("Cache-Control", "no-store");
      return _return(response);
    }
  };

  ENDPOINT_ASYNC("GET", "room/{roomId}/ui.js", UiJS) {
    ENDPOINT_ASYNC_INIT(UiJS)

    Action act() override {
      const auto roomId = request->getPathVariable("roomId");
      OATPP_ASSERT_HTTP(roomId && conspire::boundaries::validRoomId(*roomId), Status::CODE_400, "Invalid room id");
      auto response = controller->createResponse(Status::CODE_200,
                                                 controller->loadAsset("chat/ui.js"));
      response->putHeader(Header::CONTENT_TYPE, "text/javascript");
      response->putHeader("X-Content-Type-Options", "nosniff");
      response->putHeader("Cache-Control", "no-store");
      return _return(response);
    }
  };

  ENDPOINT_ASYNC("GET", "room/{roomId}/chat.css", ChatCSS) {
    ENDPOINT_ASYNC_INIT(ChatCSS)

    Action act() override {
      const auto roomId = request->getPathVariable("roomId");
      OATPP_ASSERT_HTTP(roomId && conspire::boundaries::validRoomId(*roomId), Status::CODE_400, "Invalid room id");
      auto response = controller->createResponse(Status::CODE_200,
                                                 controller->loadAsset("chat/chat.css"));
      response->putHeader(Header::CONTENT_TYPE, "text/css");
      response->putHeader("X-Content-Type-Options", "nosniff");
      response->putHeader("Cache-Control", "no-store");
      return _return(response);
    }
  };

};

#include OATPP_CODEGEN_END(ApiController) /// <-- End Code-Gen

#endif // StaticController_hpp
