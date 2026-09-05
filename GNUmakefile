# Build the vendored dependencies and Conspire.
OUTPUT ?= $(shell uname -m)
MUSL_TARGET ?= x86_64-linux-musl
DYNE_MUSL_ROOT ?= /opt/dyne/gcc-musl
CMAKE_TOOLCHAIN_FILE ?= $(wildcard $(DYNE_MUSL_ROOT)/settings.cmake)
TARGET ?= $(if $(strip $(CMAKE_TOOLCHAIN_FILE)),$(MUSL_TARGET),native)
VERSION ?= dev
R := $(CURDIR)
BUILD_DIR ?= build
CONSPIRE_DEPS_PREFIX ?= $(abspath $(BUILD_DIR)/deps-$(TARGET))
CONSPIRE_VENDOR_BUILD_DIR ?= $(abspath $(BUILD_DIR)/vendor-oatpp-$(TARGET))
STRIP ?= $(if $(strip $(CMAKE_TOOLCHAIN_FILE)),$(DYNE_MUSL_ROOT)/bin/$(TARGET)-strip,strip)
ARTIFACT := conspire-$(OUTPUT)
ARTIFACT_TEMP := $(ARTIFACT).new

DESTDIR ?= /
PREFIX ?= usr/local

all: conspire

deps:
	@if ! test -f "$(CONSPIRE_DEPS_PREFIX)/lib/cmake/oatpp-1.4.0/oatppConfig.cmake" \
		|| ! test -f "$(CONSPIRE_DEPS_PREFIX)/lib/cmake/oatpp-websocket-1.4.0/oatpp-websocketConfig.cmake" \
		|| ! test -f "$(CONSPIRE_DEPS_PREFIX)/lib/cmake/oatpp-openssl-1.4.0/oatpp-opensslConfig.cmake"; then \
		echo "Building vendored oatpp 1.4 dependencies in $(CONSPIRE_DEPS_PREFIX)"; \
		CONSPIRE_DEPS_PREFIX="$(CONSPIRE_DEPS_PREFIX)" \
		CONSPIRE_VENDOR_BUILD_DIR="$(CONSPIRE_VENDOR_BUILD_DIR)" \
		CMAKE_TOOLCHAIN_FILE="$(CMAKE_TOOLCHAIN_FILE)" \
		./scripts/build-vendored-oatpp.sh; \
	fi

conspire: deps
	cmake -G Ninja -S server -B "$(BUILD_DIR)" -DARCH=$(TARGET) \
		$(if $(strip $(CMAKE_TOOLCHAIN_FILE)),-DCMAKE_TOOLCHAIN_FILE="$(CMAKE_TOOLCHAIN_FILE)",) \
		-DCONSPIRE_DEPS_PREFIX="$(CONSPIRE_DEPS_PREFIX)" -DCONSPIRE_VERSION="$(VERSION)"
	ninja -C "$(BUILD_DIR)" conspire-exe
	install -m 0755 "$(BUILD_DIR)/conspire-exe" "$(ARTIFACT_TEMP)"
	"$(STRIP)" "$(ARTIFACT_TEMP)"
	mv "$(ARTIFACT_TEMP)" "$(ARTIFACT)"

clean:
	rm -rf "$(BUILD_DIR)" "$(ARTIFACT)" "$(ARTIFACT_TEMP)"

install:
	install -d -m 0755 $(DESTDIR)$(PREFIX)/bin
	install -m 0755 "$(ARTIFACT)" $(DESTDIR)$(PREFIX)/bin/"$(ARTIFACT)"

.PHONY: all deps conspire clean install
