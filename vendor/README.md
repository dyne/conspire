# Vendored oatpp dependencies

These directories contain source snapshots, not Git submodules and not build
outputs. They are retained locally because Conspire requires the unreleased
oatpp 1.4.0 API line.

| Dependency | Upstream source | Snapshot commit | License |
| --- | --- | --- | --- |
| oatpp | https://github.com/oatpp/oatpp | `f83d648fd82dc222ef88aabbafb68efbd7d7bf50` | Apache-2.0 (`oatpp/LICENSE`) |
| oatpp-websocket | https://github.com/oatpp/oatpp-websocket | `e5b67adfd3105627ef700ac49308565c93c491f9` | Apache-2.0 (`oatpp-websocket/LICENSE`) |
| oatpp-openssl | https://github.com/oatpp/oatpp-openssl | `32c6ff8b59406470dbdff6dd65a21b671052abad` | Apache-2.0 (`oatpp-openssl/LICENSE`) |

Build products must remain outside these trees. The local dependency prefix used
for validation was deliberately not committed.
