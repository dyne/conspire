#!/bin/bash

BUILD_TYPE=$1

if [ -z "$BUILD_TYPE" ]; then
    BUILD_TYPE="Release"
fi

# Get the absolute path to the project root (parent of utility directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
INSTALL_PREFIX="$PROJECT_ROOT/build/deps"

echo "Installing dependencies to: $INSTALL_PREFIX" >&2

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

  echo "INSTALLING MODULE '$MODULE_NAME' ($BUILD_TYPE) using $NPROC threads ..." >&2

  git clone --depth=1 https://github.com/oatpp/$MODULE_NAME build/$MODULE_NAME

  mkdir -p build/$MODULE_NAME/build
  cd build/$MODULE_NAME/build

  cmake -DOATPP_DISABLE_ENV_OBJECT_COUNTERS=ON \
        -DCMAKE_BUILD_TYPE=$BUILD_TYPE \
        -DOATPP_BUILD_TESTS=OFF \
        -DCMAKE_INSTALL_PREFIX="$INSTALL_PREFIX" \
        ..

  make install -j $NPROC

  cd -
}

##########################################################

install_module $BUILD_TYPE oatpp
install_module $BUILD_TYPE oatpp-websocket
install_module $BUILD_TYPE oatpp-openssl
