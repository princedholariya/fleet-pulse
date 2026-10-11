import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';

const PORT = 4000;
const SECONDARY_PORT = 4001;

// Global Chaos Switches State
const defaultChaos = {
  rate: 500,               // metric events per sec
  ws: 'up',                // 'up' | 'down' | 'silent'
  sse: 'up',               // 'up' | 'down'
  dropPct: 0,              // ws=drop:<pct>
  shuffle: false,          // chaos=shuffle
  dupe: false,             // chaos=dupe
  garbagePct: 0,           // chaos=garbage:<pct>
  tokenTtl: 60,            // token_ttl=<s> (in seconds)
  http500Pct: 0,           // http=500:<pct>
  httpSlowMs: 0,           // http=slow:<ms>
  http429: false,          // http=429
  killSec: 0               // kill=<s>
};

let globalChaos = { ...defaultChaos };

// 2,000 Microservices Generation
const TEAMS = ['payments', 'checkout', 'identity', 'catalog', 'search', 'inventory', 'shipping', 'recommendations', 'analytics', 'notifications'];
const STATUSES = ['healthy', 'degraded', 'down'];

const services = [];
const serviceSeq = new Map(); // serviceId -> current sequence number
const serviceLatestMetric = new Map(); // serviceId -> latest metric event

for (let i = 1; i <= 2000; i++) {
  const id = `svc-${String(i).padStart(4, '0')}`;
  const team = TEAMS[(i - 1) % TEAMS.length];
  const name = `${team}-service-${String(i).padStart(4, '0')}`;
  const initialStatus = i % 25 === 0 ? 'down' : (i % 7 === 0 ? 'degraded' : 'healthy');
  
  services.push({
    id,
    name,
    team,
    status: initialStatus
  });

  serviceSeq.set(id, 1000 + i);

  const initialMetric = {
    type: 'metric',
    offset: 1000000 + i,
    serviceId: id,
    seq: 1000 + i,
    ts: Date.now(),
    p95: Math.floor(40 + Math.random() * 200),
    errRate: initialStatus === 'healthy' ? Number((Math.random() * 0.5).toFixed(2)) : (initialStatus === 'degraded' ? Number((1.5 + Math.random() * 2).toFixed(2)) : Number((10 + Math.random() * 15).toFixed(2))),
    rps: Math.floor(500 + Math.random() * 1500),
    status: initialStatus
  };
  serviceLatestMetric.set(id, initialMetric);
}

// Global Replay Ring Buffer (keeps last 5-10 minutes of events)
// 500 events/sec * 300s = 150,000 max events; we cap at 150,000
const MAX_RING_BUFFER_SIZE = 150000;
let globalOffset = 9182700;
const ringBuffer = []; // array of MetricEvents sorted by offset

function recordMetricEvent(event) {
  ringBuffer.push(event);
  if (ringBuffer.length > MAX_RING_BUFFER_SIZE) {
    ringBuffer.shift();
  }
}

// In-Memory Auth Stores
// Map of accessToken -> { user, expiresAt }
const accessTokens = new Map();
// Map of refreshToken -> { user, expiresAt, used }
const refreshTokens = new Map();

function generateToken(prefix) {
  return `${prefix}_${Math.random().toString(36).substring(2)}_${Date.now()}`;
}

const TEST_USERS = [
  { id: 'u-1', email: 'operator@pulse.dev', password: 'pulse123', role: 'operator' },
  { id: 'u-2', email: 'viewer@pulse.dev', password: 'pulse123', role: 'viewer' }
];

function issueTokens(user, ttlSeconds = globalChaos.tokenTtl) {
  const accessToken = generateToken('acc');
  const refreshToken = generateToken('ref');
  const now = Date.now();

  accessTokens.set(accessToken, {
    user,
    expiresAt: now + (ttlSeconds * 1000)
  });

  refreshTokens.set(refreshToken, {
    user,
    expiresAt: now + (7 * 24 * 3600 * 1000), // 7 days
    used: false
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: ttlSeconds,
    user: {
      id: user.id,
      email: user.email,
      role: user.role
    }
  };
}

// Alert Rules In-Memory Store
let rules = [
  {
    id: 'r-1',
    name: 'Critical Checkout Latency',
    conditions: [
      { metric: 'p95', operator: '>', threshold: 500, durationSec: 30 }
    ],
    createdAt: Date.now() - 3600000,
    updatedAt: Date.now() - 3600000
  },
  {
    id: 'r-2',
    name: 'High Error Rate Alert',
    conditions: [
      { metric: 'errRate', operator: '>=', threshold: 5.0, durationSec: 15 }
    ],
    createdAt: Date.now() - 1800000,
    updatedAt: Date.now() - 1800000
  }
];

// Idempotency cache for POST /rules: Map<IdempotencyKey, { rule, statusCode }>
const idempotencyMap = new Map();

// Helper: Parse Chaos query string into chaos overrides
export function parseChaosParams(query) {
  const chaos = { ...globalChaos };

  if (query.rate) {
    const r = parseInt(query.rate, 10);
    if (!isNaN(r) && r >= 1 && r <= 5000) chaos.rate = r;
  }
  if (query.ws) {
    if (query.ws === 'down' || query.ws === 'silent' || query.ws === 'up') chaos.ws = query.ws;
    if (query.ws.startsWith('drop:')) {
      const pct = parseInt(query.ws.split(':')[1], 10);
      if (!isNaN(pct)) chaos.dropPct = pct;
    }
  }
  if (query.sse) {
    if (query.sse === 'down' || query.sse === 'up') chaos.sse = query.sse;
  }
  if (query.chaos) {
    const parts = query.chaos.split(',');
    for (const part of parts) {
      if (part === 'shuffle') chaos.shuffle = true;
      if (part === 'dupe') chaos.dupe = true;
      if (part.startsWith('garbage:')) {
        const pct = parseInt(part.split(':')[1], 10);
        if (!isNaN(pct)) chaos.garbagePct = pct;
      }
    }
  }
  if (query.token_ttl) {
    const ttl = parseInt(query.token_ttl, 10);
    if (!isNaN(ttl) && ttl > 0) chaos.tokenTtl = ttl;
  }
  if (query['http=500'] || query.http?.startsWith('500:')) {
    const val = query['http=500'] || query.http.split(':')[1];
    const pct = parseInt(val, 10);
    if (!isNaN(pct)) chaos.http500Pct = pct;
  }
  if (query.http === '429') {
    chaos.http429 = true;
  }
  if (query.http?.startsWith('slow:')) {
    const ms = parseInt(query.http.split(':')[1], 10);
    if (!isNaN(ms)) chaos.httpSlowMs = ms;
  }
  if (query.kill) {
    const k = parseInt(query.kill, 10);
    if (!isNaN(k)) chaos.killSec = k;
  }

  return chaos;
}

// Standard Error Helper
function sendError(res, status, code, message, details = []) {
  return res.status(status).json({
    error: {
      code,
      message,
      details
    }
  });
}

// Authentication Middleware
function authenticate(req, res, next) {
  // Exclude routes: /auth/*, /chaos, /health
  if (req.path.startsWith('/auth') || req.path === '/chaos' || req.path === '/health') {
    return next();
  }

  const authHeader = req.headers.authorization;
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.query && req.query.access_token) {
    token = req.query.access_token;
  }

  if (!token) {
    return sendError(res, 401, 'invalid_credentials', 'Missing authentication token');
  }

  const tokenRecord = accessTokens.get(token);
  if (!tokenRecord) {
    return sendError(res, 401, 'token_invalid', 'Invalid authentication token');
  }

  if (Date.now() > tokenRecord.expiresAt) {
    return sendError(res, 401, 'token_expired', 'Access token expired');
  }

  req.user = tokenRecord.user;
  next();
}

// Chaos Interceptor for REST endpoints
function chaosInterceptor(req, res, next) {
  // Exclude /auth/*, /chaos, /health from HTTP chaos
  if (req.path.startsWith('/auth') || req.path === '/chaos' || req.path === '/health') {
    return next();
  }

  // Check 429 switch
  if (globalChaos.http429) {
    res.setHeader('Retry-After', '2');
    return sendError(res, 429, 'rate_limited', 'Too many requests, try again later');
  }

  // Check 500 error probability
  if (globalChaos.http500Pct > 0) {
    const roll = Math.random() * 100;
    if (roll < globalChaos.http500Pct) {
      return sendError(res, 500, 'server_error', 'Injected chaotic internal server error');
    }
  }

  // Check latency delay
  if (globalChaos.httpSlowMs > 0) {
    setTimeout(next, globalChaos.httpSlowMs);
  } else {
    next();
  }
}

// Build Express Application
export function createApp(isSecondary = false) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Attach chaos and auth middlewares
  if (!isSecondary) {
    app.use(chaosInterceptor);
  }
  app.use(authenticate);

  // Health
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Chaos Endpoints
  app.get('/chaos', (req, res) => {
    res.json(globalChaos);
  });

  app.post('/chaos', (req, res) => {
    const body = req.body || {};
    // Parse switches from body
    if (body.rate !== undefined) globalChaos.rate = Math.max(1, Math.min(5000, Number(body.rate)));
    if (body.ws !== undefined) globalChaos.ws = body.ws;
    if (body.sse !== undefined) globalChaos.sse = body.sse;
    if (body['ws=drop'] !== undefined) globalChaos.dropPct = Number(body['ws=drop']);
    if (body.dropPct !== undefined) globalChaos.dropPct = Number(body.dropPct);
    if (body.shuffle !== undefined) globalChaos.shuffle = Boolean(body.shuffle);
    if (body.dupe !== undefined) globalChaos.dupe = Boolean(body.dupe);
    if (body.garbagePct !== undefined) globalChaos.garbagePct = Number(body.garbagePct);
    if (body.token_ttl !== undefined) globalChaos.tokenTtl = Number(body.token_ttl);
    if (body['http=500'] !== undefined) globalChaos.http500Pct = Number(body['http=500']);
    if (body['http=slow'] !== undefined) globalChaos.httpSlowMs = Number(body['http=slow']);
    if (body['http=429'] !== undefined) globalChaos.http429 = Boolean(body['http=429']);
    if (body.kill !== undefined) globalChaos.killSec = Number(body.kill);

    // Support combined chaos string format e.g. { chaos: "shuffle,dupe" }
    if (typeof body.chaos === 'string') {
      const parts = body.chaos.split(',');
      globalChaos.shuffle = parts.includes('shuffle');
      globalChaos.dupe = parts.includes('dupe');
      for (const p of parts) {
        if (p.startsWith('garbage:')) {
          globalChaos.garbagePct = Number(p.split(':')[1]) || 0;
        }
      }
    }

    res.json(globalChaos);
  });

  app.delete('/chaos', (req, res) => {
    globalChaos = { ...defaultChaos };
    res.json(globalChaos);
  });

  // Auth: POST /auth/login
  app.post('/auth/login', (req, res) => {
    const { email, password } = req.body || {};
    const user = TEST_USERS.find(u => u.email === email && u.password === password);

    if (!user) {
      return sendError(res, 401, 'invalid_credentials', 'Invalid email or password');
    }

    const tokens = issueTokens(user);
    res.json(tokens);
  });

  // Auth: POST /auth/refresh
  app.post('/auth/refresh', (req, res) => {
    const { refreshToken } = req.body || {};
    if (!refreshToken) {
      return sendError(res, 401, 'refresh_invalid', 'Refresh token required');
    }

    const record = refreshTokens.get(refreshToken);
    if (!record || record.used || Date.now() > record.expiresAt) {
      return sendError(res, 401, 'refresh_invalid', 'Refresh token invalid, reused, or expired');
    }

    // Mark current refresh token as used (rotation)
    record.used = true;

    // Issue new pair
    const tokens = issueTokens(record.user);
    res.json(tokens);
  });

  // Services: GET /services
  app.get('/services', (req, res) => {
    res.json(services);
  });

  // Metrics: GET /metrics/snapshot
  app.get('/metrics/snapshot', (req, res) => {
    const snapshotMetrics = services.map(s => serviceLatestMetric.get(s.id));
    res.json({
      offset: globalOffset,
      ts: Date.now(),
      metrics: snapshotMetrics
    });
  });

  // Metrics: GET /metrics/history?serviceId=&minutes=
  app.get('/metrics/history', (req, res) => {
    const serviceId = req.query.serviceId;
    const minutes = Math.max(1, Math.min(60, parseInt(req.query.minutes || '15', 10)));

    if (!serviceId || !serviceSeq.has(serviceId)) {
      return sendError(res, 404, 'not_found', `Service ${serviceId} not found`);
    }

    const pointsCount = minutes * 60; // 1 point per second
    const now = Date.now();
    const points = [];
    const baseP95 = 50 + (parseInt(serviceId.replace('svc-', ''), 10) % 200);

    for (let i = pointsCount - 1; i >= 0; i--) {
      const ts = now - (i * 1000);
      const wave = Math.sin(i / 15) * 20;
      points.push({
        ts,
        p95: Math.max(10, Math.floor(baseP95 + wave + (Math.random() * 15))),
        errRate: Number((Math.random() * 1.5).toFixed(2)),
        rps: Math.floor(1000 + Math.cos(i / 20) * 300 + (Math.random() * 50))
      });
    }

    res.json({
      serviceId,
      points
    });
  });

  // Metrics: GET /metrics/replay?since=
  app.get('/metrics/replay', (req, res) => {
    const since = parseInt(req.query.since, 10);
    if (isNaN(since)) {
      return sendError(res, 400, 'bad_request', 'Missing or invalid since parameter');
    }

    if (ringBuffer.length > 0 && since < ringBuffer[0].offset) {
      return sendError(res, 410, 'replay_too_old', 'Replay offset too old to fulfill from buffer');
    }

    const events = ringBuffer.filter(e => e.offset > since);
    res.json({
      events,
      offset: globalOffset
    });
  });

  // Rules: GET /rules
  app.get('/rules', (req, res) => {
    res.json(rules);
  });

  // Rules: GET /rules/:id
  app.get('/rules/:id', (req, res) => {
    const rule = rules.find(r => r.id === req.params.id);
    if (!rule) {
      return sendError(res, 404, 'not_found', 'Rule not found');
    }
    res.json(rule);
  });

  // Rules: GET /rules/check-name?name=&excludeId=
  app.get('/rules/check-name', (req, res) => {
    const name = (req.query.name || '').trim().toLowerCase();
    const excludeId = req.query.excludeId;

    const exists = rules.some(r => r.name.toLowerCase() === name && r.id !== excludeId);
    res.json({ available: !exists });
  });

  // Rules Operator Gate
  function requireOperator(req, res, next) {
    if (req.user?.role !== 'operator') {
      return sendError(res, 403, 'forbidden', 'Operator role required for this action');
    }
    next();
  }

  // Rules: POST /rules
  app.post('/rules', requireOperator, (req, res) => {
    const idempotencyKey = req.headers['idempotency-key'];
    if (idempotencyKey && idempotencyMap.has(idempotencyKey)) {
      const cached = idempotencyMap.get(idempotencyKey);
      return res.status(cached.statusCode).json(cached.body);
    }

    const { name, conditions, ...rest } = req.body || {};

    // Validate body
    const details = [];
    if (!name || typeof name !== 'string' || !name.trim()) {
      details.push({ field: 'name', message: 'Rule name is required' });
    }
    if (!Array.isArray(conditions) || conditions.length === 0) {
      details.push({ field: 'conditions', message: 'At least one condition is required' });
    } else {
      conditions.forEach((c, idx) => {
        if (!['p95', 'errRate', 'rps'].includes(c.metric)) {
          details.push({ field: `conditions[${idx}].metric`, message: 'Invalid metric' });
        }
        if (!['>', '>=', '<', '<='].includes(c.operator)) {
          details.push({ field: `conditions[${idx}].operator`, message: 'Invalid operator' });
        }
        if (typeof c.threshold !== 'number') {
          details.push({ field: `conditions[${idx}].threshold`, message: 'Threshold must be a number' });
        }
      });
    }

    if (details.length > 0) {
      return sendError(res, 422, 'validation', 'Validation failed', details);
    }

    // Check duplicate name
    if (rules.some(r => r.name.toLowerCase() === name.trim().toLowerCase())) {
      return sendError(res, 409, 'name_taken', 'A rule with this name already exists');
    }

    const newRule = {
      id: `r-${Date.now().toString().slice(-4)}`,
      name: name.trim(),
      conditions,
      ...rest,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    rules.push(newRule);

    if (idempotencyKey) {
      idempotencyMap.set(idempotencyKey, { statusCode: 201, body: newRule });
    }

    res.status(201).json(newRule);
  });

  // Rules: PUT /rules/:id
  app.put('/rules/:id', requireOperator, (req, res) => {
    const idx = rules.findIndex(r => r.id === req.params.id);
    if (idx === -1) {
      return sendError(res, 404, 'not_found', 'Rule not found');
    }

    const { name, conditions, ...rest } = req.body || {};
    if (name && rules.some(r => r.name.toLowerCase() === name.trim().toLowerCase() && r.id !== req.params.id)) {
      return sendError(res, 409, 'name_taken', 'A rule with this name already exists');
    }

    const updatedRule = {
      ...rules[idx],
      ...(name ? { name: name.trim() } : {}),
      ...(conditions ? { conditions } : {}),
      ...rest,
      updatedAt: Date.now()
    };

    rules[idx] = updatedRule;
    res.json(updatedRule);
  });

  // Rules: DELETE /rules/:id
  app.delete('/rules/:id', requireOperator, (req, res) => {
    const idx = rules.findIndex(r => r.id === req.params.id);
    if (idx === -1) {
      return sendError(res, 404, 'not_found', 'Rule not found');
    }
    rules.splice(idx, 1);
    res.status(204).end();
  });

  // Telemetry: POST /telemetry
  app.post('/telemetry', (req, res) => {
    // Collect error telemetry without failing
    res.status(202).json({ accepted: true });
  });

  // Assistant: GET /assistant/stream?q=
  app.get('/assistant/stream', (req, res) => {
    const question = req.query.q || '';
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reply = `Ops Analysis for "${question}": Fleet health is operating within threshold. 2,000 services are being actively monitored. WebSocket transport is primary with SSE fallback ready.`;
    const tokens = reply.split(' ');
    let idx = 0;

    const interval = setInterval(() => {
      if (idx < tokens.length) {
        res.write(`event: token\ndata: ${JSON.stringify({ text: tokens[idx] + ' ' })}\n\n`);
        idx++;
      } else {
        res.write(`event: done\ndata: {}\n\n`);
        clearInterval(interval);
        res.end();
      }
    }, 60);

    req.on('close', () => {
      clearInterval(interval);
    });
  });

  // SSE Stream: GET /stream/sse
  app.get('/stream/sse', (req, res) => {
    const chaos = parseChaosParams(req.query);

    // Chaos switch: sse=down
    if (chaos.sse === 'down') {
      return res.status(503).json({ error: { code: 'service_unavailable', message: 'SSE transport down (chaos)' } });
    }

    // Token auth check at connection time
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (req.query.access_token) {
      token = req.query.access_token;
    }

    if (!token || !accessTokens.has(token)) {
      return res.status(401).json({ error: { code: 'invalid_credentials', message: 'Unauthorized stream connection' } });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    // Register active SSE client
    const client = {
      id: Math.random().toString(36).substring(2),
      res,
      chaos,
      type: 'sse'
    };
    activeClients.add(client);

    req.on('close', () => {
      activeClients.delete(client);
    });
  });

  return app;
}

// Active stream clients (both WS and SSE)
const activeClients = new Set();

// Generator Loop to simulate 1 to 5000 events/second
let lastTick = Date.now();

function broadcastEvent(client, event) {
  const chaos = client.chaos || globalChaos;

  // Drop packet test
  if (chaos.dropPct > 0 && event.type === 'metric') {
    if (Math.random() * 100 < chaos.dropPct) {
      return; // Dropped on stream, offset still consumed!
    }
  }

  // Garbage frame test
  let payloadStr;
  if (chaos.garbagePct > 0 && Math.random() * 100 < chaos.garbagePct) {
    if (Math.random() > 0.5) {
      payloadStr = '{"type":"metric", "corrupted": true, '; // malformed JSON
    } else {
      payloadStr = JSON.stringify({ type: 'metric', offset: event.offset }); // missing required fields
    }
  } else {
    payloadStr = JSON.stringify(event);
  }

  const sendPayload = (dataToSend) => {
    if (client.type === 'ws') {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(dataToSend);
      }
    } else if (client.type === 'sse') {
      if (!client.res.writableEnded) {
        if (event.type === 'ping') {
          client.res.write(`event: ping\ndata: ${dataToSend}\n\n`);
        } else {
          client.res.write(`event: metric\nid: ${event.offset}\ndata: ${dataToSend}\n\n`);
        }
      }
    }
  };

  // Reorder (shuffle) test: delay up to 1 second
  if (chaos.shuffle && event.type === 'metric' && Math.random() < 0.3) {
    const delay = Math.floor(Math.random() * 900) + 50;
    setTimeout(() => sendPayload(payloadStr), delay);
  } else {
    sendPayload(payloadStr);
  }

  // Duplicate test: deliver twice within 1 second
  if (chaos.dupe && event.type === 'metric' && Math.random() < 0.10) {
    const delay = Math.floor(Math.random() * 800) + 100;
    setTimeout(() => sendPayload(payloadStr), delay);
  }
}

// Main streaming tick loop
function startStreamGenerator() {
  // Pings every 5 seconds
  setInterval(() => {
    const pingEvent = { type: 'ping', ts: Date.now() };
    for (const client of activeClients) {
      const chaos = client.chaos || globalChaos;
      // If ws=silent, do NOT send pings or events
      if (client.type === 'ws' && chaos.ws === 'silent') continue;
      broadcastEvent(client, pingEvent);
    }
  }, 5000);

  // High-frequency metric tick (every 20ms = 50 times per second)
  setInterval(() => {
    const now = Date.now();
    const elapsedSec = (now - lastTick) / 1000;
    lastTick = now;

    const targetRate = globalChaos.rate;
    const countToGenerate = Math.max(1, Math.round(targetRate * elapsedSec));

    for (let i = 0; i < countToGenerate; i++) {
      globalOffset++;

      // Pick a service (semi-random, ensuring all 2000 services receive updates)
      const serviceIdx = Math.floor(Math.random() * services.length);
      const svc = services[serviceIdx];
      const nextSeq = (serviceSeq.get(svc.id) || 0) + 1;
      serviceSeq.set(svc.id, nextSeq);

      // Fluctuate status occasionally
      if (Math.random() < 0.005) {
        svc.status = STATUSES[Math.floor(Math.random() * STATUSES.length)];
      }

      const p95Base = svc.status === 'healthy' ? 60 : (svc.status === 'degraded' ? 350 : 900);
      const errBase = svc.status === 'healthy' ? 0.2 : (svc.status === 'degraded' ? 3.5 : 25.0);

      const metric = {
        type: 'metric',
        offset: globalOffset,
        serviceId: svc.id,
        seq: nextSeq,
        ts: now,
        p95: Math.floor(p95Base + (Math.random() * 40 - 20)),
        errRate: Number(Math.max(0, errBase + (Math.random() * 0.8 - 0.4)).toFixed(2)),
        rps: Math.floor(800 + (Math.random() * 600)),
        status: svc.status
      };

      serviceLatestMetric.set(svc.id, metric);
      recordMetricEvent(metric);

      for (const client of activeClients) {
        const chaos = client.chaos || globalChaos;
        if (client.type === 'ws' && (chaos.ws === 'down' || chaos.ws === 'silent')) continue;
        if (client.type === 'sse' && chaos.sse === 'down') continue;
        broadcastEvent(client, metric);
      }
    }
  }, 20);

  // Periodic kill switch checker
  setInterval(() => {
    if (globalChaos.killSec > 0) {
      for (const client of activeClients) {
        if (client.type === 'ws') client.ws.close();
        if (client.type === 'sse') client.res.end();
      }
      activeClients.clear();
    }
  }, 1000);
}

// Start primary server
const app = createApp(false);
const server = http.createServer(app);

// WebSocket server setup
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === '/stream') {
    const chaos = parseChaosParams(Object.fromEntries(url.searchParams));

    // Chaos switch: ws=down
    if (chaos.ws === 'down') {
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }

    // Token auth check
    let token = url.searchParams.get('access_token');
    const authHeader = request.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }

    if (!token || !accessTokens.has(token)) {
      // Failed auth: close with code 4401
      wss.handleUpgrade(request, socket, head, (ws) => {
        ws.close(4401, 'Unauthorized');
      });
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, chaos);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws, request, chaos) => {
  const client = {
    id: Math.random().toString(36).substring(2),
    ws,
    chaos: chaos || globalChaos,
    type: 'ws'
  };
  activeClients.add(client);

  ws.on('close', () => {
    activeClients.delete(client);
  });
});

server.listen(PORT, () => {
  console.log(`Fleet Pulse Mock Backend listening on port ${PORT}`);
  startStreamGenerator();
});

// Secondary port 4001 for Circuit Breaker stretch goal
const secondaryApp = createApp(true);
const secondaryServer = http.createServer(secondaryApp);
secondaryServer.listen(SECONDARY_PORT, () => {
  console.log(`Fleet Pulse Secondary Backend listening on port ${SECONDARY_PORT} (no chaos)`);
});

