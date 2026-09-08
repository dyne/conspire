# Conspire P2P Dashboard

The embedded dashboard displays four groups of statistics from the Conspire
server: peer activity, room activity, communication, and system metrics. Each
visual chart has a matching summary and keyboard-accessible data table.

## Use

Open `/dashboard` on a running Conspire server. It loads that server's
configured statistics endpoint. A custom source may be supplied with a
`statsUrl` query parameter:

```
/dashboard?statsUrl=https://example.invalid/admin/stats.json
```

Statistics URLs must use HTTPS. `http` is allowed only for localhost during
development. The dashboard fetches the selected endpoint directly; it does not
use a CORS proxy. A remote endpoint must therefore be same-origin or explicitly
allow the dashboard origin through CORS.

Use **Load JSON File** to inspect a local JSON file. Files and remote responses
are limited to 1 MiB. The dashboard accepts at most 1,000 records. Loading,
empty data, invalid data, failures, and successful loads are announced in the
dashboard status region with the appropriate recovery action.

## Data format

Records must have numeric timestamps (microseconds) and numeric event fields.
The dashboard requires `timestamp`, `ev_peer_connected`, and
`ev_peer_disconnected`; the remaining values populate the corresponding chart
when present.

```json
[{"timestamp":1759175878080771,"ev_peer_connected":11,"ev_peer_disconnected":9}]
```

## Offline delivery and browser policy

Chart.js 4.4.7 is vendored at `dashboard/vendor/chart.umd.min.js` from the
official Chart.js distribution (MIT license in the adjacent license file). It
is embedded into the native binary at build time and served with immutable cache
semantics. The dashboard's CSP permits scripts only from the same origin; native
builds never fetch frontend dependencies.

For local static inspection, serve this directory with any HTTP server and use
a localhost statistics endpoint. Browser requests still enforce the same URL,
size, schema, and CORS policy as the embedded dashboard.
