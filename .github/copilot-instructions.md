# Conspire AI Coding Instructions

## Project Overview
Conspire is an **ephemeral, anonymous, peer-to-peer chat application** built with C++ (Oat++ framework) backend and vanilla JavaScript frontend. Rooms self-destruct when empty, file sharing is direct peer-to-peer, and no data persists beyond active sessions.

## Architecture Overview

### Backend Structure (C++)
- **Oat++ Framework**: Modern async C++ web framework with dependency injection (`OATPP_COMPONENT`)
- **Component Architecture**: `AppComponent.hpp` defines all services via dependency injection
- **Room/Peer Model**: `Lobby` manages rooms, `Room` contains peers, `Peer` handles WebSocket connections
- **Async Processing**: Heavy use of coroutines (`oatpp::async::Coroutine`) for non-blocking operations
- **Message Flow**: JSON over WebSocket, parsed via `MessageDto` with typed codes

### Key Components
```
server/src/
├── AppComponent.hpp         # DI container - defines all services
├── rooms/
│   ├── Lobby.cpp/hpp       # Room lifecycle manager
│   ├── Room.cpp/hpp        # Chat room with peers and history
│   └── Peer.cpp/hpp        # Individual WebSocket connection
├── controller/             # HTTP endpoints (REST + WebSocket handshake)
├── dto/                    # Data Transfer Objects
└── utils/                  # Statistics, nickname generation
```

### Frontend Structure (JavaScript)
- **Vanilla JS**: No frameworks, direct WebSocket communication
- **Message Types**: Defined codes (`CODE_PEER_MESSAGE`, `CODE_FILE_SHARE`, etc.)
- **Real-time Features**: Typing indicators, live participant list, file streaming
- **P2P File Transfer**: Files streamed in chunks directly between browsers

## Development Workflows

### Build System
```bash
# Build dependencies and server (creates ./build/deps with local Oat++ build)
make build/deps

# Build server
make conspire

# Run server
./conspire-x86_64 --host localhost --port 8080
```

### Key Build Patterns
- **Local Dependencies**: CMake configured to use `./build/deps` for Oat++ libraries
- **Docker Support**: Multi-stage Alpine-based build with non-root user
- **Static Linking**: GNUmakefile supports musl-based static builds

### Testing
```bash
cd server/build && make test
# Note: Tests are minimal - main test is WSTest (currently placeholder)
```

## Critical Patterns & Conventions

### WebSocket Message Protocol
Messages use numeric codes defined in both C++ (`MessageCodes` enum) and JS constants:
```cpp
// C++ side - dto/DTOs.hpp
enum MessageCodes {
  CODE_INFO = 0,           // Server sends room info + peer list
  CODE_PEER_JOINED = 1,    // Peer entered room
  CODE_PEER_LEFT = 2,      // Peer left room
  CODE_PEER_MESSAGE = 3,   // Chat message
  CODE_PEER_MESSAGE_FILE = 4, // File share announcement
  CODE_PEER_IS_TYPING = 5, // Typing indicator
  // ...
};
```

### Async Safety Pattern
All WebSocket operations use locks to prevent concurrent writes:
```cpp
// Pattern used throughout Peer.cpp
return oatpp::async::synchronize(&m_writeLock,
  m_websocket->sendOneFrameTextAsync(message));
```

### Component Injection Pattern
Services are injected via macros (Oat++ DI):
```cpp
OATPP_COMPONENT(std::shared_ptr<Statistics>, m_statistics);
OATPP_COMPONENT(oatpp::Object<ConfigDto>, m_appConfig);
```

### Room Lifecycle Management
- Rooms auto-create on first peer join (`Lobby::getOrCreateRoom`)
- Rooms auto-destroy when last peer leaves (`Room::isEmpty()`)
- History limited by `maxRoomHistoryMessages` config

### File Streaming Architecture
1. **Announce**: Client sends `CODE_FILE_SHARE` with file metadata
2. **Request**: Other peers send `CODE_FILE_REQUEST_CHUNK` for specific ranges
3. **Stream**: Host sends `CODE_FILE_CHUNK_DATA` with base64-encoded chunks
4. **P2P Direct**: No server storage - files stream peer-to-peer

## Configuration & Environment

### Runtime Configuration
- `EXTERNAL_ADDRESS` / `--host`: Server bind address
- `EXTERNAL_PORT` / `--port`: Server port (default 8080 for HTTP, 8443 for HTTPS)
- `URL_STATS_PATH`: Statistics endpoint path
- `maxMessageSizeBytes`: WebSocket message size limit
- `maxRoomHistoryMessages`: Chat history retention limit

### TLS/SSL Support (Optional)
- Set `useTLS = true` in config
- Provide `TLS_FILE_PRIVATE_KEY` and `TLS_FILE_CERT_CHAIN`
- Uses `oatpp-openssl` for HTTPS/WSS

## Development Guidelines

### When Adding Features
1. **Message Types**: Add new codes to both `dto/DTOs.hpp` and `chat.js`
2. **Async Operations**: Always use coroutines for I/O, lock WebSocket writes
3. **Component Services**: Register new services in `AppComponent.hpp`
4. **Error Handling**: Use `onApiError()` pattern for WebSocket errors

### Common Issues
- **Circular Dependencies**: Use forward declarations (`class Room;`) and shared_ptr
- **WebSocket Races**: Always synchronize writes with `m_writeLock`
- **Memory Leaks**: Call `invalidateSocket()` on peer cleanup
- **Build Issues**: Ensure `./build/deps` exists before CMake configure

### File Organization
- Controllers handle HTTP endpoints and WebSocket handshakes
- Rooms manage chat state and peer coordination
- DTOs define all data structures and validation
- Utils provide cross-cutting concerns (stats, nicknames)

## Integration Points

### Frontend ↔ Backend
- `StaticController` serves templated JS with WebSocket URLs
- `RoomsController` handles WebSocket upgrade with room/nickname params
- All communication via JSON over WebSocket (no REST APIs for chat)

### External Dependencies
- **Oat++**: Core framework (oatpp, oatpp-websocket)
- **OpenSSL**: Optional for TLS support
- **Build Tools**: CMake 3.20+, C++17 compiler

Understanding this architecture enables rapid feature development while maintaining the ephemeral, anonymous nature of the platform.
