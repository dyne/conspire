cmake_minimum_required(VERSION 3.20)

foreach(required FRONTEND_DIR DASHBOARD_DIR OUTPUT_HEADER OUTPUT_SOURCE)
  if(NOT DEFINED ${required})
    message(FATAL_ERROR "${required} is required")
  endif()
endforeach()

set(embedded_paths "")
set(embedded_files "")

macro(register_asset_directory directory prefix)
  file(GLOB_RECURSE discovered_assets
    RELATIVE "${directory}"
    LIST_DIRECTORIES false
    "${directory}/*")
  list(SORT discovered_assets)
  if(NOT discovered_assets)
    message(FATAL_ERROR "No assets found in ${directory}")
  endif()
  foreach(discovered_path IN LISTS discovered_assets)
    list(APPEND embedded_paths "${prefix}${discovered_path}")
    list(APPEND embedded_files "${directory}/${discovered_path}")
  endforeach()
endmacro()

register_asset_directory("${FRONTEND_DIR}" "")
register_asset_directory("${DASHBOARD_DIR}" "dashboard/")

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

list(LENGTH embedded_paths asset_count)
math(EXPR last_asset_index "${asset_count} - 1")
foreach(asset_index RANGE 0 ${last_asset_index})
  list(GET embedded_paths ${asset_index} relative_path)
  list(GET embedded_files ${asset_index} source_path)
  if(NOT relative_path MATCHES "^[A-Za-z0-9._/-]+$")
    message(FATAL_ERROR "Asset path cannot be embedded safely: ${relative_path}")
  endif()

  file(READ "${source_path}" asset_hex HEX)
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
