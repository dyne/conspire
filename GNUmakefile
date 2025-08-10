# Makefile to download and build it all
OUTPUT ?= x86_64
TARGET ?= x86_64-linux-musl
R := $(CURDIR)
I := $(R)/build/deps

all: build/deps conspire

conspire:
	cmake -G Ninja -S server -B build -DARCH=$(TARGET) \
		-DCMAKE_TOOLCHAIN_FILE="/opt/dyne/gcc-musl/settings.cmake"
	ninja -C build
	cp build/canchat-exe conspire-$(OUTPUT)
	/opt/dyne/gcc-musl/bin/$(TARGET)-strip conspire-$(OUTPUT)

build/deps: build/oatpp.orig build/oatpp-websocket.orig build/oatpp-openssl.orig
	$(info Conspire build TARGET: $(TARGET))
	cd build/oatpp.orig \
		&& cmake -DARCH=$(TARGET) -DCMAKE_TOOLCHAIN_FILE="/opt/dyne/gcc-musl/settings.cmake" \
    -DOATPP_BUILD_TESTS=OFF -DCMAKE_INSTALL_PREFIX=$(CURDIR)/build/deps \
		-G Ninja -S . -B build \
			&& ninja -C build install
	cd build/oatpp-websocket.orig \
		&& cmake -DARCH=$(TARGET) -DCMAKE_TOOLCHAIN_FILE="/opt/dyne/gcc-musl/settings.cmake" \
    -DOATPP_BUILD_TESTS=OFF -DCMAKE_INSTALL_PREFIX=$(CURDIR)/build/deps .. \
		-G Ninja -S . -B build \
			&& ninja -C build install
	cd build/oatpp-openssl.orig \
		&& cmake -DARCH=$(TARGET) -DCMAKE_TOOLCHAIN_FILE="/opt/dyne/gcc-musl/settings.cmake" \
    -DOATPP_BUILD_TESTS=OFF -DCMAKE_INSTALL_PREFIX=$(CURDIR)/build/deps .. \
		-G Ninja -S . -B build \
			&& ninja -C build install

build/%.orig:
	git clone --depth=1 https://github.com/oatpp/$* $@

clean:
	rm -rf build conspire
