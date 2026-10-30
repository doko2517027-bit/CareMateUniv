function randomPermutation(length, random = Math.random) {
  const values = Array.from({ length }, (_, index) => index);
  for (let index = values.length - 1; index > 0; index -= 1) {
    const next = Math.floor(random() * (index + 1));
    [values[index], values[next]] = [values[next], values[index]];
  }
  return values;
}

export function stableQuestionKey(item) {
  const type = item?.type === "quiz" ? "quiz" : "fill_blank";
  const id = String(item?.id || "").trim();
  if (id) return `${type}:id:${id}`;
  // Older published units did not have IDs.  Use a deterministic content
  // fingerprint instead of the array index so that a harmless reorder does
  // not change an in-progress learner's saved session.  The next admin save
  // permanently backfills generated IDs via store.js.
  const legacySource = JSON.stringify({
    question: String(item?.question || ""),
    choices: Array.isArray(item?.choices) ? item.choices.map(String) : [],
    answers: Array.isArray(item?.answers) ? item.answers.map(String) : [String(item?.answer ?? "")],
  });
  let hash = 2166136261;
  for (let index = 0; index < legacySource.length; index += 1) {
    hash ^= legacySource.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${type}:legacy:${(hash >>> 0).toString(36)}`;
}

function validPermutation(value, length) {
  if (!Array.isArray(value) || value.length !== length) return false;
  const indexes = value.map(Number);
  return indexes.every((item) => Number.isInteger(item) && item >= 0 && item < length)
    && new Set(indexes).size === length;
}

export function createStudySession(items, random = Math.random, { shuffled = true } = {}) {
  const keys = items.map(stableQuestionKey);
  const orderIndexes = shuffled ? randomPermutation(keys.length, random) : keys.map((_, index) => index);
  const choiceOrders = {};
  items.forEach((item) => {
    if (item.type !== "quiz") return;
    const key = stableQuestionKey(item);
    const length = Array.isArray(item.choices) ? item.choices.length : 0;
    choiceOrders[key] = shuffled ? randomPermutation(length, random) : Array.from({ length }, (_, index) => index);
  });
  return {
    version: 1,
    active: true,
    position: 0,
    order: orderIndexes.map((index) => keys[index]),
    choiceOrders,
    results: {},
    startedAtMs: Date.now(),
  };
}

export function restoreStudySession(items, rawSession = {}) {
  const byKey = new Map(items.map((item) => [stableQuestionKey(item), item]));
  const savedOrder = Array.isArray(rawSession.order) ? rawSession.order.map(String) : [];
  const order = savedOrder.filter((key, index) => byKey.has(key) && savedOrder.indexOf(key) === index);
  // A question published after the attempt started is appended without
  // rearranging the saved questions. Deleted questions are simply omitted.
  items.forEach((item) => {
    const key = stableQuestionKey(item);
    if (!order.includes(key)) order.push(key);
  });
  const choiceOrders = {};
  const restored = order.map((key) => {
    const source = byKey.get(key);
    if (source.type !== "quiz") return { ...source, sessionKey: key };
    const choices = Array.isArray(source.choices) ? source.choices : [];
    const savedChoices = rawSession.choiceOrders?.[key];
    const permutation = validPermutation(savedChoices, choices.length)
      ? savedChoices.map(Number)
      : Array.from({ length: choices.length }, (_, index) => index);
    choiceOrders[key] = permutation;
    const originalCorrect = Array.isArray(source.answers) && source.answers.length
      ? source.answers.map(Number)
      : [Number(source.answer) || 0];
    const answers = permutation.flatMap((originalIndex, displayIndex) =>
      originalCorrect.includes(originalIndex) ? [displayIndex] : []);
    const displayedChoices = permutation.map((originalIndex) => choices[originalIndex]);
    return {
      ...source,
      sessionKey: key,
      choices: displayedChoices,
      answers,
      answer: answers[0] ?? 0,
      displayAnswer: answers.map((index) => displayedChoices[index]).filter(Boolean).join(" / "),
    };
  });
  const results = {};
  if (rawSession.results && !Array.isArray(rawSession.results) && typeof rawSession.results === "object") {
    order.forEach((key) => {
      if (typeof rawSession.results[key] === "boolean") results[key] = rawSession.results[key];
    });
  } else if (Array.isArray(rawSession.results)) {
    savedOrder.forEach((key, index) => {
      if (byKey.has(key) && typeof rawSession.results[index] === "boolean") results[key] = rawSession.results[index];
    });
  }
  return {
    items: restored,
    session: {
      version: 1,
      active: rawSession.active !== false,
      position: Math.max(0, Math.min(Number(rawSession.position) || 0, Math.max(0, restored.length - 1))),
      order,
      choiceOrders,
      results,
      startedAtMs: Number(rawSession.startedAtMs) || Date.now(),
    },
  };
}
