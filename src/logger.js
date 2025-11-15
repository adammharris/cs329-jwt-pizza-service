const os = require("os");
const config = require("./config");

const loggingConfig = config.logging || {};
const LOG_PUSH_INTERVAL = loggingConfig.intervalMs || 10000;

// In-memory buffer of log entries to batch to Grafana Loki
let logBuffer = [];
let logIntervalHandle = null;

// --- Sanitization helpers -------------------------------------------------

const SENSITIVE_KEYS = new Set([
  "password",
  "pwd",
  "pass",
  "token",
  "authorization",
  "auth",
  "apiKey",
  "apikey",
  "secret",
  "jwt",
]);

function sanitizeValue(value) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    // If it looks like a bearer / API key / long token, redact it
    if (/bearer\s+.+/i.test(value) || value.length > 32) {
      return "**redacted**";
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }

  if (typeof value === "object") {
    const result = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) {
        result[k] = "**redacted**";
      } else {
        result[k] = sanitizeValue(v);
      }
    }
    return result;
  }

  return value;
}

function safeJson(obj) {
  try {
    return JSON.stringify(sanitizeValue(obj));
  } catch {
    return '"<unserializable>"';
  }
}

// --- Core logging primitives ---------------------------------------------

function pushLog(level, message, fields = {}) {
  const entry = {
    level,
    message,
    source: loggingConfig.source,
    hostname: os.hostname(),
    ts: new Date().toISOString(),
    ...sanitizeValue(fields),
  };

  logBuffer.push(entry);
}

async function flushLogs() {
  if (!loggingConfig.url || !loggingConfig.apiKey) {
    return;
  }
  if (logBuffer.length === 0) {
    return;
  }

  const batch = logBuffer;
  logBuffer = [];

  const body = {
    streams: [
      {
        stream: {
          component: loggingConfig.source || "jwt-pizza-service",
        },
        values: batch.map((entry) => [
          String(Date.now() * 1_000_000),
          safeJson(entry),
          {
            level: entry.level,
            type: entry.message,
            userId: loggingConfig.userId
              ? String(loggingConfig.userId)
              : undefined,
          },
        ]),
      },
    ],
  };

  try {
    const response = await fetch(loggingConfig.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${loggingConfig.userId}:${loggingConfig.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(
        "Failed to push logs to Grafana Loki",
        response.status,
        text
      );
    }
  } catch (err) {
    console.error("Error pushing logs to Grafana Loki", err.message);
  }
  console.log("Flushing logs to Grafana Loki, entries:", batch.length);
}

function startLogFlush() {
  if (logIntervalHandle || LOG_PUSH_INTERVAL <= 0) {
    return logIntervalHandle;
  }
  logIntervalHandle = setInterval(() => {
    flushLogs();
  }, LOG_PUSH_INTERVAL);
  return logIntervalHandle;
}

function stopLogFlush() {
  if (logIntervalHandle) {
    clearInterval(logIntervalHandle);
    logIntervalHandle = null;
  }
}

if (process.env.NODE_ENV !== "test") {
  startLogFlush();
}

// --- HTTP request logging middleware -------------------------------------

function httpLoggerMiddleware(req, res, next) {
  const start = process.hrtime.bigint();

  const hasAuthHeader = Boolean(req.headers && req.headers.authorization);
  const requestBody = req.body;

  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  let responseBody; // capture last body

  res.json = function loggedJson(body) {
    responseBody = body;
    return originalJson(body);
  };

  res.send = function loggedSend(body) {
    responseBody = body;
    return originalSend(body);
  };

  res.on("finish", () => {
    const diff = process.hrtime.bigint() - start;
    const latencyMs = Number(diff) / 1e6;

    pushLog("info", "http_request", {
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      latencyMs,
      hasAuthorization: hasAuthHeader,
      requestBody,
      responseBody,
      ip: req.ip,
    });
  });

  next();
}

// --- Database logging wrapper --------------------------------------------

function wrapDb(dbInstance) {
  if (!dbInstance || typeof dbInstance.query !== "function") {
    return dbInstance;
  }

  const originalQuery = dbInstance.query.bind(dbInstance);

  dbInstance.query = async function loggedQuery(connection, sql, params) {
    pushLog("debug", "db_query", {
      sql,
    });

    return originalQuery(connection, sql, params);
  };

  return dbInstance;
}

// --- Factory service logging ---------------------------------------------

function logFactoryRequest({
  url,
  method,
  requestBody,
  responseBody,
  statusCode,
}) {
  pushLog("info", "factory_request", {
    url,
    method,
    statusCode,
    requestBody,
    responseBody,
  });
}

// --- Unhandled exception logging -----------------------------------------

function logError(err, context = {}) {
  pushLog("error", err.message || "Unhandled error", {
    name: err.name,
    stack: err.stack,
    ...context,
  });
}

module.exports = {
  httpLoggerMiddleware,
  wrapDb,
  logFactoryRequest,
  logError,
  __sanitizeValue: sanitizeValue,
  __safeJson: safeJson,
  __pushLog: pushLog,
  __flushLogs: flushLogs,
  __startLogFlush: startLogFlush,
  __stopLogFlush: stopLogFlush,
};
