import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { server } from "./index.js";

let base;
let httpServer;

before(async () => {
  await new Promise((resolve) => {
    httpServer = server.listen(0, () => {
      base = `http://localhost:${httpServer.address().port}`;
      resolve();
    });
  });
});

after(() => {
  httpServer.close();
});

test("GET /api/todos returns empty list", async () => {
  const res = await fetch(`${base}/api/todos`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { items: [] });
});

test("POST /api/todos creates a todo", async () => {
  const res = await fetch(`${base}/api/todos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "写 API.md" }),
  });
  assert.equal(res.status, 201);
  const item = await res.json();
  assert.equal(item.title, "写 API.md");
  assert.equal(item.done, false);
  assert.ok(item.id);
});

test("POST /api/todos rejects empty title", async () => {
  const res = await fetch(`${base}/api/todos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "   " }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, "VALIDATION_ERROR");
});

test("POST /api/todos rejects title longer than 100 chars", async () => {
  const res = await fetch(`${base}/api/todos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "x".repeat(101) }),
  });
  assert.equal(res.status, 400);
});

test("DELETE /api/todos/:id removes a todo", async () => {
  const created = await (
    await fetch(`${base}/api/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "待删除" }),
    })
  ).json();

  const res = await fetch(`${base}/api/todos/${created.id}`, { method: "DELETE" });
  assert.equal(res.status, 204);

  const afterDelete = await (await fetch(`${base}/api/todos`)).json();
  assert.equal(afterDelete.items.some((t) => t.id === created.id), false);
});

test("DELETE /api/todos/:id returns 404 for unknown id", async () => {
  const res = await fetch(`${base}/api/todos/999`, { method: "DELETE" });
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.code, "NOT_FOUND");
});

test("unknown API route returns 404 with error shape", async () => {
  const res = await fetch(`${base}/api/nope`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.ok(body.error.code);
});
