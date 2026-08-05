# Tony Router UI Design Contract

Status: **Approved**  
Approved on: **2026-08-05**  
Product: **Tony Router**  
Product mode: **Workspace**  
Design system: `product-ui-design-system` + `tony-design-system`  
Approved mockup artifact: `tony-router-font-correct.html`  
Approved mockup SHA-256: `6b45a4da01a73e6988f2429f653d443f148556f024c89fabdf273f80284bf386`

## Visual-contract rule

The approved mockup is the visual contract for the Tony Router control-plane UI.

When converting it into production HTML/CSS/TypeScript, preserve its:

- layout and information hierarchy;
- navigation model;
- workspace density;
- typography scale and font roles;
- spacing rhythm;
- surface and divider strategy;
- table structure;
- semantic color usage;
- responsive priorities;
- interaction intent and state hierarchy.

Functionality must be added through compatible states and interactions. Do not redesign the interface while implementing it. Any substantial visual or structural deviation requires explicit approval and a new mockup review.

## Product intent

Tony Router is a local-first developer control plane, not a generic analytics dashboard. Its highest-value tasks are:

1. understand which route, model, provider, and account will handle a request;
2. inspect provider-account health and capability coverage;
3. identify rejected or unhealthy requests quickly;
4. test Responses and Chat Completions behavior safely;
5. manage local connection and configuration without exposing credentials.

Provider, account, model/profile, and route are distinct identities and must remain visually and semantically distinct.

## Information architecture

Primary navigation:

1. Overview
2. Providers
3. Models
4. Playground
5. Traces
6. Connection

Desktop uses a persistent left workspace sidebar. Mobile uses a fixed bottom navigation for the five most frequent destinations; Connection remains available through contextual actions.

### Overview

The Overview is operational, not promotional. It contains:

- a compact runtime status strip;
- the active routing plan;
- recent request traces;
- a prioritized “Needs attention” queue.

Do not replace the status strip with large KPI cards. Do not add charts unless a real operator question requires trend data.

### Providers

Use a comparison table for provider accounts and a contextual detail panel for the selected account.

The screen must communicate:

- provider adapter identity;
- account identity;
- base URL or safe endpoint summary;
- credential state as configured/missing only;
- health and latency category;
- model/profile and route coverage;
- local managed-control state.

Never display raw keys, authorization headers, provider response bodies, or unredacted errors.

### Models

Use a searchable, capability-oriented registry. Public model/profile IDs and upstream model IDs must not be silently conflated.

Capabilities represented by the current product include:

- tools;
- parallel tool calls;
- vision;
- inline PDF/file input;
- structured output;
- reasoning;
- context size.

### Playground

Support two explicit modes:

- Responses API;
- Chat Completions.

Capability controls must affect the visible request envelope and route eligibility. Streaming output is presented as an ordered event stream, not as decorative chat bubbles.

### Traces

Use a dense table optimized for scanning:

- request ID;
- method;
- endpoint;
- public model/profile;
- selected route/provider/account where safely available;
- status;
- duration;
- timestamp.

Prompts and sensitive payloads are outside bounded dashboard telemetry.

### Connection

Explain the local security boundary. The local bearer token may be held only for the active browser tab/session and must never be rendered back after connection.

## Typography

### Primary UI font

Use **Inter** for navigation, headings, labels, controls, body copy, tables, and status text.

```css
--font-sans:
  Inter, 'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI',
  Roboto, Helvetica, Arial, sans-serif;
```

### Technical font

Use **JetBrains Mono** for:

- model IDs;
- route IDs;
- provider/account IDs where technical identity matters;
- endpoints;
- request IDs;
- code/config output;
- latency and machine-readable values where alignment helps.

```css
--font-mono: 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;
```

Production must load these fonts deterministically. Prefer bundled/self-hosted assets for the local control plane; an approved external stylesheet is acceptable only when the runtime policy permits it. Verification screenshots must wait for `document.fonts.ready` and confirm that Inter and JetBrains Mono are actually loaded rather than silently falling back.

### Production font loading decision

The local control plane keeps the restrictive `style-src 'self'` Content Security Policy and does not contact Google Fonts or another remote font host. The production stylesheet uses the approved deterministic stacks exactly:

- `Inter`, then the documented local/system sans-serif fallback chain;
- `JetBrains Mono`, then the documented local/system monospace fallback chain.

The client waits for `document.fonts.ready`, records the resolved font state on the root element, and reports whether both named fonts loaded or the documented fallback is active. This preserves CSP and offline operation without silently claiming that a remote font loaded.

## Color system

Tony Lime is the shared brand accent, not a universal status color.

Core brand values:

```css
--tony-lime-100: #efffc2;
--tony-lime-300: #d4ff40;
--tony-lime-400: #c8f500;
--tony-lime-700: #637900;
```

Use Tony Lime for:

- brand mark;
- active navigation;
- selected states;
- primary brand action;
- limited live/accent emphasis.

Use independent semantic colors for information and health:

```css
--color-info: #2563eb;
--color-success: #16803a;
--color-warning: #b65c00;
--color-danger: #d1242f;
```

Do not use purple AI gradients, neon glow, or lime for every successful state. Light and dark themes must preserve semantic meaning and readable contrast.

## Surfaces, density, and shape

Create hierarchy in this order:

1. content and typography;
2. spacing;
3. alignment and grid;
4. divider or border;
5. surface change;
6. container/card;
7. elevation.

Rules:

- warm-neutral canvas and surfaces;
- compact workspace density;
- 4px spacing foundation;
- restrained radii: approximately 4px, 6px, 8px, and 12px;
- subtle borders and dividers;
- elevation only for transient or clearly raised elements;
- tables for comparable entities and traces;
- cards only for truly independent entities or focused actions.

Avoid grids of decorative cards, oversized metrics, glassmorphism, excessive pills, gradients used as filler, and chart-heavy admin-dashboard patterns.

## Responsive priorities

### Desktop

- persistent sidebar around 232px;
- content width may expand for routing and trace tables;
- runtime status remains compact;
- Overview prioritizes routing plan, traces, then attention queue;
- provider inventory and detail panel may coexist.

### Mobile

- minimum supported width: 320px;
- bottom navigation replaces the desktop sidebar;
- primary actions are at least 44px high;
- status strip wraps without horizontal overflow;
- routing rows stack while preserving profile → route → account → capability reading order;
- provider detail follows the inventory rather than squeezing beside it;
- traces may use a controlled horizontal table scroller, never page-level overflow;
- safe-area insets are respected.

## Accessibility and interaction

Required:

- semantic landmarks and headings;
- keyboard-operable navigation, tables, forms, and view switching;
- visible focus rings independent from brand lime;
- minimum 44px mobile targets for primary controls;
- reduced-motion support;
- status conveyed by text/icon as well as color;
- accessible names for icon-only controls;
- no focus loss when views or selected entities change;
- dark and light theme contrast checks.

Motion is short and functional. View transitions may use restrained opacity/position changes, but no decorative continuous animation.

## Security and privacy presentation

The UI must reinforce, not weaken, Tony Router boundaries:

- loopback-first operation;
- local bearer authentication;
- credential redaction;
- environment-variable-only provider setup;
- bounded in-memory telemetry;
- no prompt persistence in dashboard telemetry;
- no raw provider response rendering;
- no local fetching, rendering, OCR, or persistence of image/PDF request input;
- managed apply/rollback shown only when loopback control is enabled.

## Implementation mapping

The current UI is served by the gateway and owned by:

- `apps/gateway/src/ui.ts`;
- `apps/gateway/src/ui-assets/html.ts`;
- `apps/gateway/src/ui-assets/styles*.ts`;
- `apps/gateway/src/ui-assets/client*.ts`;
- gateway UI and telemetry tests.

Implementation should preserve existing runtime/API contracts while replacing visual composition. Keep behavior changes separate from visual refactoring where practical.

Recommended sequence:

1. map semantic tokens and deterministic font loading;
2. implement shell/navigation and responsive structure;
3. implement Overview status strip, routing plan, traces, and attention queue;
4. migrate Providers, Models, Playground, Traces, and Connection views;
5. bind existing runtime states and failure paths;
6. run exact-build visual comparison against the approved mockup.

## Verification contract

A UI implementation is not approved merely because it builds.

Required evidence:

- exact commit/build identity;
- production UI rendered from the gateway, not a replacement fixture;
- desktop screenshot at 1440 × 1000;
- mobile screenshot at 390 × 844;
- dark and light themes;
- loading, unauthenticated, empty, healthy, warning, and error states;
- keyboard focus traversal;
- reduced-motion behavior;
- no page-level horizontal overflow at 320px, 390px, and desktop widths;
- deterministic Inter and JetBrains Mono loading;
- targeted UI tests followed by `pnpm verify`.

Compare the production result with the approved mockup at the same viewport. Typography, geometry, density, hierarchy, and responsive behavior are fidelity requirements, not suggestions.

## Change control

Minor compatibility adjustments are allowed when required by real data or accessibility, provided they preserve the contract.

The following require explicit approval:

- changing the navigation model;
- replacing tables with card grids;
- reintroducing large KPI cards or generic charts;
- changing the font families;
- replacing Tony Lime or semantic colors with a new palette;
- changing workspace density substantially;
- removing the routing plan or attention queue from Overview;
- materially changing mobile priorities;
- adding decorative gradients, glow, glass, or AI-themed styling;
- any implementation that differs substantially from the approved mockup.
