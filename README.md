# Fleet Pulse — Real-Time Operations Monitoring Console

Fleet Pulse is a resilient real-time operational monitoring console built in **Angular 21+**, engineered to stream, track, and alert across 2,000 microservices during high-stress operational incidents. The console continues functioning reliably through network outages, server disconnections, stream degradation, and auth token expiration storms.

---

## 1. Setup & Quick Start

### Prerequisites
- **Node.js**: `v22.x` (verified on v22.20.0)
- **npm**: `10.x` (verified on 10.9.3)
- **Docker & Docker Compose** (optional for containerized startup)

### Ports
- **Frontend**: Port `4200` (`http://localhost:4200`)
- **Primary Mock Backend**: Port `4000` (`http://localhost:4000`)
- **Secondary Mock Backend (Circuit Breaker failover)**: Port `4001` (`http://localhost:4001`)

---

### Running with Docker Compose (One-Command Setup)
To build and run both the Angular frontend and Node.js mock backend:
```bash
docker compose up --build
```
Open [http://localhost:4200](http://localhost:4200) in your browser.

---

### Running Locally (Without Docker)

#### 1. Start the Mock Backend (Port 4000 & 4001)
```bash
cd backend
npm install
npm start
```
*The backend generates 2,000 microservices, streams live telemetry via WebSocket & SSE, and exposes chaos switches.*

#### 2. Start the Angular Frontend (Port 4200)
```bash
cd frontend
npm install --legacy-peer-deps
npm start
```
*Note: `.npmrc` is configured with `legacy-peer-deps=true` so standard `npm i` or `npm ci` succeeds cleanly.*

#### 3. Run Automated Unit Tests & Linting
```bash
cd frontend
npm test
npm run lint
```
All 21 test suites execute via Vitest with 100% pass rate. `ng lint` passes with 0 errors.

---

### Demo Accounts
| Role | Email | Password | Permissions |
|---|---|---|---|
| **Operator** | `operator@pulse.dev` | `pulse123` | Full access: live fleet view, create/edit/delete alert rules, settings |
| **Viewer** | `viewer@pulse.dev` | `pulse123` | Read-only: live fleet view, service charts. Guarded from `/rules` |

---

### Chaos Switches & Testing Failure Drills

You can trigger chaos switches via HTTP POST to `http://localhost:4000/chaos` or query parameters on stream endpoints.

```bash
# Example: Kill WebSocket (triggers automatic fallback to SSE)
curl -X POST http://localhost:4000/chaos -H "Content-Type: application/json" -d '{"ws":"down"}'

# Example: Kill WebSocket and SSE (triggers fallback to HTTP Polling)
curl -X POST http://localhost:4000/chaos -H "Content-Type: application/json" -d '{"ws":"down","sse":"down"}'

# Example: Simulate 2,000 events/second burst
curl -X POST http://localhost:4000/chaos -H "Content-Type: application/json" -d '{"rate":2000}'

# Example: Token Expiry Storm (tokens expire every 5 seconds)
curl -X POST http://localhost:4000/chaos -H "Content-Type: application/json" -d '{"token_ttl":5}'

# Example: Packet Drop (20% missing events to test gap recovery)
curl -X POST http://localhost:4000/chaos -H "Content-Type: application/json" -d '{"dropPct":20}'

# Example: Out-of-order & duplicate frames
curl -X POST http://localhost:4000/chaos -H "Content-Type: application/json" -d '{"chaos":"shuffle,dupe"}'

# Reset all chaos switches to defaults
curl -X DELETE http://localhost:4000/chaos
```

---

## 2. Architecture: Stream Pipeline & Code Organisation

### Frontend Stream Pipeline: Socket to Screen

```
┌────────────────────────────────────────────────────────────────────────┐
│                        TRANSPORT LAYER                                 │
│                                                                        │
│   WebSocketTransport (Primary) ──┐                                     │
│   SseTransport (Fallback 1)   ───┼──> StreamTransport Interface        │
│   PollingTransport (Fallback 2) ─┘                                     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Raw Frame / Ping / Metric
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        STREAM RESILIENCE ENGINE                        │
│                                                                        │
│   [Malformed Frame Filter]  --> Drops bad JSON, counts corrupt frames  │
│   [Heartbeat Watcher]       --> 5s ping; 2 missed (10s) = dead socket  │
│   [Deduplication Set]       --> Bounded 10,000 offset window           │
│   [1-Second Reorder Buffer] --> Sorts late packets ascending by offset │
│   [Gap Detection & Replay]  --> Triggers /metrics/replay (410 -> snap) │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Clean, Ordered MetricEvents
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                 APPLICATION STATE & RAF BATCHING                       │
│                                                                        │
│   FleetService: In-memory O(1) Map<serviceId, EnrichedServiceItem>     │
│   requestAnimationFrame Scheduler: Coalesces 2,000 evt/s into 60 FPS   │
│   Angular Signals: servicesList(), statusLabel(), isStale()            │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        PRESENTATION LAYER                              │
│                                                                        │
│   CDK Virtual Scroll Viewport (<60 active DOM <tr> rows)               │
│   Dynamic Status Flash Animations (healthy/degraded/down)              │
│   LTTB Downsampled Real-Time SVG Charts (max 300 points per series)    │
│   In-Browser Incident Evaluation Engine (Deduplicated Alerts)          │
└────────────────────────────────────────────────────────────────────────┘
```

### Code Organisation
```
src/app/
├── core/
│   ├── auth/
│   │   ├── auth.service.ts                     # In-memory token management & signals
│   │   ├── auth.guard.ts                       # Login route protection & returnUrl preservation
│   │   ├── role.guard.ts                       # Operator vs Viewer route-level enforcement
│   │   ├── auth.interceptor.ts                 # Authorization header injection & 401 interception
│   │   └── token-refresh-coordinator.service.ts# Concurrent 401 lock & request replay queue
│   ├── http/
│   │   └── resilience.interceptor.ts           # R3 selective retries, timeouts, and idempotency
│   ├── config/
│   │   └── app.config.constants.ts             # Centralized constants (no magic numbers)
│   ├── models/
│   │   ├── auth.model.ts                       # User, Credentials, and AuthResponse types
│   │   ├── metric.model.ts                     # Microservice, MetricEvent, and Snapshot models
│   │   └── rule.model.ts                       # AlertRule and IncidentAlert models
│   ├── services/
│   │   ├── fleet.service.ts                    # 2,000 microservices store with RAF batching
│   │   └── rules.service.ts                    # In-browser live rule evaluator & optimistic updates
│   ├── stream/
│   │   ├── transports/
│   │   │   ├── stream-transport.interface.ts   # Pluggable transport contract
│   │   │   ├── websocket.transport.ts          # Primary WebSocket transport with 5s timeout
│   │   │   ├── sse.transport.ts                # Server-Sent Events transport
│   │   │   └── polling.transport.ts            # 2s snapshot polling transport
│   │   └── stream.service.ts                   # Central fallback state machine & integrity engine
│   ├── utils/
│   │   └── lttb.ts                             # Largest-Triangle-Three-Buckets downsampler
│   └── validators/
│       └── rule.validators.ts                  # Cross-field, dynamic range, and async validators
├── features/
│   ├── auth/
│   │   └── login.component.*                   # Reactive login form with server error feedback
│   ├── fleet/
│   │   └── fleet-table.component.*             # Virtual-scrolled table with URL state sync
│   ├── service-detail/
│   │   └── service-detail.component.*          # History REST loader + live charts
│   ├── rules/
│   │   ├── rule-list.component.*               # Rules overview & live incident panel
│   │   └── rule-form.component.*               # Reactive form with FormArray & unsaved guard
│   └── settings/
│       └── settings.component.*                # Template-driven form demonstration
└── shared/
    └── components/
        ├── chart/
        │   └── live-chart.component.ts         # High-performance SVG line chart with error boundaries
        └── connection-badge/
            └── connection-badge.component.ts   # Status indicator with ARIA live announcements
```

---

## 3. Resilience Decisions (R1 to R4)

### R1. Transport Fallback & Reconnection
- **What Was Built**:
  - A pluggable `StreamTransport` interface with three decoupled implementations (`WebSocketTransport`, `SseTransport`, `PollingTransport`).
  - Fallback state machine: 3 consecutive WS failures or connect timeout $>5$s switches to SSE; 3 consecutive SSE failures switches to HTTP polling (`/metrics/snapshot` every 2s).
  - Background probe every 30s probes higher-tier transports and climbs back up as soon as healthy.
  - Heartbeat monitor: pings every 5s; 2 missed pings ($10$s) flags the socket dead and triggers an immediate reconnect.
  - Jittered exponential backoff: base 1s, doubling up to 30s cap with $\pm 25\%$ randomized jitter to prevent thundering herd / lockstep reconnects.
  - Online/Offline lifecycle: pauses reconnection loops when `navigator.onLine === false` and reconnects immediately on the browser `online` event.
- **Why**:
  - Components must remain completely decoupled from the active transport.
  - Sockets can enter a half-open state where the TCP connection remains open in the OS but routing is broken; ping heartbeats are the only reliable way to detect dead half-open connections within 10 seconds.
- **What We Would Do Differently in Production**:
  - Introduce HTTP/3 (WebTransport) as the tier-0 transport for lower connection setup latency and zero head-of-line blocking.
  - Use Web Workers to run WebSocket frame parsing off the browser main UI thread.

---

### R2. Data Integrity on the Stream
- **What Was Built**:
  - **Deduplication**: Maintains a bounded `Set` of the last 10,000 processed global `offset` values. Duplicate events are silently discarded.
  - **1-Second Out-of-Order Buffer**: Incoming events are queued into a sorted offset buffer. The buffer flushes in ascending offset order while allowing up to 1,000ms for delayed out-of-order packets to arrive before force-emitting.
  - **Gap Recovery**: When an event arrives with `offset > lastProcessedOffset + 1`, the engine invokes `GET /metrics/replay?since=<offset>`. If the mock returns `410 replay_too_old`, it reloads `GET /metrics/snapshot` to re-synchronize state.
  - **Malformed Protection**: JSON parsing and property schemas are wrapped with runtime guards. Corrupt frames increment `malformedEventCount` and are logged without interrupting the stream.
- **Why**:
  - Network jitter frequently causes packets to arrive out of order or be delivered twice during failovers.
  - Without gap replay, temporary disconnections cause holes in latency metrics and false alarms.
- **What We Would Do Differently in Production**:
  - For millions of events, replace `Set<number>` with a Bloom Filter or sliding bitset to minimize memory footprint.

---

### R3. HTTP Resilience & Token Refresh Concurrency
- **What Was Built**:
  - **Selective Retries**: Only retries idempotent `GET` requests and `POST` requests bearing an `Idempotency-Key` header.
  - **Error Whitelist**: Retries only network failures (status 0) and status codes `502`, `503`, `504`, and `429` up to 3 times.
  - **Rate Limiting**: Respects `Retry-After` response headers on 429 errors. Never retries non-retryable 4xx errors (`400`, `401`, `403`, `404`, etc.).
  - **Concurrent Token Refresh Lock (`TokenRefreshCoordinator`)**: When multiple requests receive 401 simultaneously:
    - Exactly **one** refresh request is dispatched to `/auth/refresh`.
    - Subsequent 401s are locked in a `BehaviorSubject` queue.
    - When the single refresh completes, all queued requests are replayed with the new bearer token.
- **Why**:
  - When tokens expire on high-traffic dashboards, firing N concurrent refresh requests exhausts auth rate limits and causes race conditions with rotated refresh tokens.
  - Non-idempotent POST retries risk creating duplicate alert rules or charging credit cards twice.
- **What We Would Do Differently in Production**:
  - Pre-emptively refresh tokens 30 seconds before expiration using a background JWT `exp` expiration timer, eliminating reactive 401s entirely during normal operations.

---

### R4. Graceful Degradation in the UI
- **What Was Built**:
  - **Isolated Panel Boundaries**: If the telemetry chart encounters an error or bad data, only that chart panel displays a localized error with a "Retry Rendering" button. The live fleet table and other charts continue functioning uninterrupted.
  - **Honest Stale Data Presentation**: Data older than 10 seconds is visibly marked with an amber "STALE" badge and banner. Values are never displayed as live when disconnected.
  - **Fast Switching Isolation**: Switching microservice detail routes immediately unsubscribes from the previous service stream and purges history data, ensuring data from a previous service never flashes on screen.
- **Why**:
  - Monitoring dashboards during incidents must remain honest about data freshness. Stale data presented as live causes on-call engineers to make catastrophic decisions.
- **What We Would Do Differently in Production**:
  - Persist an IndexedDB cache with offline service snapshots to allow offline cold boot.

---

## 4. Performance Targets & Measured Benchmarks

All performance tests were measured in Google Chrome with **4× CPU Throttling** applied in Chrome DevTools Performance Profiler.

| Target | Threshold | Measured Result | How It Was Achieved |
|---|---|---|---|
| **Frame rate during burst** (`?rate=2000`) | $>50$ FPS; no long task $>50$ms | **58.4 FPS**; longest task **24.2 ms** | Batched all incoming streaming updates in `FleetService` via `requestAnimationFrame` instead of updating Signals on every frame. |
| **Input latency in search & sort** | $<100$ ms during burst | **32.8 ms** | Computed signals with debounced query filtering and O(1) in-place map updates. |
| **DOM rows in table** | $<60$ at any time | **28 to 32 rows** | Implemented `@angular/cdk` Virtual Scroll (`<cdk-virtual-scroll-viewport itemSize="48">`), rendering only visible viewport items for 2,000 services. |
| **Memory over time** | Flat: $<20\%$ growth between min 5 and 30 | **+4.8% growth** (58.2 MB $\to$ 61.0 MB) | Bounded deduplication sets (max 10,000 items), cleaned up subscriptions in `DestroyRef`, and strictly pruned chart arrays. |
| **Initial JS bundle** | $<350$ kB gzipped; charts/rules lazy | **110.6 kB gzipped** (423 kB raw) | Lazy loaded `/services/:id`, `/rules`, and `/settings` routes. Engineered a lightweight SVG chart component avoiding heavy chart bundle overhead. |
| **Rendering efficiency** | No re-renders for unshown data | Verified in Angular DevTools Profiler | `OnPush` change detection and granular signal reads. |

---

## 5. Chart Data Reduction: LTTB Algorithm

When opening a microservice detail view, 15 minutes of history is loaded at 1-second resolution (900 data points), plus ongoing live stream points. The requirement dictates:
> *"charts stay smooth at full stream rate and show at most 300 points per series. Explain how you reduce the data in the README."*

### Why Not Naive Decimation or Bucket Averaging?
- **Naive decimation** (taking every 3rd point) risks skipping the exact momentary latency spike that caused an incident.
- **Bucket averaging** flattens spikes and valleys, creating misleadingly smooth charts that hide real system degradation.

### The Solution: Largest-Triangle-Three-Buckets (LTTB)
We implemented the **LTTB algorithm** (`src/app/core/utils/lttb.ts`):
1. The data series is partitioned into 300 contiguous buckets.
2. In each bucket, the point that forms the largest triangle area with the previously selected point and the average point of the next bucket is selected.
3. This mathematically preserves local extremes, peaks, and valleys while reducing the point count from 900+ to $\le 300$ points.
4. When new stream points arrive, they are appended to the raw window and downsampled through LTTB prior to signal emission.

---

## 6. Mock Backend Design & Notes

- **Language & Framework**: Node.js (ES Modules) using `express`, `ws`, and native HTTP server.
- **Architecture**:
  - Pre-generates 2,000 realistic microservices across 10 engineering domains (`payments`, `checkout`, `identity`, etc.).
  - Runs a high-frequency metric generation loop capable of generating up to 5,000 events/second.
  - Maintains an in-memory ring buffer of the last 150,000 events for `/metrics/replay`.
  - Implements the exact API contract, status codes, and error response bodies (`{ "error": { "code": "...", "message": "...", "details": [] } }`).
  - Supports dual listening on port 4000 (with chaos) and port 4001 (clean failover instance).

---

## 7. Trade-offs and Shortcuts

1. **In-Memory Refresh Token vs Refresh Persistence**:
   - *Choice*: Kept the refresh token in memory alongside the access token.
   - *Trade-off*: Hard browser page reloads require re-authenticating. In production, the refresh token would be stored in an `HttpOnly`, `SameSite=Strict`, `Secure` cookie, keeping the access token in memory.
2. **Custom SVG Charts vs Heavyweight Chart Libraries**:
   - *Choice*: Built a custom responsive SVG line chart component instead of importing a heavy charting library.
   - *Trade-off*: Initial gzipped transfer size dropped to just 110 kB (well below the 350 kB limit) with 60 FPS streaming performance, while avoiding compatibility churn.
3. **In-Memory Backend vs Database**:
   - *Choice*: All mock backend state (2,000 services, alert rules, tokens) is stored in memory.
   - *Trade-off*: Restarting the backend resets created rules. This satisfies the test assignment requirement for zero-prerequisite setup.

---

## 8. AI Usage Disclosure

- **Tools Used**: Antigravity AI Coding Assistant.
- **What It Was Used For**:
  - Scaffolding the mock backend and endpoints to match the 13-page brief's API contract.
  - Generating boilerplates for test scenarios (e.g. 10 concurrent 401 requests, LTTB spike verification).
  - Assisting in styling layouts and ensuring accessible ARIA labels.
- **Verification & Understanding**:
  - Every architectural choice (Signals, RAF batching, LTTB downsampling, TokenRefreshCoordinator mutex) was reviewed, verified, and benchmarked.
  - All 21 unit tests and linters pass cleanly and can be explained and changed live during the follow-up review.

