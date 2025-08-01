#!/bin/bash

BUILD_TYPE=$1

if [ -z "$BUILD_TYPE" ]; then
    BUILD_TYPE="Debug"
fi

# Get the absolute path to the project root (parent of utility directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
INSTALL_PREFIX="$PROJECT_ROOT/build/deps"

echo "Installing dependencies to: $INSTALL_PREFIX"

# Create the dependencies directory
mkdir -p "$INSTALL_PREFIX"

##########################################################
## install oatpp module

function install_module () {

BUILD_TYPE=$1
MODULE_NAME=$2
NPROC=$(nproc)

if [ -z "$NPROC" ]; then
    NPROC=1
fi

echo "\n\nINSTALLING MODULE '$MODULE_NAME' ($BUILD_TYPE) using $NPROC threads ...\n\n"

# Create temporary directory for building
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"

git clone --depth=1 https://github.com/oatpp/$MODULE_NAME

cd $MODULE_NAME
mkdir build
cd build

cmake -DOATPP_DISABLE_ENV_OBJECT_COUNTERS=ON \
      -DCMAKE_BUILD_TYPE=$BUILD_TYPE \
      -DOATPP_BUILD_TESTS=OFF \
      -DCMAKE_INSTALL_PREFIX="$INSTALL_PREFIX" \
      ..
make install -j $NPROC

# Clean up temporary directory
cd "$PROJECT_ROOT"
rm -rf "$TEMP_DIR"

}

##########################################################

echo "Installing oatpp modules..."

install_module $BUILD_TYPE oatpp
install_module $BUILD_TYPE oatpp-websocket

echo "All modules installed successfully to: $INSTALL_PREFIX"
echo "To build the project, add this to your CMakeLists.txt:"
cat << EOF
# Add local dependencies path
set(DEPS_PREFIX "\${CMAKE_CURRENT_SOURCE_DIR}/../build/deps")
if(EXISTS "\${DEPS_PREFIX}")
    list(PREPEND CMAKE_PREFIX_PATH "\${DEPS_PREFIX}")
    message(STATUS "Using local dependencies from: \${DEPS_PREFIX}")
endif()
EOF