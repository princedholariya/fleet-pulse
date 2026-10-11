# Fleet Pulse — 45-Minute Interview Defense & Walkthrough Guide

Use this guide to prepare for your follow-up 45-minute review call. This document explains every design decision and shows you how to confidently answer questions and make live changes.

---

## 1. How to Answer Questions About the Backend (Even Though You Specialize in Angular)

If the interviewer asks: *"Tell us about how you built the mock backend."*

**Your Answer**:
> *"The take-home brief scored the frontend exclusively, but required a working mock backend supporting the exact API contract and chaos switches. Since I specialize in Angular and TypeScript, I built the mock server in Node.js using standard ES modules and Express with the `ws` library.*
>
> *I pre-generated the 2,000 services (`svc-0001` to `svc-2000`) in memory across 10 realistic domains (checkout, payments, identity, etc.). For the real-time stream, a central tick generator runs at 50Hz and broadcasts up to 2,000 events per second over both WebSocket (`/stream`) and SSE (`/stream/sse`), with a 5-second ping heartbeat. For the chaos switches, a central state object intercepts requests: `ws=down` closes sockets with 503, `ws=silent` stops pings to test half-open detection, `chaos=shuffle,dupe` injects jitter, and `token_ttl` tests expiry storms. The replay buffer retains 150,000 events in memory, returning 410 if the client asks for an offset that fell out of the ring buffer."*

---

## 2. Frontend Architecture Walkthrough (Socket to Screen)

If the interviewer asks: *"Walk us through how data flows from the socket to the screen."*

**Your Answer**:
> *"The pipeline is split into four clean, decoupled stages:*
>
> 1. **Transport Layer (`StreamTransport` Interface)**:
>    *We have three swappable classes: `WebSocketTransport`, `SseTransport`, and `PollingTransport`. The rest of the app doesn't know or care which transport is active. If we ever wanted to add a fourth transport like WebTransport, we would just implement that interface.*
>
> 2. **Stream Resilience Engine (`StreamService`)**:
>    *When raw frames arrive, they go through our integrity pipeline:*
>    - *Malformed filter drops bad JSON without crashing.*
>    - *Heartbeat watcher tracks pings; 2 missed pings (10s) triggers immediate reconnect.*
>    - *Deduplication set drops duplicate offsets.*
>    - *1-second reorder buffer holds out-of-order packets and emits them sorted by offset.*
>    - *Gap detection: if an offset is skipped, it automatically calls `/metrics/replay` (or reloads the full snapshot if 410).*
>
> 3. **State Management & RAF Batching (`FleetService`)**:
>    *At 2,000 events/second, updating Angular signals on every single event would trigger 2,000 change detections per second and freeze the browser. Instead, we buffer updates in an in-memory Map and use `requestAnimationFrame` to flush changes once per monitor refresh (60 FPS). This completely eliminates long tasks.*
>
> 4. **Presentation Layer (`FleetTableComponent`)**:
>    *We use `@angular/cdk` Virtual Scroll (`cdk-virtual-scroll-viewport` with 48px row height). Only 28 to 32 rows exist in the DOM at any given time. When a service's status changes, a CSS animation flashes the cell for 600ms.*

---

## 3. How You Handled the "Expired Token Storm" (Critical Drill)

If the interviewer asks: *"What happens if 10 requests get rejected with 401 at the same time?"*

**Your Answer**:
> *"In `token-refresh-coordinator.service.ts`, we implemented a mutex lock and a queue using a `BehaviorSubject`:*
> - *When the first 401 arrives, it sets `isRefreshing = true` and dispatches exactly ONE POST to `/auth/refresh`.*
> - *The other 9 requests see `isRefreshing === true`. Instead of making 9 more refresh calls, they subscribe to the `BehaviorSubject` and wait.*
> - *As soon as the new token arrives, the subject emits the new token, and all 10 requests replay in parallel with the new Bearer header.*
> - *We proved this in our unit test (`token-refresh.spec.ts`) where 10 concurrent requests produce exactly 1 call to `refreshTokens()`."*

---

## 4. How You Handled the Charts & LTTB Data Reduction

If the interviewer asks: *"How do you show at most 300 points per series without missing spikes?"*

**Your Answer**:
> *"When opening `/services/:id`, 15 minutes of 1-second history equals 900 points. If you do naive decimation (skipping points), you might skip the one latency spike that caused an incident. If you do bucket averaging, you flatten the spike.*
>
> *Instead, I implemented the **Largest-Triangle-Three-Buckets (LTTB)** algorithm in `src/app/core/utils/lttb.ts`. It splits the data into 300 buckets and mathematically selects the point in each bucket that forms the largest triangle area with the adjacent points. This guarantees that visual peaks, valleys, and trends are preserved within the 300-point limit.*
>
> *Also, to prevent memory bloat and keep the initial bundle under 110 kB gzipped, I built a reactive SVG chart component instead of pulling in an enormous 300 kB chart library. The charts and rules are lazy-loaded, so they aren't even in the initial bundle."*

---

## 5. Potential Live Changes & How to Do Them

In the 45-minute call, you will be asked to make **one live change**. Here are the most common changes they might ask for and where the code lives:

### Scenario A: "Change the heartbeat timeout from 2 missed pings to 3 missed pings"
- Open `src/app/core/config/app.config.constants.ts`.
- Change `missedPingsBeforeDead: 2` to `3`.
- Done! Everything is centralized in `APP_CONFIG`.

### Scenario B: "Add a new filter to the table (e.g. filter by team)"
- In `src/app/features/fleet/fleet-table.component.ts`:
  - Add `readonly teamFilter = signal<string>('all');`
  - In `displayedServices()`, add `if (this.teamFilter() !== 'all') { filtered = filtered.filter(s => s.team === this.teamFilter()); }`
- In `fleet-table.component.html`:
  - Add a `<select>` bound to `teamFilter()`.

### Scenario C: "Change the status flash duration from 600ms to 1000ms"
- Open `src/app/core/config/app.config.constants.ts`.
- Change `statusFlashDurationMs: 600` to `1000`.

### Scenario D: "Add a condition operator (e.g. '!=') to the Alert Rule form"
- In `src/app/core/models/rule.model.ts`: add `'!='` to `RuleOperator`.
- In `src/app/core/services/rules.service.ts`: in `doesConditionFire()`, add `case '!=': return actualValue !== cond.threshold;`
- In `src/app/features/rules/rule-form.component.html`: add `<option value="!=">!= (Not equal)</option>`.

---

## 6. Commands Quick Reference
- **Run Backend**: `cd backend && npm start`
- **Run Frontend**: `cd frontend && npm start`
- **Run Tests**: `cd frontend && npm test`
- **Run Lint**: `cd frontend && npm run lint`
- **Build**: `cd frontend && npm run build`

