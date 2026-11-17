export function enableCatalogReorder(list, save, notify) {
  const rows = [...list.querySelectorAll("article")];
  if (rows.length < 2) return;
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "≡ を長押しして上下に移動";
  list.before(hint);
  let pending = false;
  let drag;

  async function saveOrder(previous) {
    const next = [...list.querySelectorAll("article")];
    if (next.every((row, index) => row === previous[index])) return;
    pending = true;
    try {
      await save(next.map(row => row.dataset.catalogId));
      notify("並び順を保存しました。");
    } catch {
      list.append(...previous);
      notify("並び順を保存できませんでした。", true);
    } finally {
      pending = false;
    }
  }

  const canMove = () => !pending && !rows.some(row => row.hidden);
  for (const row of rows) {
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "secondary-button compact-button catalog-drag-handle";
    handle.textContent = "≡";
    handle.setAttribute("aria-label", "並べ替え。上下矢印キーでも移動できます");
    row.querySelector(".inline-actions").prepend(handle);
    handle.onpointerdown = event => {
      if (!event.isPrimary || event.button !== 0 || !canMove()) return;
      list.setPointerCapture(event.pointerId);
      list.onpointermove = onMove;
      list.onpointerup = finish;
      list.onpointercancel = finish;
      list.onlostpointercapture = finish;
      const state = { id: event.pointerId, y: event.clientY, previous: [...list.querySelectorAll("article")] };
      drag = state;
      state.timer = setTimeout(() => {
        state.active = true;
        row.classList.add("catalog-dragging");
      }, 300);
    };
    handle.oncontextmenu = event => event.preventDefault();
    const move = y => {
      const others = [...list.querySelectorAll("article")].filter(item => item !== row);
      const target = others.find(item => {
        const rect = item.getBoundingClientRect();
        return y < rect.top + rect.height / 2;
      });
      if ((target || null) !== row.nextElementSibling) list.insertBefore(row, target || null);
    };
    const onMove = event => {
      if (drag?.id !== event.pointerId) return;
      if (!drag.active) {
        if (Math.abs(event.clientY - drag.y) > 10) clearTimeout(drag.timer);
        return;
      }
      drag.y = event.clientY;
      move(drag.y);
      if (drag.frame) return;
      const scroll = () => {
        if (!drag?.active) return;
        drag.frame = 0;
        const speed = drag.y < 95 ? -12 : drag.y > window.innerHeight - 100 ? 12 : 0;
        if (!speed) return;
        window.scrollBy(0, speed);
        move(drag.y);
        drag.frame = requestAnimationFrame(scroll);
      };
      drag.frame = requestAnimationFrame(scroll);
    };
    const finish = event => {
      if (drag?.id !== event.pointerId) return;
      const { timer, frame, previous, active } = drag;
      drag = null;
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      row.classList.remove("catalog-dragging");
      if (active && event.type === "pointerup") void saveOrder(previous);
      else if (active) list.append(...previous);
    };
    handle.onkeydown = event => {
      if (!canMove() || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const up = event.key === "ArrowUp";
      const adjacent = up ? row.previousElementSibling : row.nextElementSibling;
      if (!adjacent) return;
      const previous = [...list.querySelectorAll("article")];
      list.insertBefore(row, up ? adjacent : adjacent.nextElementSibling);
      handle.focus();
      void saveOrder(previous);
    };
  }
}
