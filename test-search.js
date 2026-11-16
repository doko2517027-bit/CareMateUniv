export function addTestSearch(root, loadEntries) {
  const panel = document.createElement("section");
  panel.className = "panel form-stack";
  panel.innerHTML = '<label>試験対策を検索<input type="search" placeholder="区分・科目・単元・試験範囲"></label><div class="admin-list" aria-live="polite"></div>';
  const input = panel.querySelector("input");
  const results = panel.querySelector(".admin-list");
  root.prepend(panel);
  const normalize = value => String(value || "").normalize("NFKC").toLocaleLowerCase("ja");
  let entries;
  input.addEventListener("input", async () => {
    const terms = normalize(input.value).trim().split(/\s+/).filter(Boolean);
    if (!terms.length) { results.replaceChildren(); return; }
    results.textContent = "検索中…";
    try {
      entries ||= loadEntries().catch(error => { entries = null; throw error; });
      const rows = await entries;
      if (!panel.isConnected || terms.join(" ") !== normalize(input.value).trim().split(/\s+/).join(" ")) return;
      const matching = rows.filter(row => terms.every(term => normalize(row.words).includes(term)));
      results.textContent = matching.length ? `${matching.length}件` : "該当する項目がありません。";
      for (const row of matching.slice(0, 60)) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "secondary-button";
        button.style.overflowWrap = "anywhere";
        button.textContent = row.label;
        button.onclick = row.open;
        results.append(button);
      }
      if (matching.length > 60) results.append("検索語を追加すると、さらに絞り込めます。");
    } catch {
      if (panel.isConnected && input.value.trim()) results.textContent = "検索できませんでした。入力し直して再試行してください。";
    }
  });
}
