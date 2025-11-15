const EventEmitter = require('events');

jest.mock('./config', () => ({
  metrics: {
    source: 'test-service',
    url: 'http://example.com/metrics',
    apiKey: 'test-key',
    intervalMs: 5,
  },
}));

jest.mock('os', () => ({
  loadavg: () => [0.5],
  cpus: () => [{}, {}],
  totalmem: () => 1024,
  freemem: () => 256,
}));

class MockResponse extends EventEmitter {
  constructor() {
    super();
    this.statusCode = 200;
  }

  json(data) {
    this.lastJson = data;
    return data;
  }

  send(data) {
    this.lastSend = data;
    return data;
  }
}

function loadMetricsModule() {
  let metricsModule;
  jest.isolateModules(() => {
    metricsModule = require('./metrics');
  });
  return metricsModule;
}

describe('metrics collection', () => {
  afterEach(() => {
    delete global.fetch;
    jest.clearAllMocks();
  });

  it('aggregates and sends metrics with expected attributes', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve('') }));
    const metrics = loadMetricsModule();
    const next = jest.fn();

    metrics.requestTracker({ method: 'GET' }, {}, next);
    metrics.activeUserTracker({ user: { id: 'user-1' } }, {}, next);

    const authReqSuccess = { path: '/api/auth', method: 'POST' };
    const authResSuccess = new MockResponse();
    metrics.authTracker(authReqSuccess, authResSuccess, next);
    authResSuccess.statusCode = 200;
    authResSuccess.json({ user: { id: 1 }, token: 'abc' });

    const authReqFailure = { path: '/api/auth', method: 'PUT' };
    const authResFailure = new MockResponse();
    metrics.authTracker(authReqFailure, authResFailure, next);
    authResFailure.statusCode = 401;
    authResFailure.send({ message: 'denied' });

    const orderReqSuccess = { path: '/api/order', method: 'POST' };
    const orderResSuccess = new MockResponse();
    metrics.pizzaMetricsTracker(orderReqSuccess, orderResSuccess, next);
    orderResSuccess.statusCode = 201;
    orderResSuccess.send({ order: { items: [{ price: 10 }, { price: 5 }] } });

    const orderReqFailure = { path: '/api/order', method: 'POST' };
    const orderResFailure = new MockResponse();
    metrics.pizzaMetricsTracker(orderReqFailure, orderResFailure, next);
    orderResFailure.statusCode = 422;
    orderResFailure.send('invalid json');

    const latencyReq = { method: 'GET', baseUrl: '/api', route: { path: '/status' } };
    const latencyRes = new MockResponse();
    metrics.requestLatencyTracker(latencyReq, latencyRes, next);
    latencyRes.emit('finish');

    const fallbackLatencyReq = { method: 'POST', originalUrl: '/raw-endpoint' };
    const fallbackLatencyRes = new MockResponse();
    metrics.requestLatencyTracker(fallbackLatencyReq, fallbackLatencyRes, next);
    fallbackLatencyRes.emit('finish');

  await metrics.__collectMetricsForTest();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, options] = global.fetch.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer undefined:test-key'); //TODO: test userId instead of undefined

    const payload = JSON.parse(options.body);
    const metricsList = payload.resourceMetrics[0].scopeMetrics[0].metrics;

    const getDataPoints = (metric) => {
      if (metric.sum) {
        return metric.sum.dataPoints;
      }
      if (metric.gauge) {
        return metric.gauge.dataPoints;
      }
      return [];
    };

    const findMetrics = (name) => metricsList.filter((metric) => metric.name === name);

    const httpRequests = findMetrics('http_requests');
    expect(httpRequests).toHaveLength(1);
    expect(getDataPoints(httpRequests[0])[0].asInt).toBe(1);

    const activeUsers = findMetrics('active_users');
    expect(getDataPoints(activeUsers[0])[0].asInt).toBe(1);

    const authMetrics = findMetrics('auth_attempts');
    expect(authMetrics).toHaveLength(2);
    const successMetric = authMetrics.find((metric) =>
      getDataPoints(metric)[0].attributes.some(
        (attr) => attr.key === 'status' && attr.value.stringValue === 'success'
      )
    );
    const failureMetric = authMetrics.find((metric) =>
      getDataPoints(metric)[0].attributes.some(
        (attr) => attr.key === 'status' && attr.value.stringValue === 'failure'
      )
    );
    expect(getDataPoints(successMetric)[0].asInt).toBe(1);
    expect(getDataPoints(failureMetric)[0].asInt).toBe(1);

    const pizzaPurchases = findMetrics('pizza_purchases');
    expect(getDataPoints(pizzaPurchases[0])[0].asInt).toBe(1);

    const pizzaFailures = findMetrics('pizza_creation_failures');
    expect(getDataPoints(pizzaFailures[0])[0].asInt).toBe(1);

    const pizzaRevenue = findMetrics('pizza_revenue');
    expect(getDataPoints(pizzaRevenue[0])[0].asDouble).toBeCloseTo(15);

    const pizzaLatency = findMetrics('pizza_creation_latency');
    expect(getDataPoints(pizzaLatency[0])[0].asDouble).toBeGreaterThanOrEqual(0);

    const httpLatencyMetrics = findMetrics('http_request_latency');
    expect(httpLatencyMetrics).toHaveLength(2);
    const firstLatencyAttrs = getDataPoints(httpLatencyMetrics[0])[0].attributes;
    const secondLatencyAttrs = getDataPoints(httpLatencyMetrics[1])[0].attributes;

    expect(firstLatencyAttrs).toEqual(
      expect.arrayContaining([
        { key: 'method', value: { stringValue: 'GET' } },
        { key: 'route', value: { stringValue: '/api/status' } },
        { key: 'source', value: { stringValue: 'test-service' } },
      ])
    );

    expect(secondLatencyAttrs).toEqual(
      expect.arrayContaining([
        { key: 'method', value: { stringValue: 'POST' } },
        { key: 'route', value: { stringValue: '/raw-endpoint' } },
        { key: 'source', value: { stringValue: 'test-service' } },
      ])
    );
  });

  it('logs an error when Grafana rejects metrics', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.resolve('boom'),
      })
    );

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const metrics = loadMetricsModule();
    metrics.requestTracker({ method: 'GET' }, {}, jest.fn());

  await metrics.__collectMetricsForTest();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith('Failed to push metrics to Grafana', 500, 'boom');
    expect(consoleSpy).toHaveBeenCalledWith(
      'Metrics payload:',
      expect.stringContaining('http_requests')
    );

    consoleSpy.mockRestore();
  });
});
