const os = require('os');
const config = require('./config');

// Metrics stored in memory
const httpMetrics = {};
let activeUsers = new Set();
let authAttempts = { success: 0, failure: 0 };
let pizzaMetrics = {
  purchases: 0,
  creationFailures: 0,
  revenue: 0
};
let pizzaLatency = [];

// Middleware to track HTTP requests by method
function requestTracker(req, res, next) {
  const method = req.method;
  httpMetrics[method] = (httpMetrics[method] || 0) + 1;
  next();
}

// Track active users
function trackActiveUser(userId) {
  if (userId) {
    activeUsers.add(userId);
  }
}

// Track authentication attempts
function trackAuthAttempt(success) {
  if (success) {
    authAttempts.success++;
  } else {
    authAttempts.failure++;
  }
}

// Track pizza purchases
function trackPizzaPurchase(success, revenue = 0) {
  if (success) {
    pizzaMetrics.purchases++;
    pizzaMetrics.revenue += revenue;
  } else {
    pizzaMetrics.creationFailures++;
  }
}

// Track pizza creation latency
function trackPizzaLatency(latencyMs) {
  pizzaLatency.push(latencyMs);
}

// Get CPU usage percentage
function getCpuUsagePercentage() {
  const cpuUsage = os.loadavg()[0] / os.cpus().length;
  return cpuUsage.toFixed(2) * 100;
}

// Get memory usage percentage
function getMemoryUsagePercentage() {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryUsage = (usedMemory / totalMemory) * 100;
  return memoryUsage.toFixed(2);
}

// This will periodically send metrics to Grafana
setInterval(() => {
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
    metrics.push(createMetric('memory_usage', getMemoryUsagePercentage(), 'percent', 'asDouble', {}));

    // Pizza metrics
    metrics.push(createMetric('pizza_purchases', pizzaMetrics.purchases, '1', 'sum', 'asInt', {}));
    metrics.push(createMetric('pizza_creation_failures', pizzaMetrics.creationFailures, '1', 'sum', 'asInt', {}));
    metrics.push(createMetric('pizza_revenue', pizzaMetrics.revenue, 'USD', 'sum', 'asDouble', {}));

    // Pizza latency (average)
    if (pizzaLatency.length > 0) {
      const avgLatency = pizzaLatency.reduce((a, b) => a + b, 0) / pizzaLatency.length;
      metrics.push(createMetric('pizza_creation_latency', avgLatency, 'ms', 'gauge', 'asDouble', {}));
      pizzaLatency = []; // Reset after sending
    }

    sendMetricToGrafana(metrics);
  } catch (error) {
    console.error('Error collecting metrics:', error);
  }
}, 10000);

function createMetric(metricName, metricValue, metricUnit, metricType, valueType, attributes) {
  attributes = { ...attributes, source: config.metrics.source };

  const metric = {
    name: metricName,
    unit: metricUnit,
    [metricType]: {
      dataPoints: [
        {
          [valueType]: metricValue,
          timeUnixNano: Date.now() * 1000000,
          attributes: [],
        },
      ],
    },
  };

  Object.keys(attributes).forEach((key) => {
    metric[metricType].dataPoints[0].attributes.push({
      key: key,
      value: { stringValue: attributes[key] },
    });
  });

  if (metricType === 'sum') {
    metric[metricType].aggregationTemporality = 'AGGREGATION_TEMPORALITY_CUMULATIVE';
    metric[metricType].isMonotonic = true;
  }

  return metric;
}

function sendMetricToGrafana(metrics) {
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

  fetch(`${config.metrics.url}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { Authorization: `Bearer ${config.metrics.apiKey}`, 'Content-Type': 'application/json' },
  })
    .then((response) => {
      if (!response.ok) {
        console.log('Failed to push metrics to Grafana', response.status);
      }
    })
    .catch((error) => {
      console.error('Error pushing metrics:', error);
    });
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
        } catch (e) {
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
  activeUserTracker,
  authTracker,
  pizzaMetricsTracker
};


