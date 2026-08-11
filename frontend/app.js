const listEl = document.getElementById("list");
const formEl = document.getElementById("add-form");
const inputEl = document.getElementById("title-input");
const errorEl = document.getElementById("form-error");
const submitBtn = formEl.querySelector("button[type='submit']");

function showState(kind, message) {
  listEl.innerHTML = "";
  const el = document.createElement("p");
  el.className = "list__state";
  el.textContent = message;
  listEl.appendChild(el);
}

function showList(items) {
  listEl.innerHTML = "";
  if (items.length === 0) {
    showState("empty", "还没有任务，添加一个吧。");
    return;
  }
  const frag = document.createDocumentFragment();
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "list__item";

    const title = document.createElement("span");
    title.className = "list__title";
    title.textContent = item.title;

    const del = document.createElement("button");
    del.className = "list__delete";
    del.type = "button";
    del.textContent = "删除";
    del.addEventListener("click", async () => {
      del.disabled = true;
      try {
        const res = await fetch(`/api/todos/${encodeURIComponent(item.id)}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error("删除失败");
        await load();
      } catch (err) {
        del.disabled = false;
        showState("error", err.message);
      }
    });

    row.append(title, del);
    frag.appendChild(row);
  }
  listEl.appendChild(frag);
}

async function load() {
  showState("loading", "加载中…");
  try {
    const res = await fetch("/api/todos");
    if (!res.ok) throw new Error("加载失败，请稍后重试");
    const data = await res.json();
    showList(data.items);
  } catch (err) {
    showState("error", err.message || "网络错误");
  }
}

formEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.hidden = true;
  const title = inputEl.value.trim();
  if (!title) return;
  submitBtn.disabled = true;
  try {
    const res = await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error?.message || "添加失败");
    }
    inputEl.value = "";
    await load();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  } finally {
    submitBtn.disabled = false;
    inputEl.focus();
  }
});

load();
