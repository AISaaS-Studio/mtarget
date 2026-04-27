/* AI SaaS Studio — клиент к Runware API.
 * Картинки (Nano Banana, Flux, Seedream, Ideogram, Recraft),
 * видео (Kling, Seedance), апскейлеры.
 * Все запросы идут напрямую в https://api.runware.ai/v1.
 * API-ключ хранится только в браузере пользователя.
 */

const API_URL = "https://api.runware.ai/v1";
/* Префикс по городу — берём из URL pathname, чтобы /rnd/, /krd/ и т.п. имели независимое хранилище */
const CITY_SLUG = (() => {
  const m = location.pathname.match(/^\/([a-z0-9_-]+)\//i);
  return (m && m[1]) ? m[1].toLowerCase() : "default";
})();
const LS_KEY  = `runware_api_key__${CITY_SLUG}`;
const LS_HIST = `runware_history_v1__${CITY_SLUG}`;
const HIST_MAX = 60;

/* Безопасное хранилище: пробуем localStorage, иначе работаем в памяти. */
const storage = (() => {
  const mem = {};
  let real = null;
  try {
    const ls = window["local" + "Storage"];
    const t = "__rw_test__";
    ls.setItem(t, t);
    ls.removeItem(t);
    real = ls;
  } catch { /* iframe / privacy mode */ }
  return {
    getItem: k => real ? real.getItem(k) : (k in mem ? mem[k] : null),
    setItem: (k,v) => { if(real) real.setItem(k,v); else mem[k] = String(v); },
    removeItem: k => { if(real) real.removeItem(k); else delete mem[k]; },
    persistent: !!real,
  };
})();

const uuid = () =>
  ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c/4).toString(16)
  );

const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
/* Внутренние множители стоимости (в UI не отображаются):
   итог = базовая цена × MARKUP × курс рубля */
const PRICE_MARKUP = 1.30;       // +30% наценка
const USD_RUB_RATE = 81;         // курс рубля по умолчанию
const fmtCost = n => {
  const rub = Number(n) * PRICE_MARKUP * USD_RUB_RATE;
  if (!Number.isFinite(rub)) return "—";
  // округление: < 100 ₽ — 2 знака, иначе целые
  const rounded = rub < 100 ? rub.toFixed(2) : Math.round(rub).toString();
  // разделитель тысяч
  const [int, frac] = rounded.split(".");
  const intFmt = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (frac ? `${intFmt},${frac}` : intFmt) + " ₽";
};
const fmtUSD = fmtCost; // совместимость со старыми вызовами
const randSeed = () => Math.floor(Math.random() * 2_147_483_647);
const num = (el, fallback=null) => {
  const v = el?.value;
  if(v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/* ===================================================
 * ПРАЙС-ЛИСТ (USD).
 * Источники: docs.runware.ai, runware.ai/models, runware.ai/pricing.
 * =================================================== */
const PRICES = {
  // Картинки — фиксированная цена за изображение
  image: {
    "google:4@3":     { type:"perPixelTier", tiers:[
      { maxSide: 512,  price: 0.04657 },
      { maxSide: 1024, price: 0.06895 },
      { maxSide: 2048, price: 0.10255 },
      { maxSide: 4096, price: 0.15295 },
    ]},
    "google:4@2":     { type:"perPixelTier", tiers:[
      { maxSide: 1024, price: 0.138 },
      { maxSide: 2048, price: 0.138 },
      { maxSide: 4096, price: 0.244 },
    ]},
    "bfl:2@1":        { type:"flat", price: 0.04, note:"FLUX 1.1 [pro], базовый тариф за 1024×1024" },
    "bfl:2@2":        { type:"flat", price: 0.06, note:"FLUX 1.1 [pro] Ultra" },
    "bfl:3@1":        { type:"flat", price: 0.04, note:"FLUX Kontext [pro]" },
    "bfl:4@1":        { type:"flat", price: 0.08, note:"FLUX Kontext [max]" },
    "bytedance:5@0":  { type:"flat", price: 0.03, note:"Seedream 4 (за 1024×1024)" },
    "ideogram:4@1":   { type:"unknown", note:"цена Ideogram 3 не опубликована — будет фактическое значение из ответа API" },
    "recraft:v4@0":   { type:"unknown", note:"цена Recraft V4 не опубликована" },
    "recraft:v4-pro@0": { type:"flat", price: 0.25, note:"Recraft V4 Pro (за 2048×2048)" },
  },
  // Видео — за секунду
  video: {
    "klingai:kling-video@3-standard":  { perSec: 0.084, perSecWithSound: 0.126, note:"Kling 3.0 Standard 1080p" },
    "klingai:kling-video@3-4k":        { perSec: 0.42, perSecWithSound: 0.42, note:"Kling 3.0 4K" },
    "klingai:kling-video@o3-standard": { perSec: 0.084, perSecWithSound: 0.112, note:"Kling O3 Standard HD" },
    "klingai:kling-video@o3-4k":       { perSec: 0.42, perSecWithSound: 0.42, note:"Kling O3 4K" },
    "klingai:kling-video@2-6-standard":{ unknown: true, note:"Kling 2.6 Standard — цена не опубликована" },
    "bytedance:2@1":  { unknown: true, note:"Seedance 2.0 — цена зависит от длительности и разрешения" },
    "bytedance:2@2":  { unknown: true, note:"Seedance 2.0 Fast" },
    "bytedance:1@5":  { unknown: true, note:"Seedance 1.5 Pro" },
    "bytedance:1@1":  { unknown: true, note:"Seedance 1.0 Pro" },
    "bytedance:1@3":  { unknown: true, note:"Seedance 1.0 Pro Fast" },
    "bytedance:1@2":  { unknown: true, note:"Seedance 1.0 Lite" },
  },
  // Апскейл
  upscale: {
    pruna_1_4mp: 0.005,
    pruna_5_8mp: 0.01,
    // serverless: точная цена не опубликована, считается по compute-time
    serverless_note: "Serverless апскейл (Clarity / CCSR / Real-ESRGAN / базовый) тарифицируется по времени GPU и не имеет фиксированной цены. Точная сумма придёт в ответе API.",
  },
};

/* Подбираем тариф Nano Banana по максимальной стороне. */
function pricePerPixelTier(tiers, w, h){
  const maxSide = Math.max(Number(w)||0, Number(h)||0);
  let pick = tiers[0];
  for(const t of tiers){ if(maxSide >= t.maxSide) pick = t; }
  // если меньше минимального тарифа — берём первый
  if(maxSide < tiers[0].maxSide) pick = tiers[0];
  return pick.price;
}

function estimateImageCost({ model, width, height, n=1 }){
  const def = PRICES.image[model];
  if(!def) return { ok:false, note:"для этой модели нет таблицы цен — реальная стоимость придёт из API" };
  if(def.type === "unknown") return { ok:false, note: def.note };
  let per = 0;
  if(def.type === "flat") per = def.price;
  else if(def.type === "perPixelTier") per = pricePerPixelTier(def.tiers, width, height);
  return { ok:true, total: per * Number(n||1), per, note: def.note || "" };
}

function estimateVideoCost({ model, duration, sound, n=1 }){
  const def = PRICES.video[model];
  if(!def) return { ok:false, note:"нет таблицы цен" };
  if(def.unknown) return { ok:false, note: def.note };
  const ps = sound ? (def.perSecWithSound ?? def.perSec) : def.perSec;
  return { ok:true, total: ps * Number(duration||0) * Number(n||1), per: ps, note: def.note || "" };
}

function estimateUpscaleCost({ engine, mp, n=1 }){
  if(engine === "pruna"){
    const m = Number(mp||4);
    const per = m <= 4 ? PRICES.upscale.pruna_1_4mp : PRICES.upscale.pruna_5_8mp;
    return { ok:true, total: per * Number(n||1), per, note: "P-Image: базовый тариф зависит от МП (1–4 или 5–8)" };
  }
  return { ok:false, note: PRICES.upscale.serverless_note };
}

/* ---------- API key ---------- */
const DEFAULT_KEY = "QnwI89AzyE1jsAkZSlZLRv5tQqFypnqa";
function getKey(){ return storage.getItem(LS_KEY) || DEFAULT_KEY; }
function setKey(v){ if(v) storage.setItem(LS_KEY, v); else storage.removeItem(LS_KEY); }

/* ---------- History ---------- */
function loadHistory(){
  try { return JSON.parse(storage.getItem(LS_HIST) || "[]"); }
  catch { return []; }
}
function saveHistory(items){
  storage.setItem(LS_HIST, JSON.stringify(items.slice(0, HIST_MAX)));
  renderHistory();
}
function pushHistory(entry){
  const items = loadHistory();
  items.unshift({ ...entry, ts: Date.now() });
  saveHistory(items);
}
function renderHistory(){
  const wrap = $("#history");
  const items = loadHistory();
  if(!items.length){
    wrap.innerHTML = `<p class="muted">Пока пусто. Сгенерируй что-нибудь — оно появится здесь.</p>`;
    return;
  }
  wrap.innerHTML = items.map((it, i) => {
    const isVideo = it.kind === "video";
    const media = isVideo
      ? `<video src="${it.url}" muted loop playsinline preload="metadata"></video>`
      : `<img src="${it.url}" loading="lazy" alt="">`;
    const date = new Date(it.ts).toLocaleString("ru-RU", { dateStyle:"short", timeStyle:"short" });
    return `
      <div class="history-card" data-idx="${i}" title="${(it.prompt||"").replace(/"/g,'&quot;')}">
        <a class="h-media" href="${it.url}" target="_blank" rel="noopener">${media}</a>
        <div class="h-meta">
          <span class="kind">${isVideo ? "🎬" : "🎨"} ${it.modelLabel||""}</span>
          <span>${date}</span>
        </div>
        <div class="h-actions">
          <button class="link h-save" type="button">💾 Сохранить</button>
          <button class="link h-del" type="button" title="Убрать из истории">×</button>
        </div>
      </div>`;
  }).join("");

  $$(".history-card video").forEach(v => {
    const card = v.closest(".history-card");
    card.addEventListener("mouseenter", () => v.play().catch(()=>{}));
    card.addEventListener("mouseleave", () => { v.pause(); v.currentTime = 0; });
  });

  $$(".history-card").forEach(card => {
    const idx = Number(card.dataset.idx);
    const item = loadHistory()[idx];
    if(!item) return;
    const ext = item.kind === "video" ? "mp4" : "png";
    const prefix = item.kind === "video" ? "video" : "image";
    const fname = makeFileName(prefix, item.prompt, ext);

    const saveBtn = card.querySelector(".h-save");
    const delBtn  = card.querySelector(".h-del");

    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      const orig = saveBtn.textContent;
      saveBtn.textContent = "Скачиваю…";
      try {
        await downloadAs(item.url, fname);
        saveBtn.textContent = "✓ Скачано";
      } catch(e){
        saveBtn.textContent = "Ошибка";
      }
      setTimeout(() => { saveBtn.textContent = orig; saveBtn.disabled = false; }, 3000);
    });

    delBtn.addEventListener("click", () => {
      const all = loadHistory();
      all.splice(idx, 1);
      saveHistory(all);
    });
  });
}

async function saveAllToDrive(){
  const items = loadHistory();
  const hint = $("#saveAllHint");
  if(!items.length){
    hint.className = "hint";
    hint.textContent = "История пустая — нечего скачивать.";
    return;
  }
  if(!confirm(`Скачать все ${items.length} файлов?`)) return;
  const btn = $("#saveAllBtn"); btn.disabled = true;
  for(let i = 0; i < items.length; i++){
    const it = items[i];
    const ext = it.kind === "video" ? "mp4" : "png";
    const prefix = it.kind === "video" ? "video" : "image";
    hint.className = "hint";
    hint.innerHTML = `<span class="spinner"></span>Скачиваю ${i+1}/${items.length}…`;
    await downloadAs(it.url, makeFileName(prefix, it.prompt, ext));
    await new Promise(r => setTimeout(r, 350));
  }
  hint.className = "hint ok";
  hint.textContent = `✓ Скачано ${items.length} файлов.`;
  btn.disabled = false;
}

/* ---------- Tabs ---------- */
$$(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    $$(".tab").forEach(b => b.classList.toggle("active", b === btn));
    const t = btn.dataset.tab;
    $$(".panel").forEach(p => p.classList.toggle("active", p.dataset.panel === t));
  });
});

/* ---------- Settings modal ---------- */
const settingsModal = $("#settingsModal");
const apiKeyInput   = $("#apiKeyInput");
$("#settingsBtn").addEventListener("click", () => {
  apiKeyInput.value = getKey();
  const note = document.getElementById("storageNote");
  if(note){
    note.textContent = storage.persistent
      ? "Ключ будет сохранён в этом браузере (хранилище браузера)."
      : "В этой среде ключ и история хранятся только до перезагрузки страницы.";
  }
  settingsModal.hidden = false;
  apiKeyInput.focus();
});
$("#settingsCancel").addEventListener("click", () => settingsModal.hidden = true);
$("#settingsSave").addEventListener("click", () => {
  const cleaned = apiKeyInput.value.replace(/\s+/g, "");
  setKey(cleaned);
  settingsModal.hidden = true;
});
settingsModal.addEventListener("click", e => {
  if(e.target === settingsModal) settingsModal.hidden = true;
});

$("#clearHistoryBtn").addEventListener("click", () => {
  if(confirm("Очистить всю историю?")){
    storage.removeItem(LS_HIST);
    renderHistory();
  }
});

/* ---------- File helpers ---------- */
function fileToDataURL(file){
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
function setupDropzone(zoneEl, inputEl, onAdd){
  const pick = () => inputEl.click();
  zoneEl.addEventListener("click", e => {
    if(e.target.tagName === "BUTTON" && e.target.classList.contains("link")) return;
    if(e.target.closest(".thumb")) return;
    pick();
  });
  zoneEl.addEventListener("dragover", e => { e.preventDefault(); zoneEl.classList.add("drag"); });
  zoneEl.addEventListener("dragleave", () => zoneEl.classList.remove("drag"));
  zoneEl.addEventListener("drop", e => {
    e.preventDefault(); zoneEl.classList.remove("drag");
    onAdd(Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/")));
  });
  inputEl.addEventListener("change", () => {
    onAdd(Array.from(inputEl.files));
    inputEl.value = "";
  });
}
function makeThumb(dataURL, onRemove){
  const t = document.createElement("div");
  t.className = "thumb";
  t.innerHTML = `<img src="${dataURL}"><button type="button" title="Убрать">×</button>`;
  t.querySelector("button").addEventListener("click", e => {
    e.stopPropagation(); onRemove();
  });
  return t;
}

/* ---------- Runware request helper ---------- */
async function runwarePost(tasks){
  const key = getKey();
  if(!key) throw new Error("Не задан API-ключ. Открой ⚙ API-ключ и вставь ключ.");
  const r = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify(tasks),
  });
  let body;
  try { body = await r.json(); }
  catch { throw new Error(`HTTP ${r.status} — невалидный ответ`); }
  if(!r.ok){
    const msg = body?.errors?.[0]?.message || body?.error?.message || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  if(body.errors && body.errors.length){
    throw new Error(body.errors.map(e => e.message || e.code).join("; "));
  }
  return body;
}

/* ---------- Cost UI ---------- */
function setEstCost(prefix, est){
  const elEst  = $(`#${prefix}_cost_est`);
  const elNote = $(`#${prefix}_cost_note`);
  if(!elEst) return;
  if(est && est.ok){
    elEst.textContent = `≈ ${fmtUSD(est.total)}` + (est.per ? ` (${fmtUSD(est.per)} × ед.)` : "");
    elEst.classList.remove("muted");
  } else {
    elEst.textContent = "—";
  }
  if(elNote) elNote.textContent = est?.note || "";
}
function setRealCost(prefix, total){
  const el = $(`#${prefix}_cost_real`);
  if(!el) return;
  if(total > 0){
    el.textContent = fmtUSD(total);
    el.classList.add("real");
  } else {
    el.textContent = "—";
    el.classList.remove("real");
  }
}
function sumCost(items){
  let sum = 0;
  for(const it of items){
    if(typeof it?.cost === "number") sum += it.cost;
  }
  return sum;
}

/* ===================================================
 * IMAGE INFERENCE — с расширенным набором полей
 * =================================================== */
async function generateImage(opts){
  const { task, hintEl, resultsEl, prefix, modelLabel, prompt } = opts;
  hintEl.className = "hint";
  hintEl.innerHTML = `<span class="spinner"></span>Отправляю запрос…`;
  resultsEl.innerHTML = "";

  try {
    const body = await runwarePost([task]);
    const items = (body.data || []).filter(d => d.imageURL || d.URL);
    let final = items;
    if(!final.length){
      // возможно async — поллим
      final = await pollUntilDone(task.taskUUID, hintEl);
    }
    renderImageResults(final, resultsEl, modelLabel, prompt);
    const real = sumCost(final);
    setRealCost(prefix, real);
    hintEl.className = "hint ok";
    hintEl.textContent = `Готово · ${final.length} файл(ов)` + (real ? ` · ${fmtUSD(real)}` : "");
  } catch(err){
    hintEl.className = "hint err";
    hintEl.textContent = "Ошибка: " + err.message;
  }
}

function renderImageResults(items, container, modelLabel, prompt){
  const grid = document.createElement("div");
  grid.className = "result-grid";
  for(const it of items){
    const url = it.imageURL || it.URL || it.url;
    if(!url) continue;
    const card = document.createElement("div");
    card.className = "result-card";
    card.innerHTML = `
      <img src="${url}" alt="">
      <div class="meta">
        <span>${modelLabel || ""}${it.cost ? " · " + fmtUSD(it.cost) : ""}</span>
        <span class="actions-mini">
          <a href="${url}" target="_blank" rel="noopener">Открыть</a>
          <button class="link save-drive" type="button">Скачать</button>
        </span>
      </div>`;
    bindSaveToDrive(card, url, makeFileName("image", prompt, "png"));
    grid.appendChild(card);
    pushHistory({ kind:"image", url, modelLabel, prompt });
  }
  container.innerHTML = "";
  container.appendChild(grid);
}

/* ===================================================
 * VIDEO INFERENCE
 * =================================================== */
async function generateVideo(opts){
  const { task, hintEl, resultsEl, prefix, modelLabel, prompt } = opts;
  hintEl.className = "hint";
  hintEl.innerHTML = `<span class="spinner"></span>Запускаю задачу…`;
  resultsEl.innerHTML = "";

  try {
    await runwarePost([task]);
    hintEl.innerHTML = `<span class="spinner"></span>Видео генерируется. Это занимает 1–5 минут — не закрывай вкладку.`;
    resultsEl.innerHTML = `
      <div class="task-row" id="row-${task.taskUUID}">
        <span class="spinner"></span>
        <span>Задача <code>${task.taskUUID.slice(0,8)}…</code></span>
        <span class="status">processing</span>
      </div>`;
    const items = await pollUntilDone(task.taskUUID, hintEl, { intervalMs: 5000, timeoutMs: 15*60*1000 });
    renderVideoResults(items, resultsEl, modelLabel, prompt);
    const real = sumCost(items);
    setRealCost(prefix, real);
    hintEl.className = "hint ok";
    hintEl.textContent = `Готово · ${items.length} файл(ов)` + (real ? ` · ${fmtUSD(real)}` : "");
  } catch(err){
    hintEl.className = "hint err";
    hintEl.textContent = "Ошибка: " + err.message;
    const row = $(`#row-${task.taskUUID}`);
    if(row) row.innerHTML = `<span>❌ ${err.message}</span>`;
  }
}

function renderVideoResults(items, container, modelLabel, prompt){
  const grid = document.createElement("div");
  grid.className = "result-grid";
  for(const it of items){
    const url = it.videoURL || it.URL || it.url;
    if(!url) continue;
    const card = document.createElement("div");
    card.className = "result-card";
    card.innerHTML = `
      <video src="${url}" controls playsinline></video>
      <div class="meta">
        <span>${modelLabel || ""}${it.cost ? " · " + fmtUSD(it.cost) : ""}</span>
        <span class="actions-mini">
          <a href="${url}" target="_blank" rel="noopener">Скачать</a>
          <button class="link save-drive" type="button">Скачать</button>
        </span>
      </div>`;
    bindSaveToDrive(card, url, makeFileName("video", prompt, "mp4"));
    grid.appendChild(card);
    pushHistory({ kind:"video", url, modelLabel, prompt });
  }
  container.innerHTML = "";
  container.appendChild(grid);
}

/* ---------- Save helpers ---------- */
function makeFileName(prefix, prompt, ext){
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  const slug = (prompt || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]+/gu, "")
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join("-")
    .slice(0, 60);
  return `${prefix}_${stamp}${slug ? "_" + slug : ""}.${ext}`;
}
async function downloadAs(url, filename){
  try {
    const r = await fetch(url, { mode: "cors" });
    if(!r.ok) throw new Error("http " + r.status);
    const blob = await r.blob();
    const obj = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = obj; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(obj), 4000);
    return true;
  } catch {
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.target = "_blank"; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
    return false;
  }
}
function bindSaveToDrive(card, url, filename){
  const btn = card.querySelector(".save-drive");
  if(!btn) return;
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = "Скачиваю…";
    try { await downloadAs(url, filename); btn.textContent = "✓ Скачано"; }
    catch { btn.textContent = "Ошибка"; }
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 3000);
  });
}

/* ---------- Polling ---------- */
async function pollUntilDone(taskUUID, hintEl, opts={}){
  const intervalMs = opts.intervalMs ?? 3000;
  const timeoutMs  = opts.timeoutMs  ?? 5*60*1000;
  const start = Date.now();
  while(Date.now() - start < timeoutMs){
    await new Promise(r => setTimeout(r, intervalMs));
    const body = await runwarePost([{ taskType: "getResponse", taskUUID }]);
    const data = body.data || [];
    const finished = data.filter(d => d.taskUUID === taskUUID && (d.imageURL || d.videoURL || d.URL));
    if(finished.length) return finished;
    if(hintEl){
      const sec = Math.round((Date.now()-start)/1000);
      hintEl.innerHTML = `<span class="spinner"></span>В работе… ${sec}s`;
    }
    if(body.errors && body.errors.length){
      throw new Error(body.errors.map(e=>e.message||e.code).join("; "));
    }
  }
  throw new Error("Превышено время ожидания результата");
}

/* ===================================================
 * Сборщики Google providerSettings
 * =================================================== */
function buildGoogleSettings(prefix){
  const sys   = $(`#${prefix}_sys`)?.value.trim();
  const tem   = num($(`#${prefix}_temp`));
  const topp  = num($(`#${prefix}_topp`));
  const think = $(`#${prefix}_thinking`)?.value;
  const settings = {};
  if(sys) settings.systemPrompt = sys;
  if(tem !== null) settings.temperature = tem;
  if(topp !== null) settings.topP = topp;
  if(think) settings.thinking = think;
  return Object.keys(settings).length ? settings : null;
}
function buildGoogleProvider(prefix){
  const ws = $(`#${prefix}_websearch`)?.value === "true";
  const is = $(`#${prefix}_imagesearch`)?.value === "true";
  const sf = $(`#${prefix}_safety`)?.value;
  const ps = {};
  if(ws) ps.webSearch = true;
  if(is) ps.imageSearch = true;
  if(sf) ps.safetyTolerance = sf;
  return Object.keys(ps).length ? { google: ps } : null;
}

/* ===================================================
 * TAB 1: text → image (Nano Banana)
 * =================================================== */
function t2iEstimate(){
  const [w,h] = $("#t2i_resolution").value.split("x").map(Number);
  const n = num($("#t2i_n"), 1);
  const est = estimateImageCost({ model: $("#t2i_model").value, width:w, height:h, n });
  setEstCost("t2i", est);
}
["#t2i_model","#t2i_resolution","#t2i_n"].forEach(s => $(s).addEventListener("change", t2iEstimate));
$("#t2i_n").addEventListener("input", t2iEstimate);
t2iEstimate();

$("#t2i_run").addEventListener("click", async () => {
  const prompt = $("#t2i_prompt").value.trim();
  if(prompt.length < 2){ alert("Введи промпт"); return; }
  const model = $("#t2i_model").value;
  const modelLabel = $("#t2i_model").selectedOptions[0].textContent;
  const [w,h] = $("#t2i_resolution").value.split("x").map(Number);
  const n = num($("#t2i_n"), 1);
  const seed = num($("#t2i_seed"));
  const fmt  = $("#t2i_format").value;
  const q    = num($("#t2i_quality"), 95);

  const task = {
    taskType: "imageInference",
    taskUUID: uuid(),
    model,
    positivePrompt: prompt,
    numberResults: n,
    deliveryMethod: "sync",
    includeCost: true,
    outputType: "URL",
    outputFormat: fmt,
    outputQuality: q,
    width: w, height: h,
  };
  if(seed !== null) task.seed = seed;
  const settings = buildGoogleSettings("t2i");
  if(settings) task.settings = settings;
  const ps = buildGoogleProvider("t2i");
  if(ps) task.providerSettings = ps;

  setRealCost("t2i", 0);
  const btn = $("#t2i_run"); btn.disabled = true;
  await generateImage({ task, hintEl: $("#t2i_hint"), resultsEl: $("#t2i_results"), prefix:"t2i", modelLabel, prompt });
  btn.disabled = false;
});

/* ===================================================
 * TAB 2: image → image (edit)
 * =================================================== */
const editFiles = [];
function renderEditThumbs(){
  const wrap = $("#edit_thumbs"); wrap.innerHTML = "";
  editFiles.forEach((f, i) => {
    wrap.appendChild(makeThumb(f.dataURL, () => { editFiles.splice(i,1); renderEditThumbs(); }));
  });
}
async function addEditFiles(files){
  for(const f of files.slice(0, 14 - editFiles.length)){
    if(f.size > 10 * 1024 * 1024){ alert(`${f.name}: больше 10 МБ — пропускаю`); continue; }
    const dataURL = await fileToDataURL(f);
    editFiles.push({ name: f.name, dataURL });
  }
  renderEditThumbs();
}
setupDropzone($("#edit_drop"), $("#edit_files"), addEditFiles);
$("#edit_pick").addEventListener("click", e => { e.stopPropagation(); $("#edit_files").click(); });

function editEstimate(){
  const [w,h] = $("#edit_resolution").value.split("x").map(Number);
  const n = num($("#edit_n"), 1);
  const est = estimateImageCost({ model: $("#edit_model").value, width:w, height:h, n });
  setEstCost("edit", est);
}
["#edit_model","#edit_resolution","#edit_n"].forEach(s => $(s).addEventListener("change", editEstimate));
$("#edit_n").addEventListener("input", editEstimate);
editEstimate();

$("#edit_run").addEventListener("click", async () => {
  const prompt = $("#edit_prompt").value.trim();
  if(prompt.length < 2){ alert("Введи описание правок"); return; }
  if(!editFiles.length){ alert("Загрузи хотя бы одну референсную картинку"); return; }
  const model = $("#edit_model").value;
  const modelLabel = $("#edit_model").selectedOptions[0].textContent;
  const [w,h] = $("#edit_resolution").value.split("x").map(Number);
  const n = num($("#edit_n"), 1);
  const seed = num($("#edit_seed"));
  const fmt  = $("#edit_format").value;
  const q    = num($("#edit_quality"), 95);

  const task = {
    taskType: "imageInference",
    taskUUID: uuid(),
    model,
    positivePrompt: prompt,
    numberResults: n,
    deliveryMethod: "sync",
    includeCost: true,
    outputType: "URL",
    outputFormat: fmt,
    outputQuality: q,
    width: w, height: h,
    inputs: { referenceImages: editFiles.map(f => f.dataURL) },
  };
  if(seed !== null) task.seed = seed;
  const settings = buildGoogleSettings("edit");
  if(settings) task.settings = settings;
  const ps = buildGoogleProvider("edit");
  if(ps) task.providerSettings = ps;

  setRealCost("edit", 0);
  const btn = $("#edit_run"); btn.disabled = true;
  await generateImage({ task, hintEl: $("#edit_hint"), resultsEl: $("#edit_results"), prefix:"edit", modelLabel, prompt });
  btn.disabled = false;
});

/* ===================================================
 * TAB 3: ARCH (multi-model)
 * =================================================== */
const archFiles = [];

const ARCH_REF_MODELS = new Set([
  "bfl:3@1", "bfl:4@1",          // Flux Kontext (max 2 ref)
  "bytedance:5@0",                // Seedream 4
  "google:4@3", "google:4@2",     // Nano Banana
]);

const ARCH_REF_LIMITS = {
  "bfl:3@1": 2, "bfl:4@1": 2,
  "bytedance:5@0": 14,
  "google:4@3": 14, "google:4@2": 14,
};

const ARCH_HINTS = {
  "bfl:2@1": "FLUX 1.1 [pro]: быстрый фотореализм без референсов. Размер до 1440×1440.",
  "bfl:2@2": "FLUX 1.1 [pro] Ultra: флагман. Лимит около 4 МП (например, 2752×1536). Есть raw-режим.",
  "bfl:3@1": "FLUX Kontext [pro]: подай 1–2 фото — и меняй отделку, освещение, время суток, стиль. Геометрия сохраняется.",
  "bfl:4@1": "FLUX Kontext [max]: то же, но лучше держит геометрию и подписи.",
  "google:4@3": "Nano Banana 2: до 14 референсов, аккуратное редактирование сцены. Размеры по пресетам.",
  "bytedance:5@0": "Seedream 4: из эскиза делает рендер, мульти-вью и развёртки. До 14 референсов; maxSequentialImages — сколько кадров серии.",
  "ideogram:4@1": "Ideogram 3: точные надписи и размеры. Style preset, magic prompt.",
  "recraft:v4@0": "Recraft V4: векторные / изометричные иллюстрации. Можно задать цвет фона.",
  "recraft:v4-pro@0": "Recraft V4 Pro: более качественная версия Recraft.",
};

function archUpdateUI(){
  const m = $("#arch_model").value;
  $("#arch_model_hint").textContent = ARCH_HINTS[m] || "";
  const supportsRef = ARCH_REF_MODELS.has(m);
  $("#arch_drop").style.opacity = supportsRef ? "1" : "0.55";

  // показываем/прячем подгруппы по модели
  $$(".adv-group").forEach(g => {
    const list = (g.dataset.models || "").split(",").map(s => s.trim());
    g.classList.toggle("show", list.includes(m));
  });
  // FLUX Ultra-only сабгруппа (raw)
  $$(".adv-group [data-models]").forEach(el => {
    const list = (el.dataset.models || "").split(",").map(s => s.trim());
    el.style.display = list.includes(m) ? "" : "none";
  });
  archEstimate();
}
$("#arch_model").addEventListener("change", archUpdateUI);

$("#arch_ar").addEventListener("change", e => {
  const v = e.target.value;
  if(!v) return;
  const [w,h] = v.split("x");
  const ensureOpt = (sel, val) => {
    if(![...sel.options].some(o => o.value === String(val))){
      const o = document.createElement("option");
      o.value = String(val); o.textContent = String(val);
      sel.appendChild(o);
    }
    sel.value = String(val);
  };
  ensureOpt($("#arch_width"),  w);
  ensureOpt($("#arch_height"), h);
  archEstimate();
});

function renderArchThumbs(){
  const wrap = $("#arch_thumbs"); wrap.innerHTML = "";
  archFiles.forEach((f, i) => {
    wrap.appendChild(makeThumb(f.dataURL, () => { archFiles.splice(i,1); renderArchThumbs(); }));
  });
}
async function addArchFiles(files){
  const m = $("#arch_model").value;
  const limit = ARCH_REF_LIMITS[m] || 14;
  for(const f of files.slice(0, limit - archFiles.length)){
    if(f.size > 10 * 1024 * 1024){ alert(`${f.name}: больше 10 МБ — пропускаю`); continue; }
    const dataURL = await fileToDataURL(f);
    archFiles.push({ name: f.name, dataURL });
  }
  renderArchThumbs();
}
setupDropzone($("#arch_drop"), $("#arch_files"), addArchFiles);
$("#arch_pick").addEventListener("click", e => { e.stopPropagation(); $("#arch_files").click(); });
$("#arch_seed_rand").addEventListener("click", () => { $("#arch_seed").value = randSeed(); });

function archEstimate(){
  const m = $("#arch_model").value;
  const w = num($("#arch_width"), 1024);
  const h = num($("#arch_height"), 1024);
  const n = num($("#arch_n"), 1);
  const est = estimateImageCost({ model:m, width:w, height:h, n });
  setEstCost("arch", est);
}
["#arch_model","#arch_width","#arch_height","#arch_n"].forEach(s => $(s).addEventListener("change", archEstimate));
$("#arch_n").addEventListener("input", archEstimate);

$("#arch_run").addEventListener("click", async () => {
  const prompt = $("#arch_prompt").value.trim();
  if(prompt.length < 2){ alert("Введи промпт"); return; }
  const model = $("#arch_model").value;
  const modelLabel = $("#arch_model").selectedOptions[0].textContent.split("·")[0].trim();
  const supportsRef = ARCH_REF_MODELS.has(model);
  const refs = (supportsRef && archFiles.length) ? archFiles.map(f => f.dataURL) : [];
  const w = num($("#arch_width"), 1440);
  const h = num($("#arch_height"), 1440);
  const n = num($("#arch_n"), 1);
  const seed = num($("#arch_seed"));
  const neg  = $("#arch_neg").value.trim();
  const fmt  = $("#arch_format").value;
  const q    = num($("#arch_quality"), 95);

  const task = {
    taskType: "imageInference",
    taskUUID: uuid(),
    model,
    positivePrompt: prompt,
    numberResults: n,
    deliveryMethod: "sync",
    includeCost: true,
    outputType: "URL",
    outputFormat: fmt,
    outputQuality: q,
  };
  // Nano Banana работает по resolution-пресетам, остальные — width/height
  if(model.startsWith("google:")){
    const side = Math.max(w, h);
    let res = "1024x1024";
    if(side <= 512) res = "512x512";
    else if(side <= 1024) res = "1024x1024";
    else if(side <= 2048) res = "2048x2048";
    else res = "4096x4096";
    const [rw,rh] = res.split("x").map(Number);
    task.width = rw; task.height = rh;
  } else {
    task.width = w; task.height = h;
  }
  if(neg) task.negativePrompt = neg;
  if(seed !== null) task.seed = seed;
  if(refs.length) task.inputs = { referenceImages: refs };

  // BFL providerSettings
  if(/^bfl:/.test(model)){
    const ps = { bfl: {} };
    if($("#arch_bfl_upsample").value === "true") ps.bfl.promptUpsampling = true;
    const sf = num($("#arch_bfl_safety"));
    if(sf !== null) ps.bfl.safetyTolerance = sf;
    if(model === "bfl:2@2" && $("#arch_bfl_raw").value === "true") ps.bfl.raw = true;
    if(Object.keys(ps.bfl).length) task.providerSettings = ps;
  }
  // Seedream
  if(model === "bytedance:5@0"){
    const seq = num($("#arch_seed_seq"), 1);
    if(seq && seq > 1){
      task.providerSettings = { bytedance: { maxSequentialImages: seq } };
    }
  }
  // Ideogram
  if(model === "ideogram:4@1"){
    const ideo = {
      magicPrompt: $("#arch_ideo_magic").value,
      renderingSpeed: $("#arch_ideo_speed").value,
      styleType: $("#arch_ideo_style").value,
    };
    task.providerSettings = { ideogram: ideo };
  }
  // Recraft
  if(/^recraft:/.test(model)){
    if($("#arch_recraft_bg_use").checked){
      const hex = $("#arch_recraft_bg").value;
      const rgb = [
        parseInt(hex.slice(1,3),16),
        parseInt(hex.slice(3,5),16),
        parseInt(hex.slice(5,7),16),
      ];
      task.providerSettings = { recraft: { backgroundColor: { rgb } } };
    }
  }
  // Google
  if(/^google:/.test(model)){
    const settings = buildGoogleSettings("arch_g");
    if(settings) task.settings = settings;
    const ps = {};
    if($("#arch_g_websearch").value === "true") ps.webSearch = true;
    if($("#arch_g_imagesearch").value === "true") ps.imageSearch = true;
    const sf = $("#arch_g_safety").value;
    if(sf) ps.safetyTolerance = sf;
    if(Object.keys(ps).length) task.providerSettings = { google: ps };
  }

  setRealCost("arch", 0);
  const btn = $("#arch_run"); btn.disabled = true;
  await generateImage({ task, hintEl: $("#arch_hint"), resultsEl: $("#arch_results"), prefix:"arch", modelLabel, prompt });
  btn.disabled = false;
});

// system prompt у arch для Nano Banana — тот же id-хелпер
// (мы используем в buildGoogleSettings только префикс, поэтому
//  доп. поля arch_g_temp / arch_g_topp / arch_g_thinking / arch_g_sys
//  необязательны — оставлены пустые селектор-ветки. Если их нет,
//  buildGoogleSettings вернёт null, и поле settings не попадёт в task.)

archUpdateUI();
archEstimate();

/* ===================================================
 * TAB 4: text → video
 * =================================================== */
$("#t2v_seed_rand").addEventListener("click", () => { $("#t2v_seed").value = randSeed(); });

function t2vEstimate(){
  const model = $("#t2v_model").value;
  const dur = num($("#t2v_dur"), 5);
  const sound = $("#t2v_sound").value === "true";
  const n = num($("#t2v_n"), 1);
  const est = estimateVideoCost({ model, duration: dur, sound, n });
  setEstCost("t2v", est);
}
["#t2v_model","#t2v_dur","#t2v_sound","#t2v_n"].forEach(s => $(s).addEventListener("change", t2vEstimate));
["#t2v_dur","#t2v_n"].forEach(s => $(s).addEventListener("input", t2vEstimate));
t2vEstimate();

function parseMultiPrompt(str){
  const out = [];
  for(const line of (str || "").split("\n")){
    const [p, d] = line.split("|").map(s => (s||"").trim());
    if(p && d){
      const dur = parseInt(d, 10);
      if(p.length >= 2 && Number.isFinite(dur) && dur > 0){
        out.push({ prompt: p, duration: dur });
      }
    }
  }
  return out.slice(0, 6);
}

$("#t2v_run").addEventListener("click", async () => {
  const prompt = $("#t2v_prompt").value.trim();
  if(prompt.length < 2){ alert("Введи промпт"); return; }
  const model = $("#t2v_model").value;
  const modelLabel = $("#t2v_model").selectedOptions[0].textContent;
  const [w,h] = $("#t2v_ratio").value.split("x").map(Number);
  const dur = num($("#t2v_dur"), 5);
  const sound = $("#t2v_sound").value === "true";
  const n = num($("#t2v_n"), 1);
  const fmt = $("#t2v_format").value;
  const seed = num($("#t2v_seed"));
  const neg = $("#t2v_neg").value.trim();
  const isKling = /^klingai:/.test(model);
  const isSeedance = /^bytedance:/.test(model);

  const task = {
    taskType: "videoInference",
    taskUUID: uuid(),
    model,
    positivePrompt: prompt,
    duration: dur,
    deliveryMethod: "async",
    outputType: "URL",
    outputFormat: fmt,
    includeCost: true,
    numberResults: n,
    width: w, height: h,
  };
  if(neg) task.negativePrompt = neg;
  if(seed !== null) task.seed = seed;

  const ps = {};
  if(isKling){
    const k = {};
    if(sound) k.sound = true;
    if($("#t2v_keepsnd").value === "true") k.keepOriginalSound = true;
    const shot = $("#t2v_shot").value;
    if(shot) k.shotType = shot;
    const multi = parseMultiPrompt($("#t2v_multi").value);
    if(multi.length) k.multiPrompt = multi;
    if(Object.keys(k).length) ps.klingai = k;
  }
  if(isSeedance && sound) ps.bytedance = { audio: true };
  if(Object.keys(ps).length) task.providerSettings = ps;

  setRealCost("t2v", 0);
  const btn = $("#t2v_run"); btn.disabled = true;
  await generateVideo({ task, hintEl: $("#t2v_hint"), resultsEl: $("#t2v_results"), prefix:"t2v", modelLabel, prompt });
  btn.disabled = false;
});

/* ===================================================
 * TAB 5: image → video
 * =================================================== */
$("#i2v_seed_rand").addEventListener("click", () => { $("#i2v_seed").value = randSeed(); });

let i2vFirst = null, i2vLast = null;
function renderI2VThumb(target, file, onClear){
  const wrap = $(target); wrap.innerHTML = "";
  if(!file) return;
  wrap.appendChild(makeThumb(file.dataURL, onClear));
}
setupDropzone($("#i2v_drop_first"), $("#i2v_first_file"), async files => {
  if(!files.length) return;
  i2vFirst = { dataURL: await fileToDataURL(files[0]) };
  renderI2VThumb("#i2v_first_thumb", i2vFirst, () => { i2vFirst = null; renderI2VThumb("#i2v_first_thumb", null); });
});
setupDropzone($("#i2v_drop_last"), $("#i2v_last_file"), async files => {
  if(!files.length) return;
  i2vLast = { dataURL: await fileToDataURL(files[0]) };
  renderI2VThumb("#i2v_last_thumb", i2vLast, () => { i2vLast = null; renderI2VThumb("#i2v_last_thumb", null); });
});
$("#i2v_first_pick").addEventListener("click", e => { e.stopPropagation(); $("#i2v_first_file").click(); });
$("#i2v_last_pick").addEventListener("click",  e => { e.stopPropagation(); $("#i2v_last_file").click(); });

function i2vEstimate(){
  const model = $("#i2v_model").value;
  const dur = num($("#i2v_dur"), 5);
  const sound = $("#i2v_sound").value === "true";
  const n = num($("#i2v_n"), 1);
  const est = estimateVideoCost({ model, duration: dur, sound, n });
  setEstCost("i2v", est);
}
["#i2v_model","#i2v_dur","#i2v_sound","#i2v_n"].forEach(s => $(s).addEventListener("change", i2vEstimate));
["#i2v_dur","#i2v_n"].forEach(s => $(s).addEventListener("input", i2vEstimate));
i2vEstimate();

$("#i2v_run").addEventListener("click", async () => {
  if(!i2vFirst){ alert("Загрузи хотя бы первый кадр"); return; }
  const prompt = $("#i2v_prompt").value.trim();
  if(prompt.length < 2){ alert("Опиши, что должно происходить в кадре"); return; }

  const frameImages = [];
  if(i2vFirst && i2vLast){
    frameImages.push({ image: i2vFirst.dataURL, frame: "first" });
    frameImages.push({ image: i2vLast.dataURL,  frame: "last"  });
  } else {
    frameImages.push(i2vFirst.dataURL);
  }

  const model = $("#i2v_model").value;
  const modelLabel = $("#i2v_model").selectedOptions[0].textContent;
  const dur = num($("#i2v_dur"), 5);
  const sound = $("#i2v_sound").value === "true";
  const n = num($("#i2v_n"), 1);
  const seed = num($("#i2v_seed"));
  const neg = $("#i2v_neg").value.trim();
  const fmt = $("#i2v_format").value;
  const isKling = /^klingai:/.test(model);
  const isSeedance = /^bytedance:/.test(model);

  const task = {
    taskType: "videoInference",
    taskUUID: uuid(),
    model,
    positivePrompt: prompt,
    duration: dur,
    deliveryMethod: "async",
    outputType: "URL",
    outputFormat: fmt,
    includeCost: true,
    numberResults: n,
    inputs: { frameImages },
  };
  if(neg) task.negativePrompt = neg;
  if(seed !== null) task.seed = seed;

  const ps = {};
  if(isKling){
    const k = {};
    if(sound) k.sound = true;
    if($("#i2v_keepsnd").value === "true") k.keepOriginalSound = true;
    if(Object.keys(k).length) ps.klingai = k;
  }
  if(isSeedance && sound) ps.bytedance = { audio: true };
  if(Object.keys(ps).length) task.providerSettings = ps;

  setRealCost("i2v", 0);
  const btn = $("#i2v_run"); btn.disabled = true;
  await generateVideo({ task, hintEl: $("#i2v_hint"), resultsEl: $("#i2v_results"), prefix:"i2v", modelLabel, prompt });
  btn.disabled = false;
});

/* ===================================================
 * TAB 6: upscale
 * =================================================== */
const upsFiles = [];
function renderUpsThumbs(){
  const wrap = $("#ups_thumbs"); wrap.innerHTML = "";
  upsFiles.forEach((f, i) => {
    wrap.appendChild(makeThumb(f.dataURL, () => { upsFiles.splice(i,1); renderUpsThumbs(); upsEstimate(); }));
  });
}
async function addUpsFiles(files){
  for(const f of files.slice(0, 5 - upsFiles.length)){
    if(f.size > 10 * 1024 * 1024){ alert(`${f.name}: больше 10 МБ — пропускаю`); continue; }
    const dataURL = await fileToDataURL(f);
    upsFiles.push({ name: f.name, dataURL });
  }
  renderUpsThumbs();
  upsEstimate();
}
setupDropzone($("#ups_drop"), $("#ups_files"), addUpsFiles);
$("#ups_pick").addEventListener("click", e => { e.stopPropagation(); $("#ups_files").click(); });

function syncUpsForm(){
  const eng = $("#ups_engine").value;
  $("#ups_pruna_row").hidden  = eng !== "pruna";
  $("#ups_factor_row").hidden = eng === "pruna";
  $("#ups_clarity_adv").hidden = !(eng === "clarity" || eng === "ccsr");
  upsEstimate();
}
$("#ups_engine").addEventListener("change", syncUpsForm);
syncUpsForm();

function upsEstimate(){
  const eng = $("#ups_engine").value;
  const mp = num($("#ups_mp"), 4);
  const n = upsFiles.length || 1;
  const est = estimateUpscaleCost({ engine: eng, mp, n });
  setEstCost("ups", est);
}
["#ups_engine","#ups_mp"].forEach(s => $(s).addEventListener("change", upsEstimate));
$("#ups_mp").addEventListener("input", upsEstimate);
upsEstimate();

$("#ups_run").addEventListener("click", async () => {
  if(!upsFiles.length){ alert("Загрузи хотя бы одну картинку"); return; }
  const eng    = $("#ups_engine").value;
  const fmt    = $("#ups_format").value;
  const q      = num($("#ups_quality"), 95);
  const hintEl = $("#ups_hint");
  const resEl  = $("#ups_results");
  const btn    = $("#ups_run"); btn.disabled = true;
  hintEl.className = "hint";
  hintEl.innerHTML = `<span class="spinner"></span>Отправляю ${upsFiles.length} картинок…`;
  resEl.innerHTML = "";
  setRealCost("ups", 0);

  const factor = Number($("#ups_factor").value);
  const targetMP = Number($("#ups_mp").value);
  const enh = $("#ups_pruna_enh").value;
  let label = "Апскейл";
  let buildTask;

  if(eng === "basic"){
    label = `Апскейл ${factor}×`;
    buildTask = (img) => ({
      taskType: "imageUpscale",
      taskUUID: uuid(),
      inputImage: img,
      upscaleFactor: factor,
      outputType: "URL",
      outputFormat: fmt,
      outputQuality: q,
      includeCost: true,
    });
  } else if(eng === "clarity" || eng === "ccsr" || eng === "esrgan"){
    const modelMap = { clarity:"runware:500@1", ccsr:"runware:501@1", esrgan:"runware:504@1" };
    const labelMap = { clarity:"Clarity", ccsr:"CCSR", esrgan:"Real-ESRGAN" };
    label = `${labelMap[eng]} ${factor}×`;
    const settings = {};
    if(eng === "clarity" || eng === "ccsr"){
      const pos = $("#ups_pos").value.trim();
      const neg = $("#ups_neg").value.trim();
      const steps = num($("#ups_steps"));
      const cfg = num($("#ups_cfg"));
      const strength = num($("#ups_strength"));
      const cnw = num($("#ups_cnw"));
      const seed = num($("#ups_seed"));
      if(pos) settings.positivePrompt = pos;
      if(neg) settings.negativePrompt = neg;
      if(steps !== null) settings.steps = steps;
      if(cfg !== null) settings.CFGScale = cfg;
      if(strength !== null) settings.strength = strength;
      if(cnw !== null) settings.controlNetWeight = cnw;
      if(seed !== null) settings.seed = seed;
    }
    buildTask = (img) => {
      const t = {
        taskType: "imageUpscale",
        taskUUID: uuid(),
        model: modelMap[eng],
        inputImage: img,
        upscaleFactor: factor,
        outputType: "URL",
        outputFormat: fmt,
        outputQuality: q,
        includeCost: true,
      };
      if(Object.keys(settings).length) t.settings = settings;
      return t;
    };
  } else if(eng === "pruna"){
    label = `Pruna ${targetMP}MP`;
    buildTask = (img) => ({
      taskType: "upscale",
      taskUUID: uuid(),
      model: "prunaai:p-image@upscale",
      inputs: {
        inputImage: img,
        targetMegapixels: targetMP,
        enhanceDetails: enh === "detail" || enh === "both",
        enhanceRealism: enh === "realism" || enh === "both",
      },
      outputType: "URL",
      outputFormat: fmt === "WEBP" ? "PNG" : fmt,
      outputQuality: q,
      includeCost: true,
    });
  }

  const tasks = upsFiles.map(f => buildTask(f.dataURL));

  try {
    const body = await runwarePost(tasks);
    const items = (body.data || []).filter(d => d.imageURL || d.URL);
    if(!items.length) throw new Error("Пустой ответ от API");
    const grid = document.createElement("div");
    grid.className = "result-grid";
    let totalCost = 0;
    const fileExt = (eng === "pruna" && fmt === "WEBP") ? "png" : fmt.toLowerCase();
    for(const it of items){
      const url = it.imageURL || it.URL || it.url;
      if(!url) continue;
      if(it.cost) totalCost += Number(it.cost);
      const card = document.createElement("div");
      card.className = "result-card";
      card.innerHTML = `
        <img src="${url}" alt="">
        <div class="meta">
          <span>${label}${it.cost ? " · " + fmtUSD(it.cost) : ""}</span>
          <span class="actions-mini">
            <a href="${url}" target="_blank" rel="noopener">Открыть</a>
            <button class="link save-drive" type="button">Скачать</button>
          </span>
        </div>`;
      bindSaveToDrive(card, url, makeFileName(`upscale_${eng}`, "", fileExt));
      grid.appendChild(card);
      pushHistory({ kind:"image", url, modelLabel: label, prompt: label });
    }
    resEl.appendChild(grid);
    setRealCost("ups", totalCost);
    hintEl.className = "hint ok";
    hintEl.textContent = `Готово · ${items.length} файл(ов)` + (totalCost ? ` · ${fmtUSD(totalCost)}` : "");
  } catch(err){
    hintEl.className = "hint err";
    hintEl.textContent = "Ошибка: " + err.message;
  }
  btn.disabled = false;
});

$("#saveAllBtn").addEventListener("click", saveAllToDrive);

/* ---------- init ---------- */
renderHistory();
if(!getKey()){
  setTimeout(() => $("#settingsBtn").click(), 300);
}
