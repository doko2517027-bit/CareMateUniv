export function addListSearch(list, label, extraText = []) {
  const rows = [...list.children].filter(row => !row.classList.contains("empty"));
  const field = document.createElement("label");
  field.className = "form-stack";
  field.textContent = `${label}を検索`;
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = "検索";
  field.append(input);
  const message = document.createElement("p");
  message.className = "empty";
  message.hidden = true;
  message.setAttribute("role", "status");
  message.textContent = "該当する項目がありません。";
  list.before(field);
  list.after(message);
  const normalize = text => String(text || "").normalize("NFKC").toLocaleLowerCase("ja");
  const index = rows.map((row, i) => normalize(`${row.textContent} ${extraText[i] || ""}`));
  input.addEventListener("input", () => {
    const terms = normalize(input.value).trim().split(/\s+/).filter(Boolean);
    rows.forEach((row, i) => { row.hidden = !terms.every(term => index[i].includes(term)); });
    message.hidden = !terms.length || rows.some(row => !row.hidden);
  });
}
