/* 바인더 대지 소분폼 — GitHub Pages용 화면 코드
 * 데이터(폼 설정·응답·이미지)는 settings.js의 구글 Apps Script 주소로 저장됩니다. */
(function () {
"use strict";

const API = (window.FORM_API_URL || "").trim();
const STEP_NAMES = ["정보 입력", "수량 선택", "유의사항 확인"];
const LS_SUB = "binderForm.submission";
const SS_TOKEN = "binderForm.adminToken";

let cfg = null, remoteMissing = false;
const st = { step: 0, answers: {}, qty: {}, agree: false, errors: {}, submitting: false, submitted: false, submitErr: "", result: null, prior: null };
const adm = { open: false, unlocked: false, err: "", busy: false, tab: "responses", editing: false, draft: null,
  rows: [], loadingRows: false, saving: false, confirmDel: null, keyMsg: "", token: "" };

/* ---------- 도우미 ---------- */
const $ = id => document.getElementById(id);
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function rid(p) { return p + Math.random().toString(36).slice(2, 8); }
function view() { return adm.editing ? adm.draft : cfg; }
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2800); }
function setPath(o, p, v) { const ks = p.split("."); let a = o; ks.slice(0, -1).forEach(k => a = a[/^\d+$/.test(k) ? +k : k]); const last = ks[ks.length - 1]; a[/^\d+$/.test(last) ? +last : last] = v; }
function fmt(n) { return Number(n || 0).toLocaleString("ko-KR"); }
function won(n) { return fmt(n) + "원"; }
const URL_RE = /https?:\/\/[^\s<>"']+[^\s<>"'.,)\]!?]/g;
function linkify(t) { return esc(t).replace(URL_RE, u => `<a class="ext" href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`); }
function linksIn(t) { return String(t || "").match(URL_RE) || []; }
function safeUrl(u) { u = String(u || ""); return /^(https:\/\/|images\/)/.test(u) ? u : ""; }
function priceOf(o) { return Number(o.price) || 0; }
function formatPhone(v) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.startsWith("02")) { if (d.length <= 2) return d; if (d.length <= 5) return d.slice(0, 2) + "-" + d.slice(2); if (d.length <= 9) return d.slice(0, 2) + "-" + d.slice(2, 5) + "-" + d.slice(5); return d.slice(0, 2) + "-" + d.slice(2, 6) + "-" + d.slice(6, 10); }
  if (d.length <= 3) return d; if (d.length <= 7) return d.slice(0, 3) + "-" + d.slice(3); if (d.length <= 10) return d.slice(0, 3) + "-" + d.slice(3, 6) + "-" + d.slice(6); return d.slice(0, 3) + "-" + d.slice(3, 7) + "-" + d.slice(7);
}
function qtyKey(p, o) { return p + "__" + o; }
function lineItems(c = cfg) { const out = []; c.products.forEach(p => p.options.forEach(o => { const q = st.qty[qtyKey(p.id, o.id)] || 0; if (q > 0) out.push({ productName: p.name, label: o.label, qty: q, sheets: q * (+o.sheets || 0), amount: q * priceOf(o) }); })); return out; }
function grandTotal(c = cfg) { return lineItems(c).reduce((s, i) => s + i.sheets, 0); }
function grandPrice(c = cfg) { return lineItems(c).reduce((s, i) => s + i.amount, 0); }
function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

/* ---------- 서버 통신 ---------- */
async function api(action, body = {}) {
  if (!API) throw { code: "no_api" };
  let res;
  try {
    res = await fetch(API, { method: "POST", body: JSON.stringify({ action, ...body }) });
  } catch (e) { throw { code: "network" }; }
  let data;
  try { data = await res.json(); } catch (e) { throw { code: "server_error" }; }
  if (!data.ok) {
    if (data.error === "unauthorized") { adm.unlocked = false; adm.token = ""; try { sessionStorage.removeItem(SS_TOKEN); } catch (e) {} }
    throw { code: data.error || "server_error", data };
  }
  return data;
}
function adminApi(action, body = {}) { return api(action, { ...body, token: adm.token }); }
function errMsg(e) {
  return ({
    no_api: "아직 서버 주소가 설정되지 않았어요. settings.js를 확인해 주세요.",
    network: "인터넷 연결을 확인하고 다시 시도해 주세요.",
    unauthorized: "관리자 로그인이 만료됐어요. 다시 키를 입력해 주세요.",
    wrong_key: "관리자 키가 맞지 않아요.",
    locked: "여러 번 틀려서 10분 동안 잠겼어요. 잠시 후 다시 시도해 주세요.",
    not_setup: "서버의 setup 함수를 아직 실행하지 않았어요.",
    no_items: "수량을 하나 이상 골라 주세요.",
    missing_answer: "필수 질문에 답해 주세요.",
    not_ready: "폼 설정이 아직 서버에 저장되지 않았어요. 관리자에게 문의해 주세요.",
    too_large: "이미지가 너무 커요. 더 작은 이미지를 골라 주세요.",
    unsupported_type: "png, jpg, gif, webp 이미지만 올릴 수 있어요.",
    short_key: "키는 8자 이상으로 정해 주세요."
  })[e && e.code] || "문제가 생겼어요. 잠시 후 다시 시도해 주세요.";
}

/* ---------- 화면 그리기 ---------- */
function render() {
  if (!cfg) return;
  const c = view(), E = adm.editing;
  let h = "";
  if (E) h += `<div class="editbar"><span>편집 중이에요. 저장하면 모든 기기에 바로 반영돼요.</span><span class="edit-row">
    <button class="btn small ghost" data-act="edit-cancel">취소</button>
    <button class="btn small" data-act="edit-save" ${adm.saving ? "disabled" : ""}>${adm.saving ? "저장 중…" : "저장"}</button></span></div>`;
  h += `<section class="sheet">`;
  const banner = safeUrl(c.banner);
  h += `<div class="banner">${banner ? `<img src="${esc(banner)}" alt="">` : `<span>${E ? "가로로 긴 배너 이미지를 넣어 주세요 (3:1 권장)" : ""}</span>`}${E ? `<button class="upl" data-upload="banner">배너 이미지 ${banner ? "바꾸기" : "넣기"}</button>` : ""}</div>`;
  h += `<div class="head">${E ? `<input type="text" id="ed-title" class="ed" data-edit="title" value="${esc(c.title)}" aria-label="제목">` : `<h1>${esc(c.title)}</h1>`}`;
  if (!st.submitted || E) h += `<ol class="steps">${STEP_NAMES.map((n, i) => `<li class="${i === st.step ? "on" : i < st.step ? "past" : ""}">${n}</li>`).join("")}</ol>`;
  h += `</div><div class="body">`;
  if (st.submitted && !E) h += renderDone();
  else if (st.step === 0) h += renderInfo(c, E);
  else if (st.step === 1) h += renderQty(c, E);
  else h += renderNotice(c, E);
  h += `</div></section>`;
  h += E ? `<textarea id="ed-footer" class="ed" data-edit="footer" aria-label="하단 문구">${esc(c.footer)}</textarea>` : `<p class="fine">${esc(c.footer)}</p>`;
  h += renderAdmin();
  $("app").innerHTML = h;
}

function renderInfo(c, E) {
  let h = "";
  c.questions.forEach((q, i) => {
    const val = st.answers[q.id] ?? "";
    h += `<div class="q">`;
    if (E) {
      h += `<div class="edit-row"><input type="text" id="ed-q${i}-l" class="ed" data-edit="questions.${i}.label" value="${esc(q.label)}" aria-label="질문 ${i + 1}" style="flex:1 1 200px">
        <select id="ed-q${i}-t" data-edit="questions.${i}.type" aria-label="답변 형식" style="width:auto">
          <option value="text" ${q.type === "text" ? "selected" : ""}>짧은 답</option><option value="long" ${q.type === "long" ? "selected" : ""}>긴 답</option><option value="tel" ${q.type === "tel" ? "selected" : ""}>전화번호</option></select></div>
        <textarea id="ed-q${i}-h" class="ed" data-edit="questions.${i}.help" aria-label="부연 설명" style="min-height:56px">${esc(q.help)}</textarea>
        <div class="edit-row mini"><label><input type="checkbox" data-edit-bool="questions.${i}.required" ${q.required ? "checked" : ""}> 필수 질문</label>
        <button class="link" data-act="q-up" data-i="${i}" ${i === 0 ? "disabled" : ""}>위로</button><button class="link" data-act="q-del" data-i="${i}">질문 삭제</button></div>`;
    } else {
      h += `<label for="a-${esc(q.id)}">${esc(q.label)}${q.required ? '<span class="req" aria-label="필수">*</span>' : ""}</label>`;
      if (q.help) h += `<p class="help">${linkify(q.help)}</p>`;
      if (q.type === "long") h += `<textarea id="a-${esc(q.id)}" data-ans="${esc(q.id)}">${esc(val)}</textarea>`;
      else if (q.type === "tel") h += `<input type="tel" id="a-${esc(q.id)}" data-ans="${esc(q.id)}" data-tel inputmode="numeric" autocomplete="tel" placeholder="010-0000-0000" value="${esc(val)}">`;
      else h += `<input type="text" id="a-${esc(q.id)}" data-ans="${esc(q.id)}" value="${esc(val)}">`;
      if (st.errors[q.id]) h += `<p class="err">${esc(st.errors[q.id])}</p>`;
    }
    h += `</div>`;
  });
  if (E) h += `<button class="btn ghost small" data-act="q-add" style="align-self:flex-start">+ 질문 추가</button>`;
  h += `<div class="nav"><span></span><button class="btn" data-act="next">다음</button></div>`;
  return h;
}

function renderQty(c, E) {
  let h = "";
  if (!E) {
    h += `<section class="price-guide" aria-label="가격 안내"><h3>가격 안내</h3><ul>`;
    const seen = new Set();
    c.products.forEach(p => p.options.forEach(o => { const key = o.label + "|" + priceOf(o); if (seen.has(key)) return; seen.add(key); h += `<li><span>${esc(o.label)}</span><b>${won(priceOf(o))}</b></li>`; }));
    h += `</ul><p class="help">배송비는 별도예요.</p></section>`;
  }
  c.products.forEach((p, pi) => {
    const full = safeUrl(p.image), small = safeUrl(p.thumb) || full;
    h += `<article class="prod"><div class="prod-head">`;
    if (small) {
      h += E ? `<div class="pimg"><img src="${esc(small)}" alt="" loading="lazy"><button class="upl" data-upload="products.${pi}">사진</button></div>`
             : `<button class="pimg zoom" data-act="zoom" data-src="${esc(full || small)}" data-alt="${esc(p.name)}" aria-label="${esc(p.name)} 사진 크게 보기"><img src="${esc(small)}" alt="${esc(p.name)}" loading="lazy"></button>`;
    } else {
      h += `<div class="thumb">대지<br>이미지${E ? `<button class="upl" data-upload="products.${pi}">사진</button>` : ""}</div>`;
    }
    h += E ? `<div style="flex:1;min-width:0"><input type="text" id="ed-p${pi}" class="ed" data-edit="products.${pi}.name" value="${esc(p.name)}" aria-label="대지 이름">
        <div class="edit-row mini" style="margin-top:6px"><button class="link" data-act="o-add" data-p="${pi}">+ 옵션 추가</button><button class="link" data-act="p-up" data-p="${pi}" ${pi === 0 ? "disabled" : ""}>위로</button><button class="link" data-act="p-del" data-p="${pi}">이 대지 삭제</button></div></div>`
      : `<h3>${esc(p.name)}</h3>`;
    h += `</div>`;
    p.options.forEach((o, oi) => {
      const k = qtyKey(p.id, o.id), q = st.qty[k] || 0;
      h += `<div class="opt"><div class="opt-main">`;
      if (E) {
        h += `<div class="edit-row"><input type="text" id="ed-p${pi}o${oi}l" class="ed" data-edit="products.${pi}.options.${oi}.label" value="${esc(o.label)}" aria-label="옵션 이름" style="flex:1 1 140px">
          <label class="mini" style="display:flex;align-items:center;gap:6px">1세트 =<input type="number" min="1" id="ed-p${pi}o${oi}s" class="ed" data-edit-num="products.${pi}.options.${oi}.sheets" value="${esc(o.sheets)}" style="width:80px;margin:0">장</label>
          <label class="mini" style="display:flex;align-items:center;gap:6px">가격<input type="number" min="0" step="100" id="ed-p${pi}o${oi}p" class="ed" data-edit-price="products.${pi}.options.${oi}.price" value="${esc(priceOf(o))}" style="width:96px;margin:0">원</label></div>
          <button class="link" data-act="o-del" data-p="${pi}" data-o="${oi}" style="align-self:flex-start">옵션 삭제</button>`;
      } else {
        h += `<div class="opt-name">${esc(o.label)}</div><div class="opt-sub">1세트 = ${fmt(o.sheets)}장 · ${won(priceOf(o))}</div>
        <div class="opt-row"><div class="stepper" role="group" aria-label="${esc(o.label)} 수량">
          <button data-act="minus" data-k="${esc(k)}" aria-label="하나 빼기" ${q <= 0 ? "disabled" : ""}>−</button>
          <output id="q-${esc(k)}">${q}</output>
          <button data-act="plus" data-k="${esc(k)}" aria-label="하나 더하기">+</button></div>
          <span class="sheets">총 <b id="s-${esc(k)}">${fmt(q * (+o.sheets || 0))}</b>장 · <span id="m-${esc(k)}">${won(q * priceOf(o))}</span></span></div>`;
      }
      h += `</div></div>`;
    });
    if (!E) {
      const sub = p.options.reduce((s, o) => s + (st.qty[qtyKey(p.id, o.id)] || 0) * (+o.sheets || 0), 0);
      const subP = p.options.reduce((s, o) => s + (st.qty[qtyKey(p.id, o.id)] || 0) * priceOf(o), 0);
      h += `<div class="prod-foot"><span>이 대지 합계&nbsp;<b id="ps-${esc(p.id)}">${fmt(sub)}</b>장 · <b id="pp-${esc(p.id)}">${won(subP)}</b></span></div>`;
    }
    h += `</article>`;
  });
  if (E) h += `<button class="btn ghost small" data-act="p-add" style="align-self:flex-start">+ 대지 종류 추가</button>`;
  else h += `<div class="total-wrap"><div class="total"><span>합계 <span id="grand">${fmt(grandTotal(c))}</span>장</span><span class="amt"><span>총액</span><strong id="grand-p">${won(grandPrice(c))}</strong></span></div><p class="help" style="text-align:right">배송비 별도</p></div>`;
  if (st.errors.qty) h += `<p class="err">${esc(st.errors.qty)}</p>`;
  h += `<div class="nav"><button class="btn ghost" data-act="prev">이전</button><button class="btn" data-act="next">다음</button></div>`;
  return h;
}

function renderNotice(c, E) {
  let h = `<div class="q"><label>유의사항</label></div>`;
  const ni = safeUrl(c.noticeImage);
  if (ni || E) h += `<div class="notice-img ${ni ? "" : "empty"}">${ni ? `<img src="${esc(ni)}" alt="유의사항 이미지">` : "유의사항 이미지를 넣을 수 있어요"}${E ? `<button class="upl" data-upload="noticeImage">이미지 ${ni ? "바꾸기" : "넣기"}</button>` : ""}</div>`;
  if (E && ni) h += `<button class="link" data-act="clear-notice-img" style="align-self:flex-start">이미지 빼기</button>`;
  h += E ? `<textarea id="ed-notice" class="ed" data-edit="noticeText" aria-label="유의사항 내용" style="min-height:150px">${esc(c.noticeText)}</textarea>` : `<p class="notice-text">${linkify(c.noticeText)}</p>`;
  if (!E) {
    h += `<div class="q"><label>신청 내용 확인</label></div>${summaryHtml(c)}`;
    h += `<label class="agree"><input type="checkbox" id="agree" ${st.agree ? "checked" : ""}> 유의사항을 모두 읽었고 동의합니다.</label>`;
    if (st.prior) h += `<p class="banner-msg">이 기기에서 이미 제출한 신청(번호 <span class="prior-id">${esc(st.prior.id)}</span>)이 있어요. 다시 제출하면 이전 신청이 새 내용으로 바뀌어요.</p>`;
    if (st.submitErr) h += `<p class="err">${esc(st.submitErr)}</p>`;
  }
  h += `<div class="nav"><button class="btn ghost" data-act="prev">이전</button>${E ? "" : `<button class="btn" data-act="submit" ${(!st.agree || st.submitting) ? "disabled" : ""}>${st.submitting ? "제출 중…" : "제출하기"}</button>`}</div>`;
  return h;
}

function summaryHtml(c) {
  let h = `<dl class="summary">`;
  c.questions.forEach(q => { h += `<dt>${esc(q.label)}</dt><dd>${esc(st.answers[q.id] || "-")}</dd>`; });
  const items = lineItems(c);
  h += `<dt>신청 수량</dt><dd>${items.length ? items.map(i => `${esc(i.productName)} · ${esc(i.label)} ${i.qty}개 (${fmt(i.sheets)}장 · ${won(i.amount)})`).join("\n") : "-"}</dd>`;
  h += `<dt>합계</dt><dd>${fmt(grandTotal(c))}장</dd><dt>총액</dt><dd><b>${won(grandPrice(c))}</b> (배송비 별도)</dd></dl>`;
  return h;
}

function renderDone() {
  const r = st.result || {};
  return `<div class="done"><h2>${r.updated ? "신청 내용을 바꿨어요" : "신청이 접수됐어요"}</h2>
    <p class="help" style="text-align:center">제출 번호 <span class="prior-id">${esc(r.id || "")}</span> · 수정이 필요하면 이 기기에서 다시 작성해 제출하면 돼요.</p>
    ${linksIn(cfg.noticeText).map(u => `<a class="btn" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${/open\.kakao\.com/.test(u) ? "오픈채팅으로 연락하기" : "링크 열기"}</a><span class="help" style="user-select:all;overflow-wrap:anywhere">${esc(u)}</span>`).join("")}</div>
    ${summaryHtml(cfg)}
    <div class="nav"><span></span><button class="btn ghost" data-act="restart">신청 내용 수정하기</button></div>`;
}

/* ---------- 관리자 화면 ---------- */
function renderAdmin() {
  if (!adm.open) return `<div class="admin-entry"><button class="link" data-act="adm-open">관리자</button></div>`;
  let h = `<section class="sheet panel" id="admin-panel" aria-label="관리자">`;
  if (!adm.unlocked) {
    h += `<h2>관리자 키 입력</h2>
      <p class="help">관리자 키를 입력하면 응답 확인과 폼 편집을 할 수 있어요.</p>
      <input type="password" id="k1" autocomplete="current-password" placeholder="관리자 키">
      ${adm.err ? `<p class="err">${esc(adm.err)}</p>` : ""}
      <div class="nav"><button class="btn ghost small" data-act="adm-close">닫기</button><button class="btn small" data-act="key-check" ${adm.busy ? "disabled" : ""}>${adm.busy ? "확인 중…" : "열기"}</button></div>`;
  } else {
    h += `<h2>관리자</h2>${remoteMissing && !adm.editing ? `<p class="banner-msg">서버에 폼 설정이 아직 저장되지 않아 참여자가 제출할 수 없어요. 아래 '폼 편집하기'를 누른 뒤 맨 위 '저장'을 한 번 눌러 주세요.</p>` : ""}${adm.editing ? `<p class="banner-msg">편집 중이에요. 폼에서 바로 고치고 맨 위 막대에서 저장하세요.</p>` : `<button class="btn" data-act="edit-start" style="align-self:flex-start">폼 편집하기</button>`}<div class="tabs">
      <button data-act="tab" data-tab="responses" aria-pressed="${adm.tab === "responses"}">응답 보기 (${adm.rows.length})</button>
      <button data-act="tab" data-tab="key" aria-pressed="${adm.tab === "key"}">관리자 키 변경</button>
      <button data-act="adm-lock">로그아웃</button></div>`;
    if (adm.tab === "responses") h += renderResponses();
    else h += `<p class="help">새 키를 정하면 기존 키는 더 이상 쓸 수 없고, 다른 기기의 관리자 로그인도 풀려요.</p>
      <input type="password" id="k1" autocomplete="new-password" placeholder="새 관리자 키 (8자 이상)"><input type="password" id="k2" autocomplete="new-password" placeholder="한 번 더 입력">
      ${adm.err ? `<p class="err">${esc(adm.err)}</p>` : ""}${adm.keyMsg ? `<p class="help" style="color:var(--ok)">${esc(adm.keyMsg)}</p>` : ""}
      <div class="nav"><span></span><button class="btn small" data-act="key-set" ${adm.busy ? "disabled" : ""}>새 키 저장</button></div>`;
  }
  return h + `</section>`;
}
function optionTotals() {
  const m = new Map();
  adm.rows.forEach(o => (o.items || []).forEach(i => { const k = i.productName + " · " + i.label; const r = m.get(k) || { sets: 0, sheets: 0 }; r.sets += i.qty; r.sheets += i.sheets; m.set(k, r); }));
  return m;
}
function renderResponses() {
  const os = adm.rows, total = os.reduce((s, o) => s + (o.totalSheets || 0), 0), totalP = os.reduce((s, o) => s + (o.totalPrice || 0), 0), m = optionTotals();
  let h = `<div class="edit-row"><button class="btn small ghost" data-act="refresh" ${adm.loadingRows ? "disabled" : ""}>${adm.loadingRows ? "불러오는 중…" : "새로고침"}</button><span class="subnote">응답은 연결된 구글 시트의 '응답' 탭에서도 볼 수 있어요.</span></div>`;
  h += `<div class="stats"><div class="stat"><div class="k">참여자</div><div class="v">${fmt(os.length)}명</div></div><div class="stat"><div class="k">총 신청 장수</div><div class="v">${fmt(total)}장</div></div><div class="stat"><div class="k">총 금액 (배송비 제외)</div><div class="v">${won(totalP)}</div></div>`;
  m.forEach((r, k) => { h += `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${fmt(r.sets)}세트</div><div class="mini">${fmt(r.sheets)}장</div></div>`; });
  h += `</div>`;
  if (!os.length) return h + `<p class="help">${adm.loadingRows ? "응답을 불러오는 중이에요." : "아직 들어온 응답이 없어요."}</p>`;
  const qs = collectQuestionCols();
  h += `<div class="tbl-wrap"><table><thead><tr><th>번호</th><th>제출 시각</th>${qs.map(q => `<th>${esc(q.label)}</th>`).join("")}<th>신청 내역</th><th>총 장수</th><th>금액</th><th></th></tr></thead><tbody>`;
  os.forEach(o => {
    h += `<tr><td>${esc(o.id)}</td><td>${esc(o.submittedText || "")}</td>
      ${qs.map(q => `<td>${esc(o.answers?.[q.id] ?? "")}</td>`).join("")}
      <td>${esc((o.items || []).map(i => `${i.productName} · ${i.label} ×${i.qty}`).join("\n"))}</td>
      <td class="num">${fmt(o.totalSheets)}</td><td class="num">${won(o.totalPrice)}</td>
      <td>${adm.confirmDel === o.id ? `<button class="link" style="color:var(--danger)" data-act="del-yes" data-id="${esc(o.id)}">삭제 확인</button><button class="link" data-act="del-no">취소</button>` : `<button class="link" data-act="del" data-id="${esc(o.id)}">삭제</button>`}</td></tr>`;
  });
  h += `</tbody></table></div><div class="edit-row"><button class="btn small" data-act="csv-dl">엑셀용 CSV 받기</button><button class="btn small ghost" data-act="csv-copy">표 복사하기</button></div>`;
  return h;
}
function collectQuestionCols() {
  const cols = cfg.questions.map(q => ({ id: q.id, label: q.label })); const seen = new Set(cols.map(c => c.id));
  adm.rows.forEach(o => (o.questions || []).forEach(q => { if (!seen.has(q.id)) { seen.add(q.id); cols.push(q); } }));
  return cols;
}
function buildCsv(sep) {
  const qs = collectQuestionCols();
  const cell = v => { v = String(v ?? ""); return sep === "," ? `"${v.replace(/"/g, '""')}"` : v.replace(/[\t\n]/g, " "); };
  const rows = [["번호", "제출 시각", ...qs.map(q => q.label), "신청 내역", "총 장수", "금액"]];
  adm.rows.forEach(o => rows.push([o.id, o.submittedText, ...qs.map(q => o.answers?.[q.id] ?? ""), (o.items || []).map(i => `${i.productName} ${i.label} x${i.qty}`).join(" / "), o.totalSheets, o.totalPrice]));
  return rows.map(r => r.map(cell).join(sep)).join("\n");
}
async function loadRows() {
  adm.loadingRows = true; render();
  try { const r = await adminApi("responses"); adm.rows = r.rows || []; }
  catch (e) { toast(errMsg(e)); }
  adm.loadingRows = false; render();
}

/* ---------- 입력 처리 ---------- */
const app = $("app");
app.addEventListener("input", e => {
  const t = e.target;
  if (t.dataset.ans) {
    if (t.hasAttribute("data-tel")) { const atEnd = t.selectionStart === t.value.length; t.value = formatPhone(t.value); if (atEnd) t.selectionStart = t.selectionEnd = t.value.length; }
    st.answers[t.dataset.ans] = t.value;
    if (st.errors[t.dataset.ans]) { delete st.errors[t.dataset.ans]; const er = t.parentElement.querySelector(".err"); if (er) er.remove(); }
  }
  if (t.dataset.edit) setPath(adm.draft, t.dataset.edit, t.value);
  if (t.dataset.editNum) setPath(adm.draft, t.dataset.editNum, Math.max(1, parseInt(t.value) || 1));
  if (t.dataset.editPrice) setPath(adm.draft, t.dataset.editPrice, Math.max(0, parseInt(t.value) || 0));
});
app.addEventListener("change", e => {
  const t = e.target;
  if (t.id === "agree") { st.agree = t.checked; render(); return; }
  if (t.dataset.editBool) setPath(adm.draft, t.dataset.editBool, t.checked);
  if (t.tagName === "SELECT" && t.dataset.edit) setPath(adm.draft, t.dataset.edit, t.value);
});
app.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.id === "k1" && !adm.unlocked) { e.preventDefault(); act("key-check", e.target); }
});
app.addEventListener("click", e => {
  const b = e.target.closest("[data-act],[data-upload]"); if (!b) return;
  if (b.dataset.upload) { pickImage(b.dataset.upload); return; }
  act(b.dataset.act, b);
});

function validateInfo() {
  st.errors = {};
  cfg.questions.forEach(q => {
    const v = (st.answers[q.id] || "").trim();
    if (q.required && !v) st.errors[q.id] = `${q.label.replace(/[.?!]$/, "")} — 꼭 입력해 주세요.`;
    else if (q.type === "tel" && v && !/^0\d{1,2}-?\d{3,4}-?\d{4}$/.test(v)) st.errors[q.id] = "전화번호 형식을 확인해 주세요. 예: 010-1234-5678";
  });
  return !Object.keys(st.errors).length;
}
function bumpQty(k, d) {
  st.qty[k] = Math.max(0, Math.min(999, (st.qty[k] || 0) + d)); delete st.errors.qty;
  const [pid, oid] = k.split("__"); const p = cfg.products.find(x => x.id === pid); const o = p && p.options.find(x => x.id === oid); if (!o) return;
  $("q-" + k).textContent = st.qty[k];
  $("s-" + k).textContent = fmt(st.qty[k] * (+o.sheets || 0));
  $("m-" + k).textContent = won(st.qty[k] * priceOf(o));
  document.querySelector(`[data-act="minus"][data-k="${CSS.escape(k)}"]`).disabled = st.qty[k] <= 0;
  $("ps-" + pid).textContent = fmt(p.options.reduce((s, x) => s + (st.qty[qtyKey(pid, x.id)] || 0) * (+x.sheets || 0), 0));
  $("pp-" + pid).textContent = won(p.options.reduce((s, x) => s + (st.qty[qtyKey(pid, x.id)] || 0) * priceOf(x), 0));
  $("grand").textContent = fmt(grandTotal());
  $("grand-p").textContent = won(grandPrice());
  const er = app.querySelector(".body > .err"); if (er) er.remove();
}

async function act(a, b) {
  const D = adm.draft;
  switch (a) {
    case "next":
      if (adm.editing) { st.step = Math.min(2, st.step + 1); break; }
      if (st.step === 0 && !validateInfo()) { render(); app.querySelector(".err")?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
      if (st.step === 1 && grandTotal() <= 0) { st.errors.qty = "수량을 하나 이상 골라 주세요."; render(); return; }
      st.step++; break;
    case "prev": st.step = Math.max(0, st.step - 1); break;
    case "zoom": openLb(b.dataset.src, b.dataset.alt, b); return;
    case "plus": bumpQty(b.dataset.k, 1); return;
    case "minus": bumpQty(b.dataset.k, -1); return;
    case "submit": await submit(); return;
    case "restart": st.submitted = false; st.step = 0; st.agree = false; break;
    /* 편집 */
    case "q-add": D.questions.push({ id: rid("q"), type: "text", label: "새 질문", help: "", required: false }); break;
    case "q-del": D.questions.splice(+b.dataset.i, 1); break;
    case "q-up": { const i = +b.dataset.i; [D.questions[i - 1], D.questions[i]] = [D.questions[i], D.questions[i - 1]]; break; }
    case "p-add": D.products.push({ id: rid("p"), name: "새 바인더 대지", image: null, thumb: null, options: [{ id: rid("o"), label: "10장 세트", sheets: 10, price: 700 }, { id: rid("o"), label: "50장 세트", sheets: 50, price: 3000 }] }); break;
    case "p-up": { const i = +b.dataset.p; [D.products[i - 1], D.products[i]] = [D.products[i], D.products[i - 1]]; break; }
    case "p-del": D.products.splice(+b.dataset.p, 1); break;
    case "o-add": D.products[+b.dataset.p].options.push({ id: rid("o"), label: "새 옵션", sheets: 10, price: 0 }); break;
    case "o-del": D.products[+b.dataset.p].options.splice(+b.dataset.o, 1); break;
    case "clear-notice-img": D.noticeImage = null; break;
    case "edit-start": if (!adm.editing) { adm.draft = clone(cfg); adm.editing = true; st.submitted = false; window.scrollTo({ top: 0, behavior: "smooth" }); } break;
    case "edit-cancel": adm.editing = false; adm.draft = null; break;
    case "edit-save": await saveCfg(); return;
    /* 관리자 */
    case "adm-open": adm.open = true; adm.err = ""; render(); $("k1")?.focus(); $("admin-panel")?.scrollIntoView({ behavior: "smooth" }); return;
    case "adm-close": adm.open = false; break;
    case "adm-lock": adm.unlocked = false; adm.open = false; adm.editing = false; adm.draft = null; adm.rows = []; adm.token = ""; try { sessionStorage.removeItem(SS_TOKEN); } catch (e) {} break;
    case "tab": adm.tab = b.dataset.tab; adm.err = ""; adm.keyMsg = ""; break;
    case "refresh": await loadRows(); return;
    case "key-set": await setKey(); return;
    case "key-check": await checkKey(); return;
    case "del": adm.confirmDel = b.dataset.id; break;
    case "del-no": adm.confirmDel = null; break;
    case "del-yes":
      try { await adminApi("deleteResponse", { id: b.dataset.id }); adm.rows = adm.rows.filter(r => r.id !== b.dataset.id); toast("응답을 삭제했어요"); }
      catch (e) { toast(errMsg(e)); }
      adm.confirmDel = null; break;
    case "csv-dl": {
      const blob = new Blob(["﻿" + buildCsv(",")], { type: "text/csv;charset=utf-8" });
      const a2 = document.createElement("a"); a2.href = URL.createObjectURL(blob);
      a2.download = "바인더대지_소분_응답_" + new Date().toISOString().slice(0, 10) + ".csv";
      document.body.appendChild(a2); a2.click(); a2.remove(); setTimeout(() => URL.revokeObjectURL(a2.href), 2000);
      return;
    }
    case "csv-copy": {
      const txt = buildCsv("\t");
      try { await navigator.clipboard.writeText(txt); toast("표를 복사했어요. 엑셀이나 시트에 붙여 넣으세요."); }
      catch (e) { const ta = document.createElement("textarea"); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); toast("표를 복사했어요"); } catch (_) { toast("복사하지 못했어요"); } ta.remove(); }
      return;
    }
  }
  render();
  if (a === "next" || a === "prev" || a === "restart") document.querySelector(".steps")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function submit() {
  st.submitErr = ""; st.submitting = true; render();
  const qty = {}; Object.keys(st.qty).forEach(k => { if (st.qty[k] > 0) qty[k] = st.qty[k]; });
  try {
    const r = await api("submit", { answers: st.answers, qty, editId: st.prior?.id, editKey: st.prior?.editKey });
    st.result = r; st.submitted = true;
    st.prior = { id: r.id, editKey: r.editKey };
    lsSet(LS_SUB, { id: r.id, editKey: r.editKey, answers: st.answers, qty: st.qty });
  } catch (e) { st.submitErr = errMsg(e); }
  st.submitting = false; render(); window.scrollTo({ top: 0, behavior: "smooth" });
}

async function saveCfg() {
  const d = adm.draft;
  if (!d.questions.length) return toast("질문이 하나 이상 있어야 해요");
  if (!d.products.length || d.products.some(p => !p.options.length)) return toast("대지마다 옵션이 하나 이상 있어야 해요");
  adm.saving = true; render();
  try { await adminApi("saveConfig", { config: d }); cfg = clone(d); remoteMissing = false; adm.editing = false; adm.draft = null; toast("저장했어요. 모든 기기에 반영돼요."); }
  catch (e) { toast(errMsg(e)); }
  adm.saving = false; render();
}

async function checkKey() {
  const k = $("k1").value; adm.err = "";
  if (!k) { adm.err = "관리자 키를 입력해 주세요."; render(); return; }
  adm.busy = true; render();
  try {
    const r = await api("login", { key: k });
    adm.token = r.token; adm.unlocked = true;
    try { sessionStorage.setItem(SS_TOKEN, r.token); } catch (e) {}
    adm.busy = false; await loadRows(); return;
  } catch (e) { adm.err = errMsg(e); }
  adm.busy = false; render();
}
async function setKey() {
  const k1 = $("k1").value, k2 = $("k2").value; adm.err = ""; adm.keyMsg = "";
  if (k1.length < 8) { adm.err = "키는 8자 이상으로 정해 주세요."; render(); return; }
  if (k1 !== k2) { adm.err = "두 번 입력한 키가 서로 달라요."; render(); return; }
  adm.busy = true; render();
  try { const r = await adminApi("changeKey", { newKey: k1 }); adm.token = r.token; try { sessionStorage.setItem(SS_TOKEN, r.token); } catch (e) {} adm.keyMsg = "새 관리자 키를 저장했어요."; }
  catch (e) { adm.err = errMsg(e); }
  adm.busy = false; render();
}

/* ---------- 이미지 올리기 (최대 2000px로 줄여서 올립니다) ---------- */
let pickTarget = null;
function pickImage(path) { pickTarget = path; const f = $("filePick"); f.value = ""; f.click(); }
function shrink(file, max = 2000) {
  return new Promise((resolve, reject) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.88).split(",")[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject({ code: "unsupported_type" }); };
    img.src = url;
  });
}
$("filePick").addEventListener("change", async e => {
  const file = e.target.files[0]; if (!file || !pickTarget) return;
  toast("이미지를 올리는 중이에요…");
  try {
    const data = await shrink(file);
    const r = await adminApi("upload", { data, mime: "image/jpeg", name: file.name.replace(/\.\w+$/, "") + ".jpg" });
    if (pickTarget.startsWith("products.")) { const p = adm.draft.products[+pickTarget.split(".")[1]]; p.image = r.image; p.thumb = r.thumb; }
    else setPath(adm.draft, pickTarget, r.image);
    render(); toast("이미지를 넣었어요. 저장을 눌러야 반영돼요.");
  } catch (err) { toast(errMsg(err)); }
});

/* ---------- 사진 크게 보기 ---------- */
let lbReturn = null;
const lb = $("lb");
function openLb(src, alt, from) { lbReturn = from; const i = $("lb-img"); i.src = src; i.alt = alt || ""; $("lb-cap").textContent = alt || ""; lb.hidden = false; document.body.style.overflow = "hidden"; $("lb-x").focus(); }
function closeLb() { if (lb.hidden) return; lb.hidden = true; document.body.style.overflow = ""; lbReturn?.focus?.(); }
lb.addEventListener("click", closeLb);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeLb(); });

/* ---------- 시작 ---------- */
async function boot() {
  const local = fetch("config.json", { cache: "no-cache" }).then(r => r.json()).catch(() => null);
  let remote = null;
  if (API) {
    try { const r = await fetch(API + "?action=config", { cache: "no-store" }); const d = await r.json(); remote = d.config || null; }
    catch (e) { console.warn("서버 설정을 불러오지 못해 기본 설정을 씁니다.", e); }
  } else {
    console.warn("settings.js에 FORM_API_URL이 비어 있어요.");
  }
  remoteMissing = !!API && !remote;
  cfg = remote || await local;
  if (!cfg) { $("app").innerHTML = `<div class="sheet loading">폼을 불러오지 못했어요. 새로고침해 주세요.</div>`; return; }
  const prior = lsGet(LS_SUB);
  if (prior && prior.id) { st.prior = { id: prior.id, editKey: prior.editKey }; if (prior.answers) st.answers = { ...prior.answers }; if (prior.qty) st.qty = { ...prior.qty }; }
  try { const t = sessionStorage.getItem(SS_TOKEN); if (t && Number(t.split(".")[0]) > Date.now()) { adm.token = t; adm.unlocked = true; adm.open = true; } } catch (e) {}
  render();
  if (!API) toast("아직 서버가 연결되지 않아 제출이 되지 않아요.");
  if (adm.unlocked) loadRows();
}
boot();
})();
