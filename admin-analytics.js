const rate = (correct, attempts) => attempts ? Math.round(100 * correct / attempts) : 0;
const normalize = value => String(value).normalize("NFKC").toLocaleLowerCase("ja").trim();
const dateKey = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" });
const isQuiz = row => row.questionKey.startsWith("quiz:");

export function renderAdminAnalytics(root, context, { rows, subjects, unitsBySubject, progress, escapeHtml }) {
  root.innerHTML = `<section class="panel form-stack analytics-filters">
    <h2>分析範囲</h2>
    <div class="split"><label>科目<select id="analysisSubject"></select></label><label>単元<select id="analysisUnit"></select></label></div>
  </section><div id="analysisMetrics"></div><section class="panel form-stack">
    <h2 id="analysisBreakdownTitle"></h2><div id="analysisBreakdown" class="analysis-card-grid"></div>
  </section><section class="panel form-stack">
    <h2>最近14日間の記録更新</h2><p class="hint">各学生・単元の最終更新日を集計しています。</p>
    <canvas id="analysisTrend" height="180" role="img"></canvas>
    <details><summary>日別の件数を見る</summary><dl id="analysisDates"></dl></details>
  </section><section class="panel form-stack"><h2>問題別の結果</h2>
    <label>問題・科目・単元を検索<input id="analysisSearch" type="search" placeholder="検索"></label>
    <div class="split">
      <label>問題形式<select id="analysisType"><option value="">すべて</option><option value="quiz">選択問題</option><option value="fill_blank">穴埋め</option></select></label>
      <label>正答率<select id="analysisRange"><option value="">すべて</option><option value="review">要復習（60％未満）</option><option value="low">0〜29％</option><option value="mid">30〜59％</option><option value="high">60〜100％</option></select></label>
      <label>並べ替え<select id="analysisSort"><option value="low">正答率が低い順</option><option value="high">正答率が高い順</option><option value="attempts">解答数が多い順</option></select></label>
    </div>
    <p id="analysisCount" class="hint" role="status"></p><div id="analysisRows"></div>
    <div class="inline-actions"><button id="analysisPrev" class="secondary-button" type="button">前へ</button><span id="analysisPage"></span><button id="analysisNext" class="secondary-button" type="button">次へ</button></div>
  </section>`;
  const get = id => root.querySelector(`#${id}`);
  const subject = get("analysisSubject");
  const unit = get("analysisUnit");
  const search = get("analysisSearch");
  const type = get("analysisType");
  const range = get("analysisRange");
  const sort = get("analysisSort");
  const currentRows = rows.filter(row => {
    const [kind, index] = row.questionKey.split(":");
    return !!unitsBySubject.get(row.subjectId)?.find(item => item.id === row.unitId)?.[kind]?.[index];
  });
  const summarize = entries => entries.reduce((total, row) => ({
    attempts: total.attempts + row.attempts, correct: total.correct + row.correct,
  }), { attempts: 0, correct: 0 });
  let page = 0;
  let chart = [];
  const pageSize = 10;

  subject.replaceChildren(new Option("すべての科目", ""), ...subjects.map(item => new Option(item.name, item.id)));
  const updateUnits = () => unit.replaceChildren(new Option("すべての単元", ""),
    ...(unitsBySubject.get(subject.value) || []).map(item => new Option(item.name, item.id)));
  const inScope = item => (!subject.value || item.subjectId === subject.value) && (!unit.value || item.unitId === unit.value);

  function drawTrend() {
    const canvas = get("analysisTrend");
    const width = canvas.clientWidth;
    if (!width) return;
    const height = 180;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    const colors = getComputedStyle(canvas);
    const max = Math.max(1, ...chart.map(item => item.count));
    const x = index => 28 + (width - 40) * index / (chart.length - 1);
    const y = count => height - 25 - (height - 45) * count / max;
    ctx.font = "12px sans-serif";
    ctx.fillStyle = colors.getPropertyValue("--muted").trim();
    ctx.strokeStyle = colors.getPropertyValue("--border").trim();
    for (const count of [0, max]) {
      ctx.fillText(String(count), 2, y(count) + 4);
      ctx.beginPath(); ctx.moveTo(x(0), y(count)); ctx.lineTo(x(13), y(count)); ctx.stroke();
    }
    ctx.fillText(chart[0].day.slice(5), x(0), height - 4);
    ctx.textAlign = "right";
    ctx.fillText(chart[13].day.slice(5), x(13), height - 4);
    ctx.strokeStyle = ctx.fillStyle = colors.getPropertyValue("--primary").trim();
    ctx.lineWidth = 2;
    ctx.beginPath();
    chart.forEach(({ count }, i) => i ? ctx.lineTo(x(i), y(count)) : ctx.moveTo(x(i), y(count)));
    ctx.stroke();
    chart.forEach(({ count }, i) => {
      ctx.beginPath(); ctx.arc(x(i), y(count), 3, 0, Math.PI * 2); ctx.fill();
    });
  }

  function updateScope() {
    const scoped = currentRows.filter(inScope);
    const records = progress.filter(item => inScope(item) && unitsBySubject.get(item.subjectId)?.some(unit => unit.id === item.unitId));
    const totals = summarize(scoped);
    const learners = new Set(records.filter(item => Object.values(item.questionStats || {}).some(stat => Number(stat?.attempts) > 0)).map(item => item.uid));
    get("analysisMetrics").innerHTML = `<section class="analytics-summary">${[
      ["参加者", learners.size, "人"], ["正答率", totals.attempts ? rate(totals.correct, totals.attempts) : "—", totals.attempts ? "%" : ""],
      ["総解答数", totals.attempts, "回"], ["要復習", scoped.filter(row => row.rate < 60).length, "問"],
    ].map(([label, value, suffix]) => `<article><span>${label}</span><strong>${value}</strong><small>${suffix}</small></article>`).join("")}</section>`;

    const groups = unit.value ? ["quiz", "fill_blank"].map(id => ({
      name: id === "quiz" ? "選択問題" : "穴埋め", rows: scoped.filter(row => row.questionKey.startsWith(id)),
    })) : (subject.value ? unitsBySubject.get(subject.value) || [] : subjects).map(item => ({
      name: item.name, id: item.id, rows: scoped.filter(row => item.id === (subject.value ? row.unitId : row.subjectId)),
    }));
    get("analysisBreakdownTitle").textContent = unit.value ? "問題形式別" : subject.value ? "単元別" : "科目別";
    const breakdown = get("analysisBreakdown");
    breakdown.replaceChildren(...groups.map(group => {
      const card = document.createElement(group.id ? "button" : "article");
      card.className = group.id ? "secondary-button analysis-breakdown-card" : "analysis-progress-card";
      const { attempts, correct } = summarize(group.rows);
      card.innerHTML = `<strong>${escapeHtml(group.name)}</strong><small>${attempts ? `正答率 ${rate(correct, attempts)}％・${attempts}回解答` : "解答記録なし"}</small>${attempts ? `<progress class="progress-meter mini-progress" max="100" value="${rate(correct, attempts)}" aria-label="正答率"></progress>` : ""}`;
      if (group.id) {
        card.type = "button";
        card.onclick = () => {
          if (subject.value) unit.value = group.id;
          else { subject.value = group.id; updateUnits(); }
          updateScope();
          get("analysisBreakdownTitle").scrollIntoView({ block: "center" });
        };
      }
      return card;
    }));

    const counts = records.reduce((map, row) => {
      const date = row.updatedAt?.toDate?.();
      if (date) {
        const key = dateKey.format(date);
        map.set(key, (map.get(key) || 0) + 1);
      }
      return map;
    }, new Map());
    const now = Date.now();
    chart = Array.from({ length: 14 }, (_, index) => {
      const day = dateKey.format(new Date(now - (13 - index) * 86400000));
      return { day, count: counts.get(day) || 0 };
    });
    get("analysisDates").innerHTML = chart.map(({day, count}) => `<dt>${day}</dt><dd>${count}件</dd>`).join("");
    get("analysisTrend").setAttribute("aria-label", "最近14日間の最終更新件数。日別の件数は下の一覧で確認できます。");
    drawTrend();
    resetPage();
  }

  function renderRows() {
    const terms = normalize(search.value).split(/\s+/).filter(Boolean);
    const filtered = currentRows.filter(row => inScope(row)
      && (!type.value || row.questionKey.startsWith(type.value + ":"))
      && terms.every(term => normalize(`${row.subject} ${row.unit} ${row.question}`).includes(term))
      && ({ review: row.rate < 60, low: row.rate < 30, mid: row.rate >= 30 && row.rate < 60, high: row.rate >= 60 }[range.value] ?? true));
    filtered.sort((a, b) => sort.value === "attempts" ? b.attempts - a.attempts
      : sort.value === "high" ? b.rate - a.rate : a.rate - b.rate || b.attempts - a.attempts);
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    get("analysisCount").textContent = `${filtered.length}問`;
    get("analysisPage").textContent = `${page + 1} / ${pages}`;
    get("analysisPrev").disabled = page === 0;
    get("analysisNext").disabled = page + 1 >= pages;
    const results = get("analysisRows");
    results.innerHTML = filtered.length ? "" : '<p class="empty">条件に一致する解答記録がありません。</p>';
    for (const row of filtered.slice(page * pageSize, (page + 1) * pageSize)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary-button analysis-question-row";
      button.innerHTML = `<span><small>${escapeHtml(row.subject)} / ${escapeHtml(row.unit)}</small><strong>${escapeHtml(row.question)}</strong></span><b>${row.rate}％</b><span aria-hidden="true">›</span>`;
      button.onclick = () => context.show(`<h2>問題の分析</h2><p class="hint">${escapeHtml(row.subject)} / ${escapeHtml(row.unit)} · ${isQuiz(row) ? "選択問題" : "穴埋め"}</p><p>${escapeHtml(row.question)}</p><p>正答率 <strong>${row.rate}％</strong></p><progress max="100" value="${row.rate}" aria-label="正答率"></progress><p>解答 ${row.attempts}回　正解 ${row.correct}回　不正解 ${row.attempts - row.correct}回</p>`);
      results.append(button);
    }
  }
  function resetPage() { page = 0; renderRows(); }
  subject.onchange = () => { updateUnits(); updateScope(); };
  unit.onchange = updateScope;
  search.oninput = resetPage;
  type.onchange = range.onchange = sort.onchange = resetPage;
  get("analysisPrev").onclick = () => { page--; renderRows(); };
  get("analysisNext").onclick = () => { page++; renderRows(); };
  const canvas = get("analysisTrend");
  const observer = new ResizeObserver(() => {
    if (canvas.isConnected) drawTrend();
    else observer.disconnect();
  });
  observer.observe(canvas);
  updateUnits();
  updateScope();
}
