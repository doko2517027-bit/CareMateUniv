import { auth, db } from './firebase.js?v=8';
import { collection, getDocs, addDoc, setDoc, deleteDoc, doc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js';
import { uploadStudyFile } from './upload.js?v=1';

export async function renderDictionary(root, profile) {
  if (profile.studentNumber !== '2510044') throw new Error('この辞書は2510044専用です。');
  const ref = collection(db, 'studyAppUsers', auth.currentUser.uid, 'dictionary');
  const records = (await getDocs(ref)).docs.map(d => ({ id: d.id, ...d.data() }));
  const element = (tag, text, className = '') => { const e = document.createElement(tag); e.textContent = text; e.className = className; return e; };
  root.replaceChildren();
  const header = element('section', '', 'panel');
  header.append(element('h2', '自分の医療用語辞書'), element('p', '気になった言葉を、意味や画像と一緒に残せます。', 'hint'));
  const add = element('button', '＋ 単語を登録', 'primary-button');
  const search = element('input', ''); search.placeholder = '単語・意味を検索'; search.setAttribute('aria-label', '辞書を検索'); search.style.cssText = 'width:100%;box-sizing:border-box;margin-top:16px';
  header.append(add, search); root.append(header);
  const list = element('section', '', 'form-stack'); root.append(list);
  function draw() {
    list.replaceChildren();
    const q = search.value.trim().toLocaleLowerCase();
    const visible = records.filter(r => `${r.word} ${r.meaning}`.toLocaleLowerCase().includes(q)).sort((a,b) => a.word.localeCompare(b.word, 'ja'));
    if (!visible.length) list.append(element('p', q ? '一致する単語がありません。' : '「単語を登録」から最初の言葉を追加してください。', 'panel'));
    for (const record of visible) {
      const card = element('article', '', 'panel');
      card.append(element('h2', record.word));
      const meaning = element('p', record.meaning); meaning.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere'; card.append(meaning);
      if (record.imageUrl) { const image = element('img', ''); image.src = record.imageUrl; image.alt = record.word; image.loading = 'lazy'; image.style.cssText = 'max-width:100%;max-height:320px;object-fit:contain;border-radius:12px'; card.append(image); }
      const edit = element('button', '編集', 'secondary-button'); edit.onclick = () => editor(record); card.append(edit); list.append(card);
    }
  }
  function editor(record = {}) {
    root.replaceChildren();
    const form = element('form', '', 'panel form-stack'); form.append(element('h2', record.id ? '単語を編集' : '単語を登録'));
    function field(title, tag, value) { const label = element('label', title); const input = element(tag, ''); input.value = value || ''; input.required = true; input.maxLength = tag === 'input' ? 120 : 10000; if (tag === 'textarea') input.rows = 7; label.append(input); form.append(label); return input; }
    const word = field('単語', 'input', record.word); const meaning = field('意味・説明', 'textarea', record.meaning);
    const label = element('label', '画像（任意・JPEG / PNG / WebP、10MBまで）'); const file = element('input', ''); file.type = 'file'; file.accept = 'image/jpeg,image/png,image/webp'; label.append(file); form.append(label);
    let imageUrl = record.imageUrl || '';
    const preview = element('img', ''); preview.style.cssText = 'max-width:100%;max-height:240px;object-fit:contain'; preview.hidden = !imageUrl; preview.src = imageUrl; form.append(preview);
    const removeImage = element('button', '画像を外す', 'text-button'); removeImage.type = 'button'; removeImage.onclick = () => { imageUrl = ''; file.value = ''; preview.hidden = true; }; form.append(removeImage);
    const save = element('button', '保存', 'primary-button'); save.type = 'submit'; const back = element('button', '辞書へ戻る', 'secondary-button'); back.type = 'button'; back.onclick = () => renderDictionary(root, profile); const status = element('p', '', 'status'); status.setAttribute('role', 'status'); form.append(save, back, status);
    form.onsubmit = async event => { event.preventDefault(); save.disabled = back.disabled = true; status.textContent = '保存中…'; try { if (file.files[0]) imageUrl = (await uploadStudyFile(file.files[0])).secureUrl; const data = { word: word.value.trim(), meaning: meaning.value.trim(), imageUrl, updatedAt: serverTimestamp() }; if (!data.word || !data.meaning) throw new Error('単語と意味を入力してください。'); if (record.id) await setDoc(doc(ref, record.id), data); else await addDoc(ref, data); await renderDictionary(root, profile); } catch (error) { status.textContent = error.message; save.disabled = back.disabled = false; } };
    if (record.id) { const remove = element('button', 'この単語を削除', 'danger-button'); remove.type = 'button'; remove.onclick = async () => { if (!confirm('この単語を削除しますか？')) return; try { await deleteDoc(doc(ref, record.id)); await renderDictionary(root, profile); } catch(error) { status.textContent = error.message; } }; form.append(remove); }
    root.append(form);
  }
  add.onclick = () => editor(); search.oninput = draw; draw();
}
