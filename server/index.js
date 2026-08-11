import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = join(__dirname, "..", "frontend");

const todos = [];
let nextId = 1;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) {
      throw Object.assign(new Error("body too large"), { status: 413 });
    }
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("invalid JSON body"), { status: 400 });
  }
}

function validateTitle(title) {
  if (typeof title !== "string" || title.trim().length === 0) {
    return "title is required";
  }
  if (title.trim().length > 100) {
    return "title must be 100 characters or fewer";
  }
  return null;
}

async function handleApi(req, res) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  if (req.method === "GET" && path === "/api/todos") {
    sendJson(res, 200, { items: todos });
    return;
  }

  if (req.method === "POST" && path === "/api/todos") {
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      sendError(res, err.status || 400, "VALIDATION_ERROR", err.message);
      return;
    }
    const problem = validateTitle(body.title);
    if (problem) {
      sendError(res, 400, "VALIDATION_ERROR", problem);
      return;
    }
    const item = {
      id: String(nextId++),
      title: body.title.trim(),
      done: false,
      createdAt: new Date().toISOString(),
    };
    todos.push(item);
    sendJson(res, 201, item);
    return;
  }

  const match = path.match(/^\/api\/todos\/([^/]+)$/);
  if (req.method === "DELETE" && match) {
    const idx = todos.findIndex((t) => t.id === match[1]);
    if (idx === -1) {
      sendError(res, 404, "NOT_FOUND", "todo not found");
      return;
    }
    todos.splice(idx, 1);
    res.writeHead(204);
    res.end();
    return;
  }

  sendError(res, 404, "NOT_FOUND", "route not found");
}

async function handleStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = join(FRONTEND_DIR, path);
  if (!safePath.startsWith(FRONTEND_DIR)) {
    sendError(res, 403, "FORBIDDEN", "forbidden path");
    return;
  }
  try {
    const content = await readFile(safePath);
    res.writeHead(200, { "Content-Type": MIME[extname(safePath)] || "application/octet-stream" });
    res.end(content);
  } catch {
    sendError(res, 404, "NOT_FOUND", "file not found");
  }
}

const server = createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res).catch(() => sendError(res, 500, "INTERNAL_ERROR", "internal server error"));
  } else {
    handleStatic(req, res).catch(() => sendError(res, 500, "INTERNAL_ERROR", "internal server error"));
  }
});

const PORT = process.env.PORT || 3000;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

export { server };
