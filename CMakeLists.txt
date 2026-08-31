cmake_minimum_required(VERSION 3.20)

project(conspire-workspace LANGUAGES CXX)

set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

include(CTest)

add_subdirectory(server)
