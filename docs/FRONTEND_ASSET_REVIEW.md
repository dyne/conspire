# Frontend Asset Review

Reviewed: 2026-09-08
Scope: every committed HTML and JavaScript asset, plus the CSS and embedding code that determine their rendered behavior.

## Executive summary

Conspire ships three production web surfaces from hardcoded static assets:

1. A readable public landing page in `front/`.
2. A full-viewport room interface in `front/chat/`.
3. A responsive statistics dashboard in `dashboard/`.

The files are embedded byte-for-byte into the C++ server at build time by `server/cmake/EmbedFrontend.cmake` and served by `StaticController.hpp`. Runtime placeholders inject the versioned page title, room URLs, WebSocket configuration, statistics URL, and optional Tor link. Source files—not `build/generated/EmbeddedFrontend.*`—are the editable source of truth.

The frontend is dependency-light and mostly CSP-friendly. Production HTML keeps event behavior in external scripts, dynamic text is generally assigned through `textContent`, and the browser end-to-end test covers landing, dashboard, room entry, participant counts, messages, and history.

### Extraction status

On 2026-09-08, reusable primitives were extracted into `front/design-system.css` and exposed through the embedded `/design-system.css` route. Landing, chat, and dashboard styles now import that layer. Dashboard chart colors, loading/error presentation, and retry actions moved out of JavaScript literals; the current-participant color moved from an inline assignment to a semantic class. Surface-specific layout and component rules remain local by design.

## Asset inventory

### Production HTML

| Asset | Route / role | Visual ownership |
|---|---|---|
| `front/index.html` | `/`; public landing and room chooser | `front/style.css`, `front/lobby.js` |
| `front/chat/index.html` | `/room/{roomId}`; live room shell | `front/chat/chat.css`, `front/chat/ui.js`, `front/chat/chat.js` |
| `dashboard/index.html` | `/dashboard`; operational statistics | `dashboard/style.css`, `dashboard/app.js`, remote Chart.js |

### Production JavaScript

| Asset | Responsibility | Visual output |
|---|---|---|
| `front/lobby.js` | Opens the public room or a cryptographically random private room | No generated markup; binds the two landing actions |
| `front/chat/ui.js` | Binds drawer, send, and file actions; observes participant mutations | Toggles `.visible`; updates the participant count |
| `front/chat/chat.js` | WebSocket lifecycle, messages, participants, typing, and file exchange | Generates message groups, system messages, file tiles, typing chips, participant rows, and online/offline states |
| `front/chat/protocol.js` | Validates protocol messages and constructs file URLs/chunks | No direct visual output |
| `front/chat/format.js` | Formats file sizes and transfer spinner glyphs | Produces file metadata labels |
| `front/chat/state.js` | Creates isolated chat state | No direct visual output |
| `dashboard/app.js` | Loads and validates stats; creates charts and operational states | Generates loading/error notices, retry actions, chart datasets, tooltips, axes, and opacity states |

### Example and test assets

| Asset | Status | Notes |
|---|---|---|
| `docs/landing-example/index.html` | Deployment example | Standalone “Community Chat” page with inline CSS |
| `docs/landing-example/room.js` | Deployment example | Base58 room generator with a hardcoded port (`8443`) |
| `front/chat/coverage-fixture.js` | Test-only fixture | Intentionally under-covered; never part of the visual runtime contract |
| `playwright.config.mjs` | Test configuration | Configures the real browser contract |
| `test/browser-protocol.test.mjs` | Node test | Protocol boundaries, safe DOM sinks, room modules, and external handlers |
| `test/coverage-fixture.test.mjs` | Node test | Proves the intentional JavaScript coverage failure fixture |
| `test/static-quality.test.mjs` | Node test | Build-title placeholders, Tor insertion, embedded assets, and server guards |
| `test/playwright/chat-ui.spec.mjs` | Browser test | Exercises all three production surfaces |
| `test/e2e/chat-session.test.mjs` | Server/session test | Exercises room behavior without defining visual output |

## Hardcoded visual sources

### Landing

- The complete surface is static HTML plus `front/style.css`; only room navigation is dynamic. Reused primitives come from `front/design-system.css`.
- The layout is a `700px` reading column with `18px` body copy and `1.6` line-height.
- Actions hardcode Bright Blue (`#448aff`) and Bright Blue Active (`#2979ff`), `3px` corners, bold uppercase labels, and `9px 20px` padding.
- `.dark-mode` exists as an opt-in class, but no production script toggles it.

### Chat

- `front/chat/chat.css` owns the full-viewport shell, three graphite layers, mobile drawer, fixed composer, touch targets, and transitions.
- `front/chat/chat.js` constructs most repeated content with DOM methods rather than templates. Semantic classes assign the current participant and distribute other participants over eighteen shared pastel identity tokens.
- Message, file, participant, typing, and system states exist only after WebSocket events; static HTML alone does not expose the complete component set.
- Online and offline use pure green and red with text glow. Bright Blue is reused for send and download actions.

### Dashboard

- `dashboard/style.css` maps the shared primitives into its semantic colors, light/dark themes, focus states, controls, cards, and responsive layout.
- `dashboard/app.js` reads the ten chart-series tokens and semantic theme properties from CSS. Loading, error, and retry presentation is class-driven.
- The dashboard automatically follows `prefers-color-scheme` and also supports explicit `data-color-scheme` overrides in CSS.

### Deployment example

- The example intentionally remains self-contained, but its inline style block creates a fourth mini-system: slate actions (`#2c3e50`), darker hover (`#1a252f`), `600px` layout, and `4px` corners.
- `room.js` generates a secure random Base58 room identifier but bakes the destination scheme and port into JavaScript.

## Strengths to preserve

- Production pages use external JavaScript listeners instead of inline event attributes.
- User and remote strings are generally written with `textContent`, `createTextNode`, or safe URL construction.
- Dashboard statistics URLs, payload size, point count, and required numeric fields are validated before rendering.
- Room protocol parsing rejects malformed, unknown, and oversized messages.
- Chat is built around `100dvh`, safe-area padding, a flexible history region, and mobile-specific type sizing.
- Default chat actions are `44px` high and remain `40px` on narrow screens.
- Dashboard controls have explicit hover, active, disabled, and focus-visible treatments.
- The committed Playwright contract passed on 2026-09-08 and verified all three production surfaces in a real browser.

## Findings and maintenance risks

### High priority

1. **Chat disables user zoom.** `front/chat/index.html` sets `maximum-scale=1.0` and `user-scalable=no`. This blocks an important accessibility mechanism and should be removed when accessibility hardening is authorized.
2. **Core chat updates are not announced.** Messages, connection state, typing state, and participant changes have no `aria-live` or equivalent status semantics. Screen-reader users may not receive real-time changes.
3. **Emoji shortcuts are pointer-only paragraphs.** The emoji row uses clickable `<p>` elements created in HTML and bound in JavaScript. They are not keyboard controls and expose no action semantics.
4. **Focus visibility is inconsistent.** Landing and chat controls remove outlines without defining a replacement. Dashboard focus treatment is substantially stronger and should be the reference when convergence work is authorized.

### Medium priority

1. **The mobile participant drawer lacks state semantics.** The toggle has no `aria-expanded` or `aria-controls`; the drawer and background do not use `inert`, dialog, or complementary-navigation semantics.
2. **Duplicate participant-count IDs can occur.** The static toggle contains `#participant_count`, while `createParticipantsList()` creates another element with the same ID inside the participant rail. DOM lookup behavior then depends on document order.
3. **No reduced-motion mode exists.** Participant removal, typing chips, the mobile drawer, controls, and dashboard cards animate without a `prefers-reduced-motion` override.
4. **Chart canvases lack fallback descriptions.** Section headings name the metrics, but the canvases do not provide summaries, tabular alternatives, or accessible labels for the data itself.
5. **The dashboard loads unpinned remote Chart.js.** `https://cdn.jsdelivr.net/npm/chart.js` has no version or integrity metadata, making behavior and availability less deterministic than the embedded frontend.

### Low priority and cleanup

1. `front/index.html` omits `lang`, duplicates the charset declaration, and contains stale Jaromil-specific Open Graph and Twitter metadata unrelated to Conspire.
2. `dashboard/style.css` repeats dark/light semantic theme blocks and duplicates `.control-buttons` and `.load-file-btn` rules, increasing drift risk.
3. `dashboard/style.css` references `--font-mono` in `.stats-url code`; the declared token is `--font-family-mono`.
4. `front/chat/chat.js` retains obsolete IE selection handling and deprecated `keypress` / `event.which` logic.
5. `front/chat/chat.js` clears one participant container with `innerHTML = ""`; no untrusted content is inserted there, but `replaceChildren()` would match the safer pattern already used by the dashboard.
6. The `beforeunload` handler accepts an `e` parameter but refers to the global `event` object.
7. The deployment example uses inline CSS and a hardcoded `https` port, so it is illustrative rather than a reusable themed component.
8. Dashboard documentation still describes removed CORS-proxy and sample-data UI paths, while current code deliberately does not proxy statistics.

## Design-system boundary

`DESIGN.md` treats the implementation as one foundation with three explicit modes rather than pretending it is already uniform:

- **Landing mode** owns reading rhythm and room entry.
- **Chat mode** owns real-time conversation, presence, and file exchange.
- **Dashboard mode** owns monitoring, theme tokens, cards, charts, and denser operational controls.

The dashboard token vocabulary is the strongest implementation reference, but its cream/teal atmosphere should not overwrite the graphite chat workspace or the bright-blue communication action language. Future refactoring can centralize primitives without flattening these task-specific modes.

## Verification record

- `npm run check:web`: validates JavaScript syntax and the browser-facing Node tests.
- `npx playwright test test/playwright/chat-ui.spec.mjs --reporter=line`: passed on 2026-09-08 (`1 passed`).
- The static quality tests verify external event handlers, version placeholders, embedded assets, safe dashboard string handling, and explicit room module routes.

This review is descriptive. It documents implementation debt but does not modify runtime HTML, CSS, JavaScript, or server behavior.
