# Makefile to download and build it all

all: build/deps/lib/oatpp-1.4.0/liboatpp.a
	cd build && cmake -DCMAKE_BUILD_TYPE=Release ../server
	cd build && make

deps:
	apt-get install bash g++ cmake make git libssl-dev


build/deps/lib/oatpp-1.4.0/liboatpp.a:
	bash utility/install-oatpp-modules.sh Release

clean:
	rm -rf build
