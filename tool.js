/* =============================================================================
   AUTO ARRANGER • tool.js  (Draft 1 core flow only)
   Sections:
     A) Global singletons & constants
     B) Generic helpers (DOM, state, fetch)
     C) Event bus
     D) Wizard visibility helper
     E) Boot + initDraft1UI (with strict state validation)
     F) Library & Instrument loaders (+ normalizers)
     G) Song population & change handlers
     H) XML extraction (single-part render)
     I) Step 3 Instrument Picker UI
     J) Pipeline reset (pre-module stub)
   ========================================================================== */


/* ============================================================================
   A) GLOBAL SINGLETONS & CONSTANTS
   ========================================================================== */

window.AUTO_ARRANGER_STATE_KEY = window.AUTO_ARRANGER_STATE_KEY || "autoArranger_extractedParts";
const STATE_KEY = window.AUTO_ARRANGER_STATE_KEY;

window.AUTO_ARRANGER_DATA_BASE = window.AUTO_ARRANGER_DATA_BASE || (function () {
  try {
    const me = Array.from(document.scripts).find(s => (s.src || "").includes("tool.js"))?.src;
    if (!me) return ".";
    return me.substring(0, me.lastIndexOf("/"));
  } catch { return "."; }
})();
const DATA_BASE = window.AUTO_ARRANGER_DATA_BASE;

const ROOT_BASE = new URL('.', document.baseURI).href.replace(/\/$/, "");


/* ============================================================================
   B) GENERIC HELPERS (DOM, STATE, FETCH)
   ========================================================================== */

function qs(id){ return document.getElementById(id); }
function ce(tag, props){ const el = document.createElement(tag); if(props) Object.assign(el, props); return el; }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }

function libSelectEl(){ return qs("librarySelect") || qs("libraryPackSelect") || document.querySelector('select[data-role="library"]'); }
function songSelectEl(){ return qs("songSelect") || qs("songSelectDropdown") || document.querySelector('select[data-role="song"]'); }

function getState() {
  try { return JSON.parse(sessionStorage.getItem(STATE_KEY) || "{}"); }
  catch { return {}; }
}
function setState(next) { AA.suspendEvents(() => sessionStorage.setItem(STATE_KEY, JSON.stringify(next))); }
function mergeState(patch) { setState({ ...getState(), ...patch }); }

// Debug reset if needed:
// sessionStorage.removeItem(STATE_KEY);

function showArrangingLoading() {
  if (qs("aa-loading")) return;
  const pad = ce("div");
  pad.id = "aa-loading";
  pad.style.cssText = `
    position:fixed; inset:0; z-index:9999; display:flex; align-items:center; justify-content:center;
    background:rgba(255,255,255,.96); font:700 18px/1.2 system-ui,Arial; color:#111;
  `;
  pad.textContent = "Arranging Custom Score...";
  document.body.appendChild(pad);
  window.hideArrangingLoading = () => pad.remove();
}
window.hideArrangingLoading = window.hideArrangingLoading || function(){};

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Fetch failed ${res.status} ${res.statusText} for ${url}\n${txt.slice(0,180)}`);
  }
  try { return await res.json(); }
  catch (e) {
    try {
      const raw = await (await fetch(url, { cache: "no-store" })).text();
      console.error("[AutoArranger] JSON parse error at", url, "payload sample:", raw.slice(0,500));
    } catch {}
    throw e;
  }
}
async function tryJson(paths){
  for (const url of paths) {
    try {
      console.log("[AA] trying:", url);
      const data = await fetchJson(url);
      console.log("[AA] loaded:", url);
      return { data, url };
    } catch (e) {
      console.warn("[AA] failed:", url, e.message || e);
    }
  }
  throw new Error("All candidate paths failed for JSON.");
}


/* ============================================================================
   C) LIGHTWEIGHT EVENT BUS
   ========================================================================== */

window.AA = window.AA || (function(){
  const listeners = new Map();
  let suspendDepth = 0;
  const API = {
    DEBUG: false,
    on(evt, fn){ if(!listeners.has(evt)) listeners.set(evt, new Set()); listeners.get(evt).add(fn); },
    off(evt, fn){ listeners.get(evt)?.delete(fn); },
    emit(evt, payload){
      if (suspendDepth>0) return;
      const set = listeners.get(evt);
      if (!set) return;
      for (const fn of set) {
        try { fn(payload); }
        catch(e){ console.error(`[AA] listener error: ${evt}`, e); }
      }
    },
    safe(name, fn){
      try { fn(); }
      catch(e){ console.error(`[AA] Module "${name}" failed:`, e); }
    },
    suspendEvents(fn){ suspendDepth++; try { fn(); } finally { suspendDepth--; } }
  };
  return API;
})();


/* ============================================================================
   D) WIZARD VISIBILITY HELPER
   ========================================================================== */

function setWizardStage(stage /* 'library' | 'song' | 'instruments' */){
  const s1 = qs("step1"), s2 = qs("step2"), s3 = qs("step3");
  if (s1) s1.classList.toggle("hidden", stage !== "library");
  if (s2) s2.classList.toggle("hidden", stage !== "song");
  if (s3) s3.classList.toggle("hidden", stage !== "instruments");

  updateStepDots(stage);
  AA.emit("wizard:stage", stage);
}
function updateStepDots(stage){
  const idx = stage === "library" ? 0 : stage === "song" ? 1 : 2;
  // tolerant to your HTML: it uses .stepper .dot
  const dots = document.querySelectorAll(".aa-step-dot, .stepper .dot, [data-step-dot]");
  dots.forEach((el, i) => el.classList.toggle("active", i === idx));
}


/* ============================================================================
   E) BOOT + INIT (STRICT STATE VALIDATION; NO AUTO-ADVANCE)
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  initDraft1UI().catch(e => console.error("[initDraft1UI]", e));
});

async function initDraft1UI(){
  if (window.AUTO_ARRANGER_UI_BOOTED) return;
  window.AUTO_ARRANGER_UI_BOOTED = true;

  console.log("[AA] DATA_BASE =", DATA_BASE, "| ROOT_BASE =", ROOT_BASE);

  const [packs, instruments] = await Promise.all([loadLibraryIndex(), loadInstrumentData()]);
  mergeState({ libraryPacks: packs, instrumentData: instruments });

  const libSel  = libSelectEl();
  const songSel = songSelectEl();

  if (libSel) {
    libSel.innerHTML = `<option value="">-- Select a Library Pack --</option>` +
      packs.map((p,i)=> `<option value="${i}">${escapeHtml(p.name)}</option>`).join("");
    libSel.addEventListener("change", onLibraryChosen);
  } else {
    console.warn("[AA] Could not find library select element (id='librarySelect' or 'libraryPackSelect').");
  }

  if (songSel) {
    songSel.addEventListener("change", onSongChosen);
  } else {
    console.warn("[AA] Could not find song select element (id='songSelect' or 'songSelectDropdown').");
  }
 // Wire Step-2 Back button → clear Song + Library and return to Step 1
const backBtn = document.getElementById("backButton");
if (backBtn && !backBtn.dataset.wired) {
  backBtn.dataset.wired = "1";
  backBtn.addEventListener("click", () => {
    // Clear current selections but keep the loaded data lists
    mergeState({
      packIndex: null,
      pack: null,
      songIndex: null,
      song: null,
      selectedSong: null,
      parts: []
    });

    // Reset the selects visually
    const libSel = libSelectEl();
    if (libSel) libSel.value = "";

    const sSel = songSelectEl();
    if (sSel) {
      sSel.innerHTML = `<option value="">-- Select a Song --</option>`;
      sSel.value = "";
    }

    // Show Step 1 (updates dots too)
    setWizardStage("library");
  });
}



  // Validate saved state and choose stage (do not auto-advance)
  const st = getState();
  const validPack =
    Number.isInteger(st.packIndex) &&
    (Array.isArray(packs) && Boolean(packs[st.packIndex]));
  const validSong =
    validPack &&
    Number.isInteger(st.songIndex) &&
    Array.isArray(packs[st.packIndex].songs) &&
    Boolean(packs[st.packIndex].songs[st.songIndex]);
  const haveParts = Array.isArray(st.parts) && st.parts.length > 0;

  if (!validPack) {
    mergeState({ packIndex: null, pack: null, songIndex: null, song: null, parts: [] });
    setWizardStage("library");
  } else if (!validSong) {
    if (libSel) {
      libSel.value = String(st.packIndex);
      populateSongsForPack(st.packIndex);
    }
    mergeState({ songIndex: null, song: null, parts: [] });
    setWizardStage("song");
  } else {
    if (libSel) {
      libSel.value = String(st.packIndex);
      populateSongsForPack(st.packIndex);
    }
    if (songSel) songSel.value = String(st.songIndex);
    setWizardStage(haveParts ? "instruments" : "song");
  }

  if (!packs.length) {
    console.warn("[AA] No library packs found. Last URL tried:", getState().libraryJsonUrl);
  }
}


/* ============================================================================
   F) LIBRARY & INSTRUMENT LOADERS (+ NORMALIZERS)
   ========================================================================== */

// ---- normalizer helpers ----
function basename(path) { const m = String(path || "").split(/[\\/]/).pop(); return m || ""; }
function stripExt(name) { return String(name || "").replace(/\.[^.]+$/, ""); }
function absolutizeUrl(u, baseUrl) {
  try {
    if (/^https?:\/\//i.test(u)) return u;
    const b = new URL(baseUrl, location.href);
    const folder = b.href.replace(/\/[^\/]*$/, "/");
    return new URL(String(u).replace(/^\.\//, ""), folder).href;
  } catch { return u; }
}

// ---- library normalizer ----
function normalizeLibraryData(data, baseUrl) {
  // Accept 1) {packs:[...]} 2) [ ... ] 3) { "Pack Name": [ "file.xml" | {name,url} ] }
  const packs = [];
  const addPack = (name, items) => {
    const arr = Array.isArray(items) ? items : [];
    const songs = arr.map(item => {
      if (typeof item === "string") {
        const url = absolutizeUrl(item, baseUrl);
        return { name: stripExt(basename(item)) || "Untitled", url };
      } else if (item && typeof item === "object") {
        let url = item.url || item.path || "";
        if (url) url = absolutizeUrl(url, baseUrl);
        const nm = item.name || stripExt(basename(url)) || "Untitled";
        return { name: nm, url };
      }
      return null;
    }).filter(Boolean);
    packs.push({ name: String(name || "Pack"), songs });
  };

  if (Array.isArray(data?.packs)) { data.packs.forEach(p => addPack(p?.name, p?.songs || p?.files || p?.items)); return packs; }
  if (Array.isArray(data))        { data.forEach(p => addPack(p?.name, p?.songs || p?.files || p?.items));     return packs; }
  if (data && typeof data === "object") {
    Object.entries(data).forEach(([name, items]) => { if (Array.isArray(items)) addPack(name, items); });
    return packs;
  }
  return [];
}

// ---- instrument normalizer (TOP-LEVEL, not nested) ----
function normalizeInstrumentData(data) {
  // 1) Array of instrument meta
  if (Array.isArray(data)) return data;

  // 2) { instruments: [...] } or { items: [...] }
  if (Array.isArray(data?.instruments)) return data.instruments;
  if (Array.isArray(data?.items))       return data.items;

  // 3) Map form: { "Violin": { ... }, "Flute": { ... } }
  if (data && typeof data === "object") {
    return Object.entries(data).map(([name, meta]) => ({
      name,
      instrumentPart: meta.instrumentPart ?? meta.part ?? "",
      sortingOctave: Number(meta.sortingOctave ?? meta.octave ?? 0),
      clef: meta.clef ?? null,
      transpose: meta.transpose ?? null,
      scoreOrder: Number(meta.scoreOrder ?? meta.order ?? 999),
    }));
  }
  return [];
}

// ---- loaders ----
async function loadLibraryIndex(){
  const candidates = [
    `${ROOT_BASE}/libraryData.json`,
    `${ROOT_BASE}/librarydata.json`,
    `${DATA_BASE}/libraryData.json`,
    `${DATA_BASE}/librarydata.json`,
    './libraryData.json','./librarydata.json','libraryData.json','librarydata.json'
  ];
  const { data, url } = await tryJson(candidates);
  mergeState({ libraryJsonUrl: url });
  const packs = normalizeLibraryData(data, url);
  if (!packs.length) console.warn("[AA] libraryData.json loaded but no packs recognized. Raw:", data);
  return packs;
}
async function loadInstrumentData(){
  const candidates = [
    `${ROOT_BASE}/instrumentData.json`,
    `${DATA_BASE}/instrumentData.json`,
    `${ROOT_BASE}/data/instrumentData.json`,
    `${DATA_BASE}/data/instrumentData.json`,
    './instrumentData.json','instrumentData.json'
  ];
  const { data, url } = await tryJson(candidates);
  const normalized = normalizeInstrumentData(data);

  mergeState({ instrumentJsonUrl: url, instrumentData: normalized });

  if (!normalized.length) {
    console.warn("[AA] instrumentData.json loaded but no instruments recognized. Raw:", data);
  } else {
    console.log(`[AA] instruments loaded: ${normalized.length} from`, url);
  }

  AA.emit("data:instrumentData", normalized);
  return normalized;
}


/* ============================================================================
   G) SONG POPULATION & CHANGE HANDLERS
   ========================================================================== */

function populateSongsForPack(packIndex){
  const packs = getState().libraryPacks || [];
  const pack = packs[packIndex];
  const songSel = songSelectEl();
  if (!pack || !songSel) return;

  songSel.innerHTML = `<option value="">-- Select a Song --</option>` +
    pack.songs.map((s,i)=> `<option value="${i}">${escapeHtml(s.name)}</option>`).join("");
}

function onLibraryChosen(){
  const libSel = libSelectEl();
  const idx = parseInt(libSel?.value || "", 10);
  if (!Number.isFinite(idx)) return;

  const packs = getState().libraryPacks || [];
  const pack = packs[idx];

  mergeState({ packIndex: idx, pack: pack?.name || "", songIndex: null, song: null, parts: [] });
  populateSongsForPack(idx);

  setWizardStage("song");

  const sSel = songSelectEl();
  if (sSel) sSel.value = "";
}

async function onSongChosen(){
  const s = getState();
  const packs = s.libraryPacks || [];
  const pack  = packs[s.packIndex];
  if (!pack) return;

  const sSel = songSelectEl();
  const songIdx = parseInt(sSel?.value || "", 10);
  if (!Number.isFinite(songIdx)) return;

  const song = pack.songs[songIdx];
  mergeState({ songIndex: songIdx, song: song?.name || "", selectedSong: song });

  if (song?.url) {
    try {
      const text  = await fetch(song.url, { cache: "no-store" }).then(r => r.text());
      const parts = extractPartsFromScore(text);
      mergeState({ parts });
      if (!Array.isArray(parts) || !parts.length) {
        console.warn("[AA] Extracted 0 parts from the selected song.");
      }
      setWizardStage("instruments");
    } catch (e) {
      console.error("[extractPartsFromScore]", e);
      alert("Failed to extract parts from this song.");
    }
  }
}


/* ============================================================================
   H) XML EXTRACTION (SINGLE-PART SCORES FROM SELECTED FILE)
   ========================================================================== */

function extractPartsFromScore(xmlText){
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const serializer = new XMLSerializer();

  const scoreParts = Array.from(doc.querySelectorAll("score-part"));
  const partList   = Array.from(doc.querySelectorAll("part"));

  const out = [];

  for (const sp of scoreParts) {
    const id = sp.getAttribute("id");
    if (!id) continue;

    const nameNode = sp.querySelector("part-name");
    const partName = nameNode ? nameNode.textContent.trim() : id;

    const bodyPart = partList.find(p => p.getAttribute("id") === id);
    if (!bodyPart) continue;

    const newDoc = document.implementation.createDocument("", "", null);
    const score  = newDoc.createElement("score-partwise");

    const root = doc.querySelector("score-partwise, score-timewise") || doc.documentElement;
    const headerTags = ["work","identification","defaults","credit"];
    for (const tag of headerTags) {
      const node = root.querySelector(tag);
      if (node) score.appendChild(newDoc.importNode(node, true));
    }

    const pl = newDoc.createElement("part-list");
    pl.appendChild(newDoc.importNode(sp, true));
    score.appendChild(pl);

    score.appendChild(newDoc.importNode(bodyPart, true));
    newDoc.appendChild(score);

    const singleXml = serializer.serializeToString(newDoc);
    out.push({ id, partName, xml: singleXml });
  }

  return out;
}


/* ============================================================================
   I) STEP 3: INSTRUMENT PICKER UI — Folder Tree (Categories) → Instruments
   - Fixed-height scrollable list; buttons at the bottom
   - Collapsible folders (no re-open glitch)
   - Right pane sorted alphabetically; smart numbering
   ========================================================================== */
(function(){

  function ensureStep3Host(){
    let host = document.getElementById("step3");
    if (!host) {
      const cardBody = document.querySelector(".card-body") || document.body;
      host = document.createElement("div");
      host.id = "step3";
      host.className = "hidden";
      host.innerHTML = `<div class="field"><label>Select Instruments</label></div>`;
      cardBody.appendChild(host);
    }
    return host;
  }

  function ensureInstrumentPickerMarkup(){
    const host = ensureStep3Host();

    // De-dupe containers
    const containers = Array.from(document.querySelectorAll("#aa-pickers"));
    let container = containers[0];
    if (containers.length > 1) containers.slice(1).forEach(n => n.remove());

    if (!container) {
      host.insertAdjacentHTML("beforeend", `
        <div id="aa-pickers" class="aa-grid" style="margin-top:12px;">
          <div class="aa-pane" style="display:flex; flex-direction:column;">
            <h4>Instruments</h4>

            <!-- Fixed-height scroll area -->
            <div id="aa-tree-wrap" style="flex:1 1 auto; min-height:260px; max-height:340px; overflow:auto; border-top:1px solid var(--line);">
              <ul id="instrumentTree" class="list" style="margin:0;"></ul>
            </div>

            <!-- Controls anchored at bottom -->
            <div id="leftControls" style="display:flex; gap:10px; margin-top:10px;">
              <button id="btnBackToSong" class="aa-btn" style="background:#1a1f2a;border:1px solid var(--line);color:var(--text);">Back</button>
              <button id="btnAddInstrument" class="aa-btn">Add to Score</button>
            </div>
          </div>

          <div class="aa-pane" style="display:flex; flex-direction:column;">
            <h4>Selections</h4>
            <select id="selectionsList" size="10" style="flex:1 1 auto; min-height:260px; max-height:340px;"></select>
            <div style="display:flex; gap:10px; margin-top:10px;">
              <button id="btnRemoveSelected" class="aa-btn">Remove</button>
              <button id="btnSaveSelections" class="aa-btn aa-accent">Save Selections</button>
            </div>
          </div>
        </div>
      `);
      container = document.getElementById("aa-pickers");
      console.log("[AA] Built Step 3 instrument picker UI (folder tree, fixed height).");
    } else {
      // Ensure tree wrap / tree exist
      if (!document.getElementById("aa-tree-wrap")) {
        const leftPane = container.querySelector(".aa-pane");
        const wrap = document.createElement("div");
        wrap.id = "aa-tree-wrap";
        wrap.style.cssText = "flex:1 1 auto; min-height:260px; max-height:340px; overflow:auto; border-top:1px solid var(--line);";
        const tree = document.createElement("ul");
        tree.id = "instrumentTree";
        tree.className = "list";
        tree.style.margin = "0";
        wrap.appendChild(tree);
        leftPane.insertBefore(wrap, leftPane.querySelector("#leftControls"));
      }
      // Ensure Back button exists
      if (!document.getElementById("btnBackToSong")) {
        const controls = container.querySelector("#leftControls") ||
                         container.querySelector("#btnAddInstrument")?.parentElement;
        if (controls) {
          const back = document.createElement("button");
          back.id = "btnBackToSong";
          back.className = "aa-btn";
          back.textContent = "Back";
          back.style.cssText = "background:#1a1f2a;border:1px solid var(--line);color:var(--text);";
          controls.insertBefore(back, controls.querySelector("#btnAddInstrument"));
        }
      }
      // Remove any legacy select
      const legacySelect = container.querySelector("#instrumentList");
      if (legacySelect) legacySelect.remove();
    }

    // Minimal tree CSS (no bullets, tidy folders)
    let st = document.getElementById("aa-tree-css");
    if (!st) { st = document.createElement("style"); st.id = "aa-tree-css"; document.head.appendChild(st); }
    st.textContent = `
      #instrumentTree, #instrumentTree ul { list-style:none; padding:0; margin:0; }
      .aa-folder { display:flex; align-items:center; gap:8px; padding:10px 12px;
                   border-bottom:1px solid var(--line); cursor:pointer; }
      .aa-folder .aa-caret { width:14px; text-align:center; font-size:12px; opacity:0.9; }
      .aa-folder .aa-name   { font-weight:600; color:var(--text); }
      .aa-children { margin:0; padding:0 0 0 22px; }
      .aa-ins { padding:8px 12px; border-bottom:1px dashed var(--line); cursor:pointer; }
      .aa-ins:hover { background:#0f131b; }
      .aa-ins.active { outline:2px solid var(--brand-600); background:#11171f; }
      .aa-hide { display:none !important; }
    `;

    return container;
  }

  function setupInstrumentPicker(){
    const container = ensureInstrumentPickerMarkup();
    if (!container) return;

    const tree      = container.querySelector("#instrumentTree");
    const btnAdd    = container.querySelector("#btnAddInstrument");
    const btnBack   = container.querySelector("#btnBackToSong");
    const listRight = container.querySelector("#selectionsList");
    const btnRemove = container.querySelector("#btnRemoveSelected");
    const btnSave   = container.querySelector("#btnSaveSelections");
    const note      = document.getElementById("instStatus");

    if (!tree || !btnAdd || !btnBack || !listRight || !btnRemove || !btnSave) {
      console.warn("[AA] Step 3 UI elements missing; picker not wired.");
      return;
    }

    // Local state
    const stateSel = { selections: [], openCats: new Set(), selectedBase: "", everBuilt:false };

    function buildTree(){
      const s = getState();
      const data = Array.isArray(s.instrumentData) ? s.instrumentData : [];
      if (!data.length) {
        tree.innerHTML = `<li class="aa-ins" style="opacity:.7; pointer-events:none;">No instruments found</li>`;
        if (note) note.textContent = "No instruments found in instrumentData.json.";
        return;
      }
      if (note) note.textContent = "";

      // Group by category
      const catMap = new Map();
      for (const ins of data) {
        const cat = (ins.category || "Other").trim();
        if (!catMap.has(cat)) catMap.set(cat, []);
        catMap.get(cat).push(ins.name);
      }
      const cats = Array.from(catMap.keys()).sort((a,b)=> a.localeCompare(b, undefined, { sensitivity:"base" }));
      cats.forEach(c => catMap.get(c).sort((a,b)=> a.localeCompare(b, undefined, { sensitivity:"base" })));

    // Start fully collapsed on first render (no auto-open)
if (!stateSel.everBuilt && stateSel.openCats.size === 0) {
  // leave all categories collapsed
}


      const parts = [];
      for (const cat of cats) {
        const open = stateSel.openCats.has(cat);
        parts.push(`
          <li class="aa-folder" data-cat="${escapeHtml(cat)}" data-role="folder" aria-expanded="${open}">
            <span class="aa-caret">${open ? "▾" : "▸"}</span>
            <span class="aa-name">${escapeHtml(cat)}</span>
          </li>
        `);
        parts.push(`<ul class="aa-children ${open ? "" : "aa-hide"}" data-cat="${escapeHtml(cat)}">`);
        for (const nm of catMap.get(cat)) {
          const active = (stateSel.selectedBase === nm) ? " active" : "";
          parts.push(`<li class="aa-ins${active}" data-ins="${escapeHtml(nm)}" data-role="instrument">${escapeHtml(nm)}</li>`);
        }
        parts.push(`</ul>`);
      }
      tree.innerHTML = parts.join("");
      stateSel.everBuilt = true;
    }

    function onTreeClick(e){
      const target = e.target;
      const liFolder = target.closest('[data-role="folder"]');
      const liIns    = target.closest('[data-role="instrument"]');

      if (liFolder) {
        const cat = liFolder.getAttribute("data-cat") || "";
        if (stateSel.openCats.has(cat)) stateSel.openCats.delete(cat);
        else stateSel.openCats.add(cat);
        buildTree();
        return;
      }
      if (liIns) {
        stateSel.selectedBase = liIns.getAttribute("data-ins") || "";
        buildTree();
        return;
      }
    }

    const baseOf = (name) => String(name).replace(/\s+\d+$/, "");

    function refreshRight(){
      const groups = new Map(); // base -> [idx...]
      stateSel.selections.forEach((base, idx) => {
        if (!groups.has(base)) groups.set(base, []);
        groups.get(base).push(idx);
      });

      const records = [];
      for (const [base, indices] of groups.entries()) {
        if (indices.length === 1) {
          const i = indices[0];
          records.push({ base, idx: i, num: 0, label: base });
        } else {
          indices.forEach((i, k) => {
            const num = k + 1;
            records.push({ base, idx: i, num, label: `${base} ${num}` });
          });
        }
      }
      records.sort((a, b) => {
        const byName = a.base.localeCompare(b.base, undefined, { sensitivity: "base" });
        if (byName !== 0) return byName;
        return a.num - b.num;
      });

      listRight.innerHTML = records
        .map(rec => `<option value="${rec.idx}">${escapeHtml(rec.label)}</option>`)
        .join("");
    }

    function addSelection(baseName){
      stateSel.selections.push(baseName);
      refreshRight();
    }
    function removeSelectionByIndex(idx){
      if (idx < 0 || idx >= stateSel.selections.length) return;
      stateSel.selections.splice(idx, 1);
      refreshRight();
    }

    // Wire once
    if (container.dataset.wired === "1") { buildTree(); refreshRight(); return; }
    container.dataset.wired = "1";

    buildTree();
    refreshRight();
    AA.on("data:instrumentData", () => { buildTree(); });

    tree.addEventListener("click", onTreeClick);

    btnAdd.addEventListener("click", () => {
      const sel = stateSel.selectedBase;
      if (!sel) return alert("Select an instrument from the list first.");
      addSelection(sel);
    });

    btnBack.addEventListener("click", () => {
      const s = getState();
      mergeState({
        songIndex: null,
        song: null,
        selectedSong: null,
        parts: [],
        instrumentSelections: []
      });
      stateSel.selections = [];
      stateSel.selectedBase = "";
      refreshRight();

      if (Number.isInteger(s.packIndex)) populateSongsForPack(s.packIndex);
      const sSel = (typeof songSelectEl === "function" ? songSelectEl() : document.getElementById("songSelect"));
      if (sSel) sSel.value = "";
      setWizardStage("song");
    });

    btnRemove.addEventListener("click", () => {
      const opt = listRight.options[listRight.selectedIndex];
      if (!opt) return;
      removeSelectionByIndex(parseInt(opt.value, 10));
    });

    btnSave.addEventListener("click", () => {
      const s = getState();
      const metaIndex = Object.fromEntries((s.instrumentData||[]).map(m => [m.name, m]));

      const groups = new Map();
      stateSel.selections.forEach((base, idx) => {
        if (!groups.has(base)) groups.set(base, []);
        groups.get(base).push(idx);
      });
      const instanceNumberByIndex = {};
      for (const [base, indices] of groups.entries()) {
        if (indices.length === 1) instanceNumberByIndex[indices[0]] = 0;
        else indices.forEach((i, k) => instanceNumberByIndex[i] = k + 1);
      }

      const instrumentSelections = stateSel.selections.map((base, i) => {
        const meta = metaIndex[base] || {};
        const num = instanceNumberByIndex[i] || 0;
        const label = num === 0 ? base : `${base} ${num}`;
        return {
          name: base,
          instanceLabel: label,
          instrumentPart: meta.instrumentPart || "",
          sortingOctave: Number(meta.sortingOctave)||0,
          clef: meta.clef ?? null,
          transpose: meta.transpose ?? null,
          scoreOrder: Number(meta.scoreOrder)||999,
          assignedPart: "",
          category: meta.category || "Other"
        };
      });

      mergeState({ instrumentSelections });
      AA.emit("instruments:saved");
    });
  }

  document.addEventListener("DOMContentLoaded", setupInstrumentPicker);
  AA.on("wizard:stage", (stage) => { if (stage === "instruments") setupInstrumentPicker(); });

})(); // end Step 3





/* ============================================================================
   J) PIPELINE RESET (RUNS RIGHT AFTER "SAVE SELECTIONS")
   ========================================================================== */

(function(){
  AA.on("instruments:saved", () => AA.safe("pipelineReset", reset));

  function reset(){
    const s = getState();
    setState({
      packIndex: s.packIndex,
      pack: s.pack,
      songIndex: s.songIndex,
      song: s.song,
      selectedSong: s.selectedSong,
      libraryPacks: s.libraryPacks,
      instrumentData: s.instrumentData,
      instrumentSelections: s.instrumentSelections,

      parts: Array.isArray(s.parts) ? s.parts : [],
      assignedResults: [],
      groupedAssignments: [],
      arrangedFiles: [],
      combinedScoreXml: "",

      arrangeDone: false,
      renameDone: false,
      reassignByScoreDone: false,
      combineDone: false,

      timestamp: Date.now()
    });

    // showArrangingLoading(); // re-enable when pipeline modules are reattached
  }
})();












