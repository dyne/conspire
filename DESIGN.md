---
name: Conspire
description: A civic, privacy-first interface for ephemeral rooms, direct exchange, and operational visibility.
colors:
  white: "#ffffff"
  warm-white: "rgba(252, 252, 249, 1)"
  warm-surface: "rgba(255, 255, 253, 1)"
  dark-text: "rgba(19, 52, 59, 1)"
  muted-text: "rgba(98, 108, 113, 1)"
  landing-text: "#444444"
  bright-blue: "#448aff"
  bright-blue-active: "#2979ff"
  teal: "rgba(33, 128, 141, 1)"
  teal-hover: "rgba(29, 116, 128, 1)"
  graphite: "#424242"
  deep-graphite: "#212121"
  input-graphite: "#383838"
  success-green: "#00ff00"
  alert-red: "#ff0000"
  warning-orange: "rgba(168, 75, 47, 1)"
  self-cyan: "#e0f7fa"
typography:
  display:
    fontFamily: "Geist, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "30px"
    fontWeight: 550
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "24px"
    fontWeight: 550
    lineHeight: 1.2
  title:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  reading:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
rounded:
  compact: "3px"
  control: "4px"
  sm: "6px"
  base: "8px"
  md: "10px"
  lg: "12px"
  pill: "9999px"
spacing:
  hairline: "1px"
  xs: "2px"
  compact: "4px"
  snug: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
  3xl: "32px"
components:
  landing-action:
    backgroundColor: "{colors.bright-blue}"
    textColor: "{colors.white}"
    typography: "{typography.body}"
    rounded: "{rounded.compact}"
    padding: "9px 20px"
  landing-action-hover:
    backgroundColor: "{colors.bright-blue-active}"
    textColor: "{colors.white}"
  chat-send:
    backgroundColor: "{colors.bright-blue}"
    textColor: "{colors.white}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    height: "44px"
  chat-secondary:
    backgroundColor: "rgba(255, 255, 255, 0.15)"
    textColor: "{colors.white}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    height: "44px"
  chat-input:
    backgroundColor: "rgba(255, 255, 255, 0.1)"
    textColor: "{colors.white}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px"
  dashboard-primary:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.warm-white}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  dashboard-secondary:
    backgroundColor: "rgba(94, 82, 64, 0.12)"
    textColor: "{colors.dark-text}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  dashboard-card:
    backgroundColor: "{colors.warm-surface}"
    textColor: "{colors.dark-text}"
    rounded: "{rounded.lg}"
    padding: "16px"
---

# Design System: Conspire

## Overview

**Creative North Star: "The Quiet Relay"**

Conspire should feel like civic infrastructure that happens to be intimate: direct enough to trust, restrained enough to disappear, and durable enough to use under pressure. Its visual language is deliberately low-ornament. Familiar controls, candid status text, and compact system typography keep attention on the room and its participants rather than on the interface.

The current implementation contains three legitimate surface modes. **Landing** is a narrow, readable invitation with bright blue actions. **Chat** is a full-viewport graphite workspace optimized for continuous conversation and file exchange. **Dashboard** is a warmer analytical surface built from cream, slate, and teal tokens with automatic dark mode. New work should share typography, plainspoken control behavior, compact radii, and explicit state communication while selecting the mode appropriate to the task.

The system is flat by default. Tonal contrast, borders, and adjacency establish hierarchy; shallow shadows are structural exceptions for the chat status bar, mobile overlays, and dashboard chart containers. Shared primitive values live in `front/design-system.css`; landing, chat, and dashboard styles import that layer and retain their task-specific semantic and component rules. The software is embedded into the server binary, so the source assets in `front/` and `dashboard/` are the visual source of truth.

## Browser Support Policy

Conspire supports the current and previous stable releases of Chrome, Firefox,
Safari, and Edge. The baseline is CSS custom properties, `:focus-visible`,
`100dvh`, and `color-scheme`; each is supported by those releases. Dashboard
automatic theming uses `prefers-color-scheme`, while explicit
`data-color-scheme` values remain the compatible override. Newer CSS features
are progressive enhancement only: core communication, focus, contrast, and
room creation must remain usable without them. Validate the shipped surfaces at
375px and 1440px, with reduced motion and forced colors where the browser
supports those modes.

**Key Characteristics:**

- Civic, clear, and durable rather than promotional.
- Privacy-first language with no identity theater or decorative surveillance cues.
- System and monospace type that loads locally and remains legible under constrained conditions.
- Bright blue for direct room actions, teal for analytical actions, and graphite for the live room shell.
- Compact corners, large touch targets, and visible operational states.
- Three explicit surface modes built on one plainspoken foundation.

## Colors

The palette combines literal infrastructure neutrals with two action accents: bright blue for participation and teal for monitoring. Signal colors remain rare and semantic.

### Primary

- **Bright Blue** (`#448aff`): the landing call to action, chat send action, and shared-file links. Its pressed state uses **Bright Blue Active** (`#2979ff`).
- **Teal** (`rgba(33, 128, 141, 1)`): the dashboard's primary action, chart emphasis, success state, and focus family. **Teal Hover** (`rgba(29, 116, 128, 1)`) provides the light-theme hover step.

### Secondary

- **Graphite** (`#424242`): the chat shell and status bar.
- **Deep Graphite** (`#212121`): the desktop participant rail.
- **Input Graphite** (`#383838`): the composer zone at the bottom of the room.

### Neutral

- **Warm White** (`rgba(252, 252, 249, 1)`): the dashboard's light background.
- **Warm Surface** (`rgba(255, 255, 253, 1)`): analytical cards and field surfaces.
- **Dark Text** (`rgba(19, 52, 59, 1)`): primary dashboard copy.
- **Muted Text** (`rgba(98, 108, 113, 1)`): dashboard annotations and supporting labels.
- **Landing Text** (`#444444`): long-form copy on the public landing page.
- **White** (`#ffffff`): chat copy and text on saturated actions.

### Tertiary

- **Success Green** (`#00ff00`): online connection state only.
- **Alert Red** (`#ff0000`): offline and participant-removal state only.
- **Warning Orange** (`rgba(168, 75, 47, 1)`): dashboard warning status.
- **Self Cyan** (`#e0f7fa`): the current participant in the participant rail.

### Named Rules

**The Two Accents Rule.** Use bright blue for entering, sending, or receiving in the communication surfaces; use teal for dashboard operations and analytical state. Do not interchange them casually.

**The Signal Means State Rule.** Pure green and pure red are reserved for live connection or removal states. Never use them as decoration.

**The Pastel Identity Rule.** The chat's eighteen pale participant swatches are ephemeral differentiation, not brand colors. They may identify participants inside a room but must not escape into navigation, marketing, or status semantics.

## Typography

**Display Font:** Geist with Inter and system fallbacks
**Body Font:** system UI with Segoe UI, Roboto, Helvetica, and Arial fallbacks
**Label/Mono Font:** Berkeley Mono where available, otherwise the platform monospace stack

**Character:** Typography is local-first, candid, and operational. Human-readable prose uses the platform sans; room identities, timestamps, file progress, and machine-adjacent values use monospace so state can be scanned quickly.

### Hierarchy

- **Display** (550, `30px`, 1.2): dashboard page title on wide screens.
- **Headline** (550, `24px`, 1.2): dashboard page title on narrow screens and major section headings.
- **Title** (600, `18px`, 1.2): card titles, landing subheads, and other compact sectional anchors.
- **Reading** (400, `18px`, 1.6): the narrow public landing page, capped at a comfortable `700px` measure.
- **Body** (400, `14px`, 1.5): controls, dashboard content, and chat messages; chat message text rises to `15px` on narrow screens.
- **Label** (500, `12px`, 1.5): participant counts, connection state, timestamps, file sizes, and chart annotations.

### Named Rules

**The Local Type Rule.** Core communication must remain fully usable without a font network request.

**The Monospace Is Evidence Rule.** Use monospace for identity, status, timestamps, paths, URLs, and transfer progress—not for decorative atmosphere.

## Layout

The system uses three task-specific spatial models:

- **Landing mode:** a centered reading column (`700px` maximum) with generous top and bottom whitespace. The action stack is an inline grid; explanatory rules follow in normal document flow.
- **Chat mode:** a full viewport (`100dvh`) vertical shell with a fixed-height status bar, flexible history, a `250px` desktop participant rail, and a persistent composer. At `768px` and below, the participant rail becomes a right-side drawer (`280px`, capped at `80vw`) with a scrim. At `380px` and below, emoji shortcuts disappear to protect composer space.
- **Dashboard mode:** a responsive container that steps through `640px`, `768px`, `1024px`, and `1280px` maximum widths. Charts use an auto-fit grid with `400px` minimum columns, collapse to one column at `768px`, and reduce padding and chart height at `480px`.

Spacing is compact and based mainly on `4px` increments, with `6px` and `10px` intermediate steps for controls. Chat prioritizes screen use and touch reach; dashboard prioritizes scanable grouping; landing prioritizes reading rhythm.

**The Surface Chooses the Grid Rule.** Do not force a single page grid across all modes. Share rhythm and component behavior, then use the spatial model that matches reading, conversation, or monitoring.

**The Primitive Once Rule.** Reusable color, type, spacing, radius, shadow, motion, and breakpoint values belong in `front/design-system.css`; surface styles may alias them into local semantic roles but must not redefine the literals.

**The Composer Stays Reachable Rule.** In chat mode, history absorbs available height while status and input areas remain visible. Preserve safe-area padding on mobile.

## Elevation & Depth

Conspire is flat by default. Landing relies on whitespace; chat relies on graphite steps; dashboard relies on warm surface contrast and hairline borders. The few shadows clarify stacking or interactive containment and must remain shallow.

### Shadow Vocabulary

- **Status separation** (`0 2px 4px rgba(0, 0, 0, 0.2)`): separates the fixed chat status bar from scrolling history.
- **Dashboard rest** (`0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02)`): gives chart cards minimal separation from the page.
- **Dashboard hover** (`0 4px 6px -1px rgba(0, 0, 0, 0.04), 0 2px 4px -1px rgba(0, 0, 0, 0.02)`): acknowledges hover without making cards float theatrically.
- **Mobile scrim** (`rgba(0, 0, 0, 0.5)`): establishes the participant drawer as a temporary foreground layer.

### Named Rules

**The Flat by Default Rule.** Start with background contrast and borders. Add a shadow only when it explains stacking, scroll separation, or interaction.

## Shapes

Corners are gently compact: `3px` on legacy landing actions and typing chips, `4px` on chat controls and file tiles, `6px` to `8px` on dashboard controls, and `12px` on dashboard cards. Full pills are reserved for semantic status indicators. There are no ornamental blobs or exaggerated capsules.

Borders are functional. The dashboard uses translucent one-pixel borders to distinguish cream or charcoal surfaces. The chat largely removes borders and separates zones through graphite tones. Content clipping belongs to cards and drawer boundaries, not to primary copy.

**The Small Radius Rule.** Controls should read as tools, not toys. Keep action radii between `3px` and `8px`; reserve `12px` for larger containers and full rounding for status chips.

## Components

Components are plainspoken and dependable: controls advertise their purpose, state changes are immediate, and touch targets are no smaller than the implemented `40px` mobile or `44px` default chat actions.

### Buttons

- **Landing primary:** bright blue, white uppercase copy, bold body type, compact corners (`3px`), and `9px 20px` padding. Hover and active use Bright Blue Active.
- **Chat primary:** bright blue, white medium-weight copy, compact corners (`4px`), and a `44px` default height. Mobile height is `40px`.
- **Chat secondary:** translucent white on graphite with the same geometry as the primary action; active opacity increases rather than changing hue.
- **Dashboard primary:** teal with warm-white text, compact corners (`6px`), and `6px 12px` padding. Hover, active, and focus-visible states are explicit.
- **Dashboard secondary:** a translucent brown-gray surface with a one-pixel border. It shares primary button geometry to avoid false hierarchy.

### Inputs / Fields

- **Chat composer:** a borderless transparent textarea inside a translucent white container on Input Graphite. The container uses compact corners (`4px`) and `8px` internal padding. Placeholder copy is half-opacity white. Mobile text is `16px` to avoid focus zoom.
- **Dashboard fields:** warm surface, one-pixel translucent border, base corners (`8px`), and `8px 12px` padding. Focus changes the border to teal and adds a two-pixel teal outline.
- **Hidden file controls:** remain native inputs triggered by visible buttons; visual styling belongs to the explicit action, not the hidden input.

### Cards / Containers

- **Dashboard chart card:** Warm Surface, gently rounded corners (`12px`), one-pixel border, `16px` padding, and a shallow structural shadow. It tightens to `12px` padding below `768px`.
- **Landing note:** remains part of the reading flow rather than becoming a card. Whitespace and headings are sufficient hierarchy.
- **Chat file tile:** a five-percent white surface with compact corners (`4px`); its download link is bright blue and its file size/progress is monospace.

### Navigation

Conspire has no persistent global navigation. The landing page opens rooms in a separate tab, the chat status bar exposes connection and participant state, and the dashboard controls remain within its header. Do not invent a navigation shell unless a new product surface genuinely needs one.

### Messages and Participants

- **Message group:** author and timestamp appear once above consecutive messages from the same peer; message copy remains white, pre-wrapped, and left aligned.
- **System message:** smaller and partially transparent, prefixed with a loudspeaker glyph rather than enclosed in a competing card.
- **Participant row:** monospace label, pale ephemeral identity fill, compact corners (`3px`), and a distinct Self Cyan fill for the current user. Join and leave transitions collapse height rather than animate position theatrically.
- **Typing chip:** translucent white, monospace, compact, and temporary. Its dot cycle communicates activity without introducing a spinner.

### Status and Charts

- **Connection state:** lowercase monospace text. Online uses Success Green with a restrained glow; offline uses Alert Red with full opacity.
- **Dashboard status chip:** a tinted background and border derived from teal, red, orange, or muted slate; full pill geometry is allowed because the component is purely semantic.
- **Chart palette:** JavaScript assigns ten literal dataset colors (`#1fb8cd`, `#ffc185`, `#b4413c`, `#ecebd5`, `#5d878f`, `#db4545`, `#d2ba4c`, `#964325`, `#944454`, `#13343b`). Keep labels, axes, and tooltips bound to CSS semantic colors even when datasets remain categorical.
- **Loading and error:** loading reduces the chart grid to half opacity and inserts muted centered text. Error reduces it to thirty-percent opacity and inserts a pale-red notice with a direct retry action.

## Do's and Don'ts

### Do:

- **Do** choose Landing, Chat, or Dashboard mode explicitly before composing a new surface.
- **Do** use system typography and native semantic controls for core communication.
- **Do** preserve visible focus, active, loading, offline, and error states.
- **Do** keep chat actions at least `40px` high on narrow screens and `44px` by default.
- **Do** use bright blue for communication actions and teal for analytical actions.
- **Do** keep participant colors ephemeral and local to the room.
- **Do** bind chart chrome and dashboard state to semantic CSS custom properties.

### Don't:

- **Don't** merge the three surface modes into an undifferentiated palette or layout.
- **Don't** add ornamental shadows, gradients, glass effects, or oversized radii.
- **Don't** use green, red, or participant pastels as decorative brand accents.
- **Don't** rely on remote fonts for essential readability.
- **Don't** hide focus by removing outlines without an equally visible replacement.
- **Don't** place static design values in JavaScript when the same role can live in CSS tokens.
- **Don't** treat current inline styles and duplicate declarations as preferred patterns; they are implementation debt, not design doctrine.
