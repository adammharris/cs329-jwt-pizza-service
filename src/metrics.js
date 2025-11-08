const os = require('os');
const config = require('./config');

const metricsConfig = config.metrics || {};
const METRIC_PUSH_INTERVAL = metricsConfig.intervalMs || 10000;

// Metrics stored in memory
const httpMetrics = {};
const httpLatency = {};
let activeUsers = new Set();
let authAttempts = { success: 0, failure: 0 };
let pizzaMetrics = {
  purchases: 0,
  creationFailures: 0,
  revenue: 0
};
let pizzaLatency = { total: 0, count: 0 };

// Middleware to track HTTP requests by method
function requestTracker(req, res, next) {
  const method = req.method;
  httpMetrics[method] = (httpMetrics[method] || 0) + 1;
  next();
}

// Track pizza creation latency
function trackPizzaLatency(latencyMs) {
  if (!Number.isFinite(latencyMs)) {
    return;
  }
  pizzaLatency.total += latencyMs;
  pizzaLatency.count += 1;
}

// Get CPU usage percentage
function getCpuUsagePercentage() {
  const cpuUsage = os.loadavg()[0] / os.cpus().length;
  return parseFloat((cpuUsage * 100).toFixed(2));
}

// Get memory usage percentage
function getMemoryUsagePercentage() {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryUsage = (usedMemory / totalMemory) * 100;
  return parseFloat(memoryUsage.toFixed(2));
}

async function collectMetrics() {
  try {
    const metrics = [];

    // HTTP request metrics by method
    Object.keys(httpMetrics).forEach((method) => {
      metrics.push(createMetric('http_requests', httpMetrics[method], '1', 'sum', 'asInt', { method }));
    });

    // Active user count
    metrics.push(createMetric('active_users', activeUsers.size, '1', 'gauge', 'asInt', {}));

    // Authentication attempts
    metrics.push(createMetric('auth_attempts', authAttempts.success, '1', 'sum', 'asInt', { status: 'success' }));
    metrics.push(createMetric('auth_attempts', authAttempts.failure, '1', 'sum', 'asInt', { status: 'failure' }));

    // CPU and Memory usage
    metrics.push(createMetric('cpu_usage', getCpuUsagePercentage(), 'percent', 'gauge', 'asDouble', {}));
    metrics.push(createMetric('memory_usage', getMemoryUsagePercentage(), 'percent', 'gauge', 'asDouble', {}));

    // Pizza metrics
    metrics.push(createMetric('pizza_purchases', pizzaMetrics.purchases, '1', 'sum', 'asInt', {}));
    metrics.push(createMetric('pizza_creation_failures', pizzaMetrics.creationFailures, '1', 'sum', 'asInt', {}));
    metrics.push(createMetric('pizza_revenue', pizzaMetrics.revenue, 'USD', 'sum', 'asDouble', {}));

    // Pizza latency (average)
    if (pizzaLatency.count > 0) {
      const avgLatency = pizzaLatency.total / pizzaLatency.count;
      metrics.push(createMetric('pizza_creation_latency', avgLatency, 'ms', 'gauge', 'asDouble', {}));
      pizzaLatency = { total: 0, count: 0 }; // Reset after sending
    }

    // HTTP latency by method and route
    Object.keys(httpLatency).forEach((key) => {
      const latencyEntry = httpLatency[key];
      if (latencyEntry.count === 0) {
        return;
      }
      const avgLatency = latencyEntry.total / latencyEntry.count;
      const [method, route] = key.split('::');
      metrics.push(createMetric('http_request_latency', avgLatency, 'ms', 'gauge', 'asDouble', { method, route }));
      delete httpLatency[key];
    });

    // Only send if we have metrics
    if (metrics.length > 0) {
      await sendMetricToGrafana(metrics);
    }
  } catch (error) {
    console.error('Error collecting metrics:', error);
  }
}

let metricsIntervalHandle = null;

function startMetricsCollection() {
  if (metricsIntervalHandle || METRIC_PUSH_INTERVAL <= 0) {
    return metricsIntervalHandle;
  }
  metricsIntervalHandle = setInterval(() => {
    collectMetrics();
  }, METRIC_PUSH_INTERVAL);
  return metricsIntervalHandle;
}

function stopMetricsCollection() {
  if (metricsIntervalHandle) {
    clearInterval(metricsIntervalHandle);
    metricsIntervalHandle = null;
  }
}

if (process.env.NODE_ENV !== 'test') {
  startMetricsCollection();
}

function createMetric(metricName, metricValue, metricUnit, metricType, valueType, attributes) {
  attributes = { ...attributes, source: metricsConfig.source };

  // Ensure proper type conversion
  const value = valueType === 'asInt' ? Math.floor(metricValue) : parseFloat(metricValue);

  const dataPoint = {
    [valueType]: value,
    timeUnixNano: Date.now() * 1000000,
    attributes: [],
  };

  Object.keys(attributes).forEach((key) => {
    dataPoint.attributes.push({
      key: key,
      value: { stringValue: String(attributes[key]) },
    });
  });

  const metric = {
    name: metricName,
    unit: metricUnit,
    [metricType]: {
      dataPoints: [dataPoint],
    },
  };

  if (metricType === 'sum') {
    metric[metricType].aggregationTemporality = 'AGGREGATION_TEMPORALITY_CUMULATIVE';
    metric[metricType].isMonotonic = true;
  }

  return metric;
}

async function sendMetricToGrafana(metrics) {
  if (!metricsConfig.url || !metricsConfig.apiKey) {
    throw new Error('Missing Grafana metrics configuration');
  }

  const body = {
    resourceMetrics: [
      {
        scopeMetrics: [
          {
            metrics,
          },
        ],
      },
    ],
  };

  const response = await fetch(metricsConfig.url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${metricsConfig.apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Failed to push metrics to Grafana', response.status, errorText);
    console.error('Metrics payload:', JSON.stringify(body, null, 2));
  }
}

function requestLatencyTracker(req, res, next) {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const diff = process.hrtime.bigint() - start;
    const latencyMs = Number(diff) / 1e6;
    const method = req.method;
    const routeBase = req.baseUrl || '';
    const routePath = (req.route && req.route.path) || req.path || '';
    const fallbackRoute = req.originalUrl || 'unknown';
    let route = `${routeBase}${routePath}`;
    if (!route) {
      route = fallbackRoute;
    }
    route = route.replace(/\/+/g, '/');
    const key = `${method}::${route}`;

    if (!httpLatency[key]) {
      httpLatency[key] = { total: 0, count: 0 };
    }

    httpLatency[key].total += latencyMs;
    httpLatency[key].count += 1;
  });

  next();
}

// Middleware to track active users
function activeUserTracker(req, res, next) {
  if (req.user && req.user.id) {
    activeUsers.add(req.user.id);
  }
  next();
}

// Middleware to track authentication attempts
function authTracker(req, res, next) {
  // Only track POST (register) and PUT (login) on /api/auth
  if (req.path === '/api/auth' && (req.method === 'POST' || req.method === 'PUT')) {
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    res.json = function(data) {
      // Success responses have user and token
      if (res.statusCode >= 200 && res.statusCode < 300 && data.user && data.token) {
        authAttempts.success++;
      } else if (res.statusCode >= 400) {
        authAttempts.failure++;
      }
      return originalJson(data);
    };

    res.send = function(data) {
      if (res.statusCode >= 400) {
        authAttempts.failure++;
      }
      return originalSend(data);
    };
  }
  next();
}

// Middleware to track pizza orders
function pizzaMetricsTracker(req, res, next) {
  // Only track POST on /api/order
  if (req.path === '/api/order' && req.method === 'POST') {
    const startTime = Date.now();

    const originalSend = res.send.bind(res);

    res.send = function(data) {
      const latency = Date.now() - startTime;
      trackPizzaLatency(latency);

      // Parse response if it's a string
      let responseData = data;
      if (typeof data === 'string') {
        try {
          responseData = JSON.parse(data);
        } catch {
          responseData = data;
        }
      }

      if (res.statusCode >= 200 && res.statusCode < 300 && responseData.order) {
        // Success - calculate revenue
        const revenue = responseData.order.items
          ? responseData.order.items.reduce((sum, item) => sum + (item.price || 0), 0)
          : 0;
        pizzaMetrics.purchases++;
        pizzaMetrics.revenue += revenue;
      } else if (res.statusCode >= 400) {
        // Failure
        pizzaMetrics.creationFailures++;
      }

      return originalSend(data);
    };
  }
  next();
}

module.exports = {
  requestTracker,
  requestLatencyTracker,
  activeUserTracker,
  authTracker,
  pizzaMetricsTracker,
  __collectMetricsForTest: collectMetrics,
  __startMetricsCollection: startMetricsCollection,
  __stopMetricsCollection: stopMetricsCollection
};


