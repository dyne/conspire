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

## Secure container runtime

The image is a runtime-only image: it has no compiler, development packages,
or certificate-generation command, and runs as the `conspire` user. Operators
must mount certificate files read-only; never copy a private key into an image.

The Docker build context is deliberately produced from the same CMake build
that review verifies, rather than expecting an untracked `./conspire` binary:

```sh
./scripts/build-vendored-oatpp.sh
CONSPIRE_DEPS_PREFIX="$PWD/build/deps" ./scripts/build-container.sh
```

It writes only ignored `build/` and `dist/container-*` outputs and builds the
runtime image from that deterministic context. The committed oatpp 1.4 sources
are built locally; the incompatible public oatpp 1.3 line is never substituted.

```sh
docker run --read-only --tmpfs /run/conspire:uid=100,gid=101 \
  -v "$PWD/cert:/run/certs:ro" -p 8443:8443 ghcr.io/dyne/conspire:latest
```

## Native development and tests

Native development uses CMake 3.20+, Ninja, GCC or Clang, and OpenSSL
development headers. Plain `make` builds the committed oatpp 1.4.0 sources into
a toolchain-specific local prefix before building Conspire; ccache is used when
available. The public oatpp 1.3.x releases are intentionally not fetched because
their API/layout is not compatible with this source tree.

```bash
make
```

When `/opt/dyne/gcc-musl/settings.cmake` is installed, `make` produces the
musl-linked `conspire-$(uname -m)` artifact. Otherwise it performs a native
build. Set `CMAKE_TOOLCHAIN_FILE`, `TARGET`, or `CONSPIRE_DEPS_PREFIX` explicitly
to override those defaults.

The equivalent native development and test commands are:

```bash
./scripts/build-vendored-oatpp.sh
cmake --preset native-gcc -DCONSPIRE_DEPS_PREFIX="$PWD/build/deps"
cmake --build --preset native-gcc
ctest --preset native-gcc

cmake --preset native-clang -DCONSPIRE_DEPS_PREFIX="$PWD/build/deps"
cmake --build --preset native-clang
ctest --preset native-clang
```

For a certificate-free local run, start the native build without `--tls` and
open <http://localhost:8080>:

```bash
./build/native-gcc/server/conspire-exe
```

TLS is opt-in. Pass `--tls` together with certificate paths when it is needed:

```bash
./build/native-gcc/server/conspire-exe --tls --port 8443 \
  --tls-key cert/privkey.pem --tls-chain cert/fullchain.pem
```

The real-process tests start this native binary on isolated localhost ports.
The protocol test connects three WebSocket clients, verifies broadcast and room
history, and checks clean shutdown. The Playwright test drives the served UI in
three independent browser contexts and verifies the versioned title,
participants, message delivery, and history without TLS:

```bash
npm ci
npx playwright install chromium
npm run test:e2e
npm run test:e2e:browser
```

Without the prefix, configure stops immediately with the exact prerequisite and
does not fetch a dependency. Release CI creates it from `vendor/` with the
same musl toolchain used for the release artifact.

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

For a local demonstration only, generate a certificate outside the image and
mount it as above:
```
mkdir cert \
&& openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout cert/privkey.pem   -out cert/test_cert.crt   \
  -subj "/C=NL/ST=Netherlands/L=Amsterdam/O=Dyne.org/CN=dyne.org" \
&& cat cert/test_cert.crt cert/privkey.pem > cert/fullchain.pem \
&& docker run --read-only --tmpfs /run/conspire:uid=100,gid=101 \
  -v "$PWD/cert:/run/certs:ro" -p 8443:8443 ghcr.io/dyne/conspire:latest
```

Conspire needs reachable WebSockets and a dedicated externally reachable port.
Container deployment is supported with the mounted-certificate contract above.

## Release and maintenance policy

Every pull request and `master` push runs the same CMake/CTest coverage,
browser, static-analysis, input-pin, and runtime-contract gates. Release jobs
depend on all of those gates and default to a non-publishing dry run. A
successful `master` push with a Conventional Commit version bump publishes a
release; maintainers can also use the protected publishing dispatch.

`scripts/check-release-inputs.sh` emits SHA-256 checksums, a source SPDX SBOM,
and provenance under `dist/metadata/`. Inputs must use immutable GitHub Action
commits and image digests. Critical or high dependency/image findings block a
release; an exception must name an owner, expiry (at most 30 days), and tracking
issue in the protected release record. CI never inherits release secrets outside
the protected publish job.

Dependency updates are reviewed weekly and after security advisories. The
committed oatpp 1.4 source snapshots make native, container, and release builds
self-contained; builds deliberately refuse to fetch or substitute oatpp 1.3.x.

Before contributing: run `npm run check:web`, `cmake --preset core-coverage-gcc`,
`cmake --build --preset core-coverage-gcc`, `ctest --preset core-coverage-gcc`,
and `./scripts/run-static-analysis.sh`. See the deployment guide for mounted
certificate troubleshooting and runtime variables, and
[maintenance evidence](docs/MAINTENANCE.md) for the complete release checklist.

## 📖 Production Deployment

For deploying Conspire on a server with TLS certificates and a custom landing page, see the [Deployment Guide](docs/DEPLOYMENT.md).

## 📊 Monitoring

Conspire exposes statistics at `/admin/stats.json`. The included [dashboard](dashboard/) provides real-time visualization of peer activity, room usage, and system metrics.

## 💼 License

Conspire is based on [can-chat](https://github.com/lganzzzo/canchat) by Leonid
Stryzhevskyi, it is written in C++ and built with [Oat++ Web Framework](https://oatpp.io/).

This project is released under [Apache License 2.0](LICENSE).
