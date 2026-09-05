cmake_minimum_required(VERSION 3.20)

foreach(required FRONTEND_DIR OUTPUT_HEADER OUTPUT_SOURCE)
  if(NOT DEFINED ${required})
    message(FATAL_ERROR "${required} is required")
  endif()
endforeach()

file(GLOB_RECURSE frontend_assets
  RELATIVE "${FRONTEND_DIR}"
  LIST_DIRECTORIES false
  "${FRONTEND_DIR}/*")
list(SORT frontend_assets)
if(NOT frontend_assets)
  message(FATAL_ERROR "No frontend assets found in ${FRONTEND_DIR}")
endif()

set(header [=[#pragma once

#include <string_view>

namespace conspire::frontend {

std::string_view findAsset(std::string_view path) noexcept;

} // namespace conspire::frontend
]=])

set(source [=[#include "EmbeddedFrontend.hpp"

#include <cstddef>

namespace {

struct AssetEntry {
  std::string_view path;
  const unsigned char* data;
  std::size_t size;
};

]=])
set(entries "")

foreach(relative_path IN LISTS frontend_assets)
  if(NOT relative_path MATCHES "^[A-Za-z0-9._/-]+$")
    message(FATAL_ERROR "Frontend asset path cannot be embedded safely: ${relative_path}")
  endif()

  file(READ "${FRONTEND_DIR}/${relative_path}" asset_hex HEX)
  string(LENGTH "${asset_hex}" hex_length)
  math(EXPR asset_size "${hex_length} / 2")
  string(MAKE_C_IDENTIFIER "frontend_${relative_path}" symbol)
  string(REGEX REPLACE "([0-9a-f][0-9a-f])" "0x\\1," asset_bytes "${asset_hex}")
  if(asset_size EQUAL 0)
    set(asset_bytes "0x00,")
  endif()

  string(APPEND source
    "constexpr unsigned char ${symbol}[] = {${asset_bytes}};\n")
  string(APPEND entries
    "  {\"${relative_path}\", ${symbol}, ${asset_size}},\n")
endforeach()

string(APPEND source "\nconstexpr AssetEntry assets[] = {\n${entries}};\n\n} // namespace\n\n")
string(APPEND source [=[namespace conspire::frontend {

std::string_view findAsset(std::string_view path) noexcept {
  for (const auto& asset : assets) {
    if (asset.path == path) {
      return {reinterpret_cast<const char*>(asset.data), asset.size};
    }
  }
  return {};
}

} // namespace conspire::frontend
]=])

foreach(kind HEADER SOURCE)
  string(TOLOWER "${kind}" content_name)
  set(output "${OUTPUT_${kind}}")
  set(temporary "${output}.tmp")
  file(WRITE "${temporary}" "${${content_name}}")
  execute_process(
    COMMAND "${CMAKE_COMMAND}" -E copy_if_different "${temporary}" "${output}"
    COMMAND_ERROR_IS_FATAL ANY)
  file(REMOVE "${temporary}")
endforeach()
