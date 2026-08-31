<div align="center">

![Conspire logotype](https://dyne.org/images/logos/conspire_text_black.svg)

**Conspire** is a web-based chat for radical exchange: peer to peer,
ephemeral, anonymous, and synchronous.

</div>

Jump into instant rooms where voices and files move
peer-to-peer, leaving no footprints. Conspire is built for privacy and digital
autonomy.

## 🚀 Quick Start

Go to [conspire.dyne.org](https://dyne.org/conspire) and bring your friends.

Run locally on docker (self-signed certs, demo only!):
```

## Native development and tests

Native development uses CMake 3.20+, Ninja, GCC or Clang, and OpenSSL
development headers. It requires an externally supplied compatible oatpp 1.4.0
prefix containing oatpp, oatpp-websocket, and oatpp-openssl. The public oatpp
1.3.x releases are intentionally not fetched because their API/layout is not
compatible with this source tree.

```bash
cmake --preset native-gcc -DCONSPIRE_DEPS_PREFIX=/path/to/oatpp-1.4-prefix
cmake --build --preset native-gcc
ctest --preset native-gcc

cmake --preset native-clang -DCONSPIRE_DEPS_PREFIX=/path/to/oatpp-1.4-prefix
cmake --build --preset native-clang
ctest --preset native-clang
```

Without the prefix, configure stops immediately with the exact prerequisite and
does not fetch a dependency. The existing `make conspire` release path remains
the musl cross-build entry point.

When installed, `ccache` is detected automatically for native builds; its
absence is safe and never changes build output. Coverage and sanitizer builds
retain their compiler flags in the cache key, so never reuse a cache entry by
manually stripping instrumentation flags. Set `-DCONSPIRE_USE_CCACHE=OFF` to
diagnose a build without the cache.

The dependency-independent configuration tests remain runnable while the
compatible prefix is unavailable:

```bash
cmake --preset core-tests-gcc
cmake --build --preset core-tests-gcc
ctest --preset core-tests-gcc

cmake --preset core-coverage-gcc
cmake --build --preset core-coverage-gcc
ctest --preset core-coverage-gcc
npm run coverage:browser
```

Browser coverage enforces 70% lines and branches (the protocol helper must
remain at 85% lines); Node prints the report and fails below either threshold.
The checked-in `front/chat/coverage-fixture.js` deliberately leaves one export
uncovered, so this control must fail and demonstrates the gate:

```bash
node --experimental-test-coverage --test-coverage-include=front/chat/coverage-fixture.js \
  --test-coverage-lines=80 --test test/coverage-fixture.test.mjs
```

The GCC/Clang project-target 70% line / 60% branch gate is deliberately
deferred until a compatible oatpp 1.4 prefix is supplied. The core preset is a
non-decreasing test seam, not a substitute for that future project report.
Its CTest coverage gate enforces 70% lines / 60% branches across the offline
production helpers and 85% lines per helper; a `WILL_FAIL` fixture proves the
same C++ gate rejects an under-covered source. CI runs and uploads these gcov
reports through that CTest preset.
Until then, the offline core gate covers the production configuration parser
and URL builders, room-history trimming and ID lookup seams, and download
filename/file-descriptor boundaries. Oatpp-dependent peer lifecycle, streaming
subscriber, DTO serialization, statistics-loop retention, and PID integration
remain explicitly deferred; the native preset refuses to configure rather than
silently reporting partial project coverage.

### Sanitizers and bounded lifecycle stress

The following opt-in presets keep release builds free of sanitizer flags while
testing the dependency-independent lifecycle seam with a fixed, recorded seed
and a 20-second timeout:

```sh
cmake --preset core-asan-ubsan && cmake --build --preset core-asan-ubsan && ctest --preset core-asan-ubsan
cmake --preset core-tsan && cmake --build --preset core-tsan && ctest --preset core-tsan
```

`CONSPIRE_STRESS_SEED` defaults to `424242`; override it at configure time to
reproduce or extend a failure. Full server sanitizer and websocket stress runs
remain blocked until a compatible oatpp 1.4 prefix is supplied; the native
presets intentionally fail with the existing actionable prefix diagnostic
rather than silently downgrading to oatpp 1.3.
docker run -p8443:8443 ghcr.io/dyne/conspire:latest
```

Create self signed certs and run locally:
```
mkdir cert \
&& openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout cert/privkey.pem   -out cert/test_cert.crt   \
  -subj "/C=NL/ST=Netherlands/L=Amsterdam/O=Dyne.org/CN=dyne.org" \
&& cat cert/test_cert.crt cert/privkey.pem > cert/fullchain.pem \
&& ./conspire
```

Please know conspire needs reachable websockets and has CORS safety controls in place, therefore it needs to be directly connected to the network with a port dedicated to it. Running it inside a container is not supported.

## 📖 Production Deployment

For deploying Conspire on a server with TLS certificates and a custom landing page, see the [Deployment Guide](docs/DEPLOYMENT.md).

## 📊 Monitoring

Conspire exposes statistics at `/admin/stats.json`. The included [dashboard](dashboard/) provides real-time visualization of peer activity, room usage, and system metrics.

## 💼 License

Conspire is based on [can-chat](https://github.com/lganzzzo/canchat) by Leonid
Stryzhevskyi, it is written in C++ and built with [Oat++ Web Framework](https://oatpp.io/).

This project is released under [Apache License 2.0](LICENSE).
