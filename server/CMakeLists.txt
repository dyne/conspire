cmake_minimum_required(VERSION 3.20)
project(conspire LANGUAGES CXX)

include(CTest)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(BUILD_SHARED_LIBS OFF)

set(CONSPIRE_VERSION "unknown" CACHE STRING "Conspire version string")
set(CONSPIRE_DEPS_PREFIX "${CMAKE_CURRENT_SOURCE_DIR}/../build/deps" CACHE PATH
    "Prefix containing the compatible oatpp 1.4.0 dependency set")
option(CONSPIRE_ENABLE_COVERAGE "Instrument Conspire project targets for coverage" OFF)
option(CONSPIRE_USE_CCACHE "Use ccache when it is available" ON)
option(CONSPIRE_CORE_TESTS_ONLY "Build dependency-independent configuration tests without oatpp" OFF)
option(CONSPIRE_WARNINGS_AS_ERRORS "Treat Conspire compiler warnings as errors" ON)
set(CONSPIRE_SANITIZER "none" CACHE STRING "Sanitizer mode: none, address-undefined, or thread")
set_property(CACHE CONSPIRE_SANITIZER PROPERTY STRINGS none address-undefined thread)
set(CONSPIRE_STRESS_SEED "424242" CACHE STRING "Fixed seed for bounded lifecycle stress tests")

set(_conspire_sanitizers none address-undefined thread)
if(NOT CONSPIRE_SANITIZER IN_LIST _conspire_sanitizers)
  message(FATAL_ERROR "CONSPIRE_SANITIZER must be one of: none, address-undefined, thread")
endif()
if(NOT CONSPIRE_SANITIZER STREQUAL "none" AND NOT CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
  message(FATAL_ERROR "CONSPIRE_SANITIZER requires GCC or Clang")
endif()

function(conspire_apply_sanitizer target)
  if(CONSPIRE_SANITIZER STREQUAL "address-undefined")
    target_compile_options(${target} PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer -g)
    target_link_options(${target} PRIVATE -fsanitize=address,undefined)
  elseif(CONSPIRE_SANITIZER STREQUAL "thread")
    target_compile_options(${target} PRIVATE -fsanitize=thread -fno-omit-frame-pointer -g)
    target_link_options(${target} PRIVATE -fsanitize=thread)
  endif()
endfunction()

function(conspire_enable_warnings target)
  if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
    target_compile_options(${target} PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
    if(CONSPIRE_WARNINGS_AS_ERRORS)
      target_compile_options(${target} PRIVATE -Werror)
    endif()
  endif()
endfunction()

if(CONSPIRE_USE_CCACHE)
  find_program(CONSPIRE_CCACHE_PROGRAM ccache)
  if(CONSPIRE_CCACHE_PROGRAM)
    set(CMAKE_CXX_COMPILER_LAUNCHER "${CONSPIRE_CCACHE_PROGRAM}")
    message(STATUS "Using ccache: ${CONSPIRE_CCACHE_PROGRAM}")
  else()
    message(STATUS "ccache not found; continuing without a compiler cache")
  endif()
endif()

if(BUILD_TESTING)
  add_executable(conspire-core-test test/core_tests.cpp test/coverage_fixture.cpp)
  target_include_directories(conspire-core-test PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src")
  conspire_enable_warnings(conspire-core-test)
  conspire_apply_sanitizer(conspire-core-test)
  add_test(NAME conspire-core-unit COMMAND conspire-core-test)
  add_executable(conspire-lifecycle-stress test/lifecycle_stress.cpp)
  target_include_directories(conspire-lifecycle-stress PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src")
  target_compile_definitions(conspire-lifecycle-stress PRIVATE CONSPIRE_STRESS_SEED=${CONSPIRE_STRESS_SEED})
  conspire_enable_warnings(conspire-lifecycle-stress)
  conspire_apply_sanitizer(conspire-lifecycle-stress)
  add_test(NAME conspire-lifecycle-stress COMMAND conspire-lifecycle-stress)
  set_tests_properties(conspire-lifecycle-stress PROPERTIES TIMEOUT 20)
  if(CONSPIRE_ENABLE_COVERAGE)
    if(NOT CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
      message(FATAL_ERROR "CONSPIRE_ENABLE_COVERAGE requires GCC or Clang")
    endif()
    target_compile_options(conspire-core-test PRIVATE --coverage -O0 -g)
    target_link_options(conspire-core-test PRIVATE --coverage)
    find_program(CONSPIRE_GCOV_PROGRAM gcov REQUIRED)
    add_test(NAME conspire-core-coverage-gate
      COMMAND "${CMAKE_COMMAND}"
        -DGCOV=${CONSPIRE_GCOV_PROGRAM}
        -DOBJECT_DIR=${CMAKE_CURRENT_BINARY_DIR}/CMakeFiles/conspire-core-test.dir
        -DGCOV_INPUT=test/core_tests.cpp.gcno
        -DSOURCE_FILES=ConfigValidation.hpp.gcov,ServerBoundaries.hpp.gcov
        -DLINE_MINIMUM=70 -DBRANCH_MINIMUM=60 -DHELPER_LINE_MINIMUM=85
        -P "${CMAKE_CURRENT_SOURCE_DIR}/test/CheckCoverage.cmake")
    add_test(NAME conspire-core-coverage-control
      COMMAND "${CMAKE_COMMAND}"
        -DGCOV=${CONSPIRE_GCOV_PROGRAM}
        -DOBJECT_DIR=${CMAKE_CURRENT_BINARY_DIR}/CMakeFiles/conspire-core-test.dir
        -DGCOV_INPUT=test/coverage_fixture.cpp.gcno
        -DSOURCE_FILES=coverage_fixture.cpp.gcov
        -DEXPECT_LINE_BELOW=80
        -P "${CMAKE_CURRENT_SOURCE_DIR}/test/CheckCoverage.cmake")
    set_tests_properties(conspire-core-coverage-control PROPERTIES WILL_FAIL TRUE)
  endif()
endif()

if(EXISTS "${CONSPIRE_DEPS_PREFIX}")
  set(CONSPIRE_HAS_NATIVE_DEPS ON)
elseif(CONSPIRE_CORE_TESTS_ONLY AND BUILD_TESTING)
  set(CONSPIRE_HAS_NATIVE_DEPS OFF)
  message(STATUS "Building dependency-independent core tests only; oatpp 1.4.0 prefix is not required for this target")
else()
  message(FATAL_ERROR
    "Compatible oatpp 1.4.0 prefix is required but was not found at '${CONSPIRE_DEPS_PREFIX}'. "
    "Supply it with -DCONSPIRE_DEPS_PREFIX=/path/to/prefix. Public oatpp 1.3.x is incompatible with this source tree and is intentionally not fetched.")
endif()

if(CONSPIRE_HAS_NATIVE_DEPS)
  list(PREPEND CMAKE_PREFIX_PATH "${CONSPIRE_DEPS_PREFIX}")

  find_package(oatpp 1.4.0 CONFIG REQUIRED)
  find_package(oatpp-websocket 1.4.0 CONFIG REQUIRED)
  find_package(oatpp-openssl 1.4.0 CONFIG REQUIRED)
  find_package(OpenSSL 1.1 REQUIRED)

  set(CONSPIRE_FRONTEND_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../front")
  file(GLOB_RECURSE CONSPIRE_FRONTEND_ASSETS CONFIGURE_DEPENDS
    LIST_DIRECTORIES false "${CONSPIRE_FRONTEND_DIR}/*")
  set(CONSPIRE_GENERATED_DIR "${CMAKE_CURRENT_BINARY_DIR}/generated")
  set(CONSPIRE_EMBEDDED_FRONTEND_HPP "${CONSPIRE_GENERATED_DIR}/EmbeddedFrontend.hpp")
  set(CONSPIRE_EMBEDDED_FRONTEND_CPP "${CONSPIRE_GENERATED_DIR}/EmbeddedFrontend.cpp")
  add_custom_command(
    OUTPUT "${CONSPIRE_EMBEDDED_FRONTEND_HPP}" "${CONSPIRE_EMBEDDED_FRONTEND_CPP}"
    COMMAND "${CMAKE_COMMAND}" -E make_directory "${CONSPIRE_GENERATED_DIR}"
    COMMAND "${CMAKE_COMMAND}"
      "-DFRONTEND_DIR=${CONSPIRE_FRONTEND_DIR}"
      "-DOUTPUT_HEADER=${CONSPIRE_EMBEDDED_FRONTEND_HPP}"
      "-DOUTPUT_SOURCE=${CONSPIRE_EMBEDDED_FRONTEND_CPP}"
      -P "${CMAKE_CURRENT_SOURCE_DIR}/cmake/EmbedFrontend.cmake"
    DEPENDS ${CONSPIRE_FRONTEND_ASSETS}
            "${CMAKE_CURRENT_SOURCE_DIR}/cmake/EmbedFrontend.cmake"
    COMMENT "Embedding frontend assets"
    VERBATIM)

  add_library(conspire-lib
  "${CONSPIRE_EMBEDDED_FRONTEND_CPP}"
  src/AppComponent.hpp
  src/controller/FileController.hpp
  src/controller/RoomsController.hpp
  src/controller/StaticController.hpp
  src/controller/StatisticsController.hpp
  src/rooms/File.cpp src/rooms/File.hpp
  src/rooms/Peer.cpp src/rooms/Peer.hpp
  src/rooms/Room.cpp src/rooms/Room.hpp
  src/rooms/Lobby.cpp src/rooms/Lobby.hpp
  src/utils/Nickname.cpp src/utils/Nickname.hpp
  src/utils/AppConfig.hpp src/utils/ConfigValidation.hpp src/utils/ServerBoundaries.hpp src/utils/Lifecycle.hpp
  src/utils/Statistics.cpp src/utils/Statistics.hpp
  src/dto/DTOs.hpp src/dto/Config.hpp)
  target_include_directories(conspire-lib PUBLIC
    "${CMAKE_CURRENT_SOURCE_DIR}/src" "${CONSPIRE_GENERATED_DIR}")
  target_compile_definitions(conspire-lib PUBLIC
  CERT_PEM_PATH="cert/privkey.pem" CERT_CRT_PATH="cert/fullchain.pem"
  CONSPIRE_VERSION="${CONSPIRE_VERSION}")
  target_link_libraries(conspire-lib
  PUBLIC oatpp::oatpp oatpp::oatpp-websocket oatpp::oatpp-openssl
  PRIVATE OpenSSL::SSL OpenSSL::Crypto)
  conspire_apply_sanitizer(conspire-lib)
  conspire_enable_warnings(conspire-lib)

  add_executable(conspire-exe src/App.cpp)
  target_link_libraries(conspire-exe PRIVATE conspire-lib)
  conspire_apply_sanitizer(conspire-exe)
  conspire_enable_warnings(conspire-exe)

  if(CONSPIRE_ENABLE_COVERAGE)
    if(NOT CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
      message(FATAL_ERROR "CONSPIRE_ENABLE_COVERAGE requires GCC or Clang")
    endif()
    foreach(target conspire-lib conspire-exe)
      target_compile_options(${target} PRIVATE --coverage -O0 -g)
      target_link_options(${target} PRIVATE --coverage)
    endforeach()
  endif()

  if(BUILD_TESTING)
    add_executable(conspire-test test/tests.cpp test/WSTest.cpp test/WSTest.hpp)
    target_link_libraries(conspire-test PRIVATE conspire-lib oatpp::oatpp-test)
    conspire_apply_sanitizer(conspire-test)
    conspire_enable_warnings(conspire-test)
    if(CONSPIRE_ENABLE_COVERAGE)
      target_compile_options(conspire-test PRIVATE --coverage -O0 -g)
      target_link_options(conspire-test PRIVATE --coverage)
    endif()
    add_test(NAME conspire-unit COMMAND conspire-test)
  endif()
endif()
