# Makefile to download and build it all
OUTPUT ?= x86_64
TARGET ?= x86_64-linux-musl
VERSION ?= dev
R := $(CURDIR)
CONSPIRE_DEPS_PREFIX ?=

DESTDIR ?= /
PREFIX ?= usr/local

all: conspire

conspire:
	@test -n "$(CONSPIRE_DEPS_PREFIX)" || (echo "CONSPIRE_DEPS_PREFIX must name a verified compatible oatpp 1.4 prefix; public oatpp 1.3 is intentionally not fetched." >&2; exit 2)
	cmake -G Ninja -S server -B build -DARCH=$(TARGET) \
		-DCMAKE_TOOLCHAIN_FILE="/opt/dyne/gcc-musl/settings.cmake" \
		-DCONSPIRE_DEPS_PREFIX="$(CONSPIRE_DEPS_PREFIX)" -DCONSPIRE_VERSION="$(VERSION)"
	ninja -C build conspire-exe
	cp build/conspire-exe conspire-$(OUTPUT)
	/opt/dyne/gcc-musl/bin/$(TARGET)-strip conspire-$(OUTPUT)

clean:
	rm -rf build conspire

install:
	install -m 0755 conspire-$(OUTPUT) $(DESTDIR)$(PREFIX)/bin/conspire-$(OUTPUT)
	install -d -m 0755 $(DESTDIR)$(PREFIX)/share/conspire
	cp -ra front $(DESTDIR)$(PREFIX)/share/conspire
