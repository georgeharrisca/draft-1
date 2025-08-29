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
   updateChoiceFlow();

  AA.emit("wizard:stage", stage);
}
function updateStepDots(stage){
  const idx = stage === "library" ? 0 : stage === "song" ? 1 : 2;
  // tolerant to your HTML: it uses .stepper .dot
  const dots = document.querySelectorAll(".aa-step-dot, .stepper .dot, [data-step-dot]");
  dots.forEach((el, i) => el.classList.toggle("active", i === idx));
}

/* --- Breadcrumb (below dots): shows Library Pack and (optionally) Song --- */
function updateChoiceFlow(){
  const el = document.getElementById("choiceFlow");
  if (!el) return;

  const s = getState();
  const packName =
    s.pack ??
    (s.libraryPacks?.[s.packIndex]?.name) ??
    "";
  const songName =
    s.song ??
    (s.libraryPacks?.[s.packIndex]?.songs?.[s.songIndex]?.name) ??
    "";

  if (packName && songName){
    el.innerHTML = `${escapeHtml(packName)} <span aria-hidden="true">›</span> ${escapeHtml(songName)}`;
  } else if (packName){
    el.textContent = packName;
  } else {
    el.textContent = "";
  }
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

updateChoiceFlow();
   
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
   updateChoiceFlow();


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
   updateChoiceFlow();


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
   I) STEP 3: INSTRUMENT PICKER UI (folders, fixed-height, robust rebuild)
   ========================================================================== */
(function(){

  // Inject minimal CSS once
  (function ensureStep3CSS(){
    if (document.getElementById("aa-step3-css")) return;
    const st = document.createElement("style");
    st.id = "aa-step3-css";
    st.textContent = `
      #aa-pickers{display:grid;grid-template-columns:1fr 1fr;gap:18px}
      #aa-pickers .aa-pane{background:#0d1016;border:1px solid var(--line);border-radius:10px;padding:12px}
      #aa-pickers .aa-pane h4{margin:0 0 10px 0;font-size:14px;color:var(--metal-3)}
      #aa-pickers .aa-pane-left{display:flex;flex-direction:column}

      /* constant-height scroll area */
      #instrumentTree{
        height: 360px;
        overflow: auto;
        border:1px solid var(--line);
        border-radius:8px;
        padding:6px 8px;
        background:#0b0f16;
      }
      #aa-left-controls{display:flex;gap:10px;margin-top:10px}

      /* match font sizes */
      #instrumentTree, #instrumentTree .hdr, #instrumentTree .item,
      #aa-pickers select{ font-size:14px; }

      /* tree visuals */
      .aa-cat{margin:6px 0}
      .aa-cat .hdr{display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;color:#cfd6e3}
      .aa-cat .hdr .tw{width:12px;display:inline-block;text-align:center;color:#9AA3B2}
      .aa-cat .list{margin:4px 0 0 20px;padding:0;list-style:none}
      .aa-cat .item{padding:6px 4px;border-bottom:1px dashed rgba(255,255,255,.05);cursor:pointer;color:#e8edf6}
      .aa-cat .item:hover{background:#11171f}
      .aa-cat .item.highlight{outline:1px dashed #3c4a5f;outline-offset:2px}
    `;
    document.head.appendChild(st);
  })();

  // Ensure a Step 3 host exists
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

  // Always (re)build the Step-3 container to avoid stale legacy markup
  function buildStep3Container(){
    const host = ensureStep3Host();
    // remove any previous container entirely — we’ll rebuild cleanly
    host.querySelectorAll("#aa-pickers").forEach(n => n.remove());

    host.insertAdjacentHTML("beforeend", `
      <div id="aa-pickers">
        <!-- LEFT: instruments with folders -->
        <div class="aa-pane aa-pane-left">
          <h4>Instruments</h4>
          <div id="instrumentTree" aria-label="Instrument categories"></div>
          <div id="aa-left-controls">
            <button id="btnBackToSong" class="aa-btn" style="background:#1a1f2a;border:1px solid var(--line);color:var(--text);">Back</button>
            <button id="btnAddInstrument" class="aa-btn">Add to Score</button>
          </div>
        </div>

        <!-- RIGHT: selections -->
        <div class="aa-pane">
          <h4>Selections</h4>
          <select id="selectionsList" size="14" style="width:100%;height:360px;"></select>
          <div style="display:flex; gap:10px; margin-top:10px;">
            <button id="btnRemoveSelected" class="aa-btn">Remove</button>
            <button id="btnSaveSelections" class="aa-btn aa-accent">Save Selections</button>
          </div>
        </div>
      </div>
    `);
    return document.getElementById("aa-pickers");
  }

  function setupInstrumentPicker(){
    const container = buildStep3Container();
    const treeHost  = container.querySelector("#instrumentTree");
    const listRight = container.querySelector("#selectionsList");
    const btnAdd    = container.querySelector("#btnAddInstrument");
    const btnBack   = container.querySelector("#btnBackToSong");
    const btnRemove = container.querySelector("#btnRemoveSelected");
    const btnSave   = container.querySelector("#btnSaveSelections");
    const note      = document.getElementById("instStatus");

    const getInstruments = () => {
      const s = getState();
      return Array.isArray(s.instrumentData) ? s.instrumentData : [];
    };

    // Local state
    const stateSel = { selections: [], openCats: new Set() }; // collapsed by default
    const baseOf = (name) => String(name).replace(/\s+\d+$/, "");

    // Build the collapsible category tree
    function buildTree(){
      const instruments = getInstruments();
      if (!instruments.length) {
        treeHost.innerHTML = `<div class="note">No instruments found. Check instrumentData.json.</div>`;
        if (note) note.textContent = "No instruments found in instrumentData.json.";
        return;
      }

      const byCat = new Map();
      instruments.forEach(m => {
        const cat = m.category || "Other";
        if (!byCat.has(cat)) byCat.set(cat, []);
        byCat.get(cat).push(m.name);
      });

      // sort cats/items
      const cats = Array.from(byCat.keys()).sort((a,b)=> a.localeCompare(b));
      cats.forEach(c => byCat.get(c).sort((a,b)=> a.localeCompare(b)));

      const frag = document.createDocumentFragment();
      cats.forEach(cat => {
        const open = stateSel.openCats.has(cat); // default: false (collapsed)
        const catEl = document.createElement("div");
        catEl.className = "aa-cat";
        catEl.innerHTML = `
          <div class="hdr" data-cat="${escapeHtml(cat)}">
            <span class="tw">${open ? "▾" : "▸"}</span>
            <strong>${escapeHtml(cat)}</strong>
          </div>
          <ul class="list" style="${open ? "" : "display:none"}"></ul>
        `;
        const ul = catEl.querySelector("ul");
        byCat.get(cat).forEach(name => {
       const li = document.createElement("li");
li.className = "item";
li.textContent = name;
li.dataset.name = name;
// no addSelection here — click just highlights (handled below)
ul.appendChild(li);

        });
        catEl.querySelector(".hdr").addEventListener("click", () => {
          if (stateSel.openCats.has(cat)) stateSel.openCats.delete(cat);
          else stateSel.openCats.add(cat);
          buildTree(); // re-render
        });
        frag.appendChild(catEl);
      });

      treeHost.innerHTML = "";
      treeHost.appendChild(frag);
      if (note) note.textContent = "";
    }

    // Right list helpers
    function refreshRight(){
      const sorted = [...stateSel.selections].sort((a,b)=> a.localeCompare(b));
      listRight.innerHTML = sorted.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
    }
    function addSelection(baseName){
      const siblings = stateSel.selections.filter(n => baseOf(n) === baseName).length;
      const label = siblings === 0 ? baseName : `${baseName} ${siblings+1}`;
      stateSel.selections.push(label);
      if (siblings === 1) { // second copy → rename bare to "… 1"
        const i = stateSel.selections.findIndex(n => n === baseName);
        if (i >= 0) stateSel.selections[i] = `${baseName} 1`;
      }
      refreshRight();
    }
    function removeSelection(label){
      const i = stateSel.selections.indexOf(label);
      if (i>=0) stateSel.selections.splice(i,1);
      const b = baseOf(label);
      const same = stateSel.selections.filter(n => baseOf(n) === b);
      if (same.length === 1) {
        const j = stateSel.selections.findIndex(n => baseOf(n) === b);
        stateSel.selections[j] = b; // drop trailing " 1"
      } else if (same.length > 1) {
        let k = 1;
        for (let idx=0; idx<stateSel.selections.length; idx++) {
          if (baseOf(stateSel.selections[idx]) === b) {
            stateSel.selections[idx] = `${b} ${k++}`;
          }
        }
      }
      refreshRight();
    }

    // Initial build + live updates when instrumentData arrives/changes
    buildTree();
    AA.on("data:instrumentData", buildTree);

    // Highlight last clicked item (lets Add button work without re-click)
    treeHost.addEventListener("click", (e) => {
      const it = e.target.closest(".item");
      if (!it) return;
      treeHost.querySelectorAll(".item").forEach(n => n.classList.remove("highlight"));
      it.classList.add("highlight");
    });

    // Buttons
   btnAdd.addEventListener("click", () => {
  const highlighted = treeHost.querySelector(".item.highlight");
  if (!highlighted) {
    if (note) {
      note.textContent = "Select an instrument on the left, then click Add to Score.";
      setTimeout(() => { if (note.textContent.includes("Add to Score")) note.textContent = ""; }, 2000);
    }
    return;
  }
  addSelection(highlighted.dataset.name);
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
      refreshRight();
      if (Number.isInteger(s.packIndex)) populateSongsForPack(s.packIndex);
      const sSel = (typeof songSelectEl === "function" ? songSelectEl() : null);
      if (sSel) sSel.value = "";
      setWizardStage("song");
    });

    btnRemove.addEventListener("click", () => {
      const sel = listRight.value;
      if (!sel) return;
      removeSelection(sel);
    });

    btnSave.addEventListener("click", () => {
      const s = getState();
      const metaIndex = Object.fromEntries((s.instrumentData||[]).map(m => [m.name, m]));
      const instrumentSelections = [...stateSel.selections]
        .sort((a,b)=> a.localeCompare(b))
        .map(label => {
          const base = label.replace(/\s+\d+$/,"");
          const meta = metaIndex[base] || {};
          return {
            name: base,
            instanceLabel: label,
            instrumentPart: meta.instrumentPart || "",
            sortingOctave: Number(meta.sortingOctave)||0,
            clef: meta.clef ?? null,
            transpose: meta.transpose ?? null,
            scoreOrder: Number(meta.scoreOrder)||999,
            assignedPart: ""
          };
        });
      mergeState({ instrumentSelections });
      AA.emit("instruments:saved");
    });
  }

  // Build on DOM ready + whenever we enter Step 3
  document.addEventListener("DOMContentLoaded", () => {
    // only build if Step 3 becomes visible later; harmless to prebuild
    // (we still rebuild on stage change)
  });
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

















/* =============================================================================
   AUTO ARRANGER • Pipeline Modules (Append after core Draft-1 JS)
   Sections:
     M1) assignParts
     M2) groupAssignments
     M3) arrangeGroupedParts
     M4) reassignPartNamesAbbrev
     M5) reassignPartIdsByScoreOrder
     M6) combineArrangedParts
     M7) finalViewer
     H1) helpers (OSMD header helper)
   ========================================================================== */


/* ============================================================================
   M1) assignParts — compute assignedPart buckets (accepts category names)
   ---------------------------------------------------------------------------- */
(function(){
  AA.on("instruments:saved", () => AA.safe("assignParts", run));

  const PART_LABELS = [
    "1 Melody","2 Harmony I","3 Harmony II","4 Counter Melody","5 Counter Melody Harmony","6 Bass",
    "7 Groove","8 Chords","9 Drum Kit","10 Melody & Bass","11 Melody & Chords","12 Chords & Bass",
    "13 Melody & Chords & Bass","14 Timpani","15 Triangle"
  ];
  const CATEGORY_TO_INDEX = {
    "melody":1,"harmony i":2,"harmony 1":2,"harmony ii":3,"harmony 2":3,
    "counter melody":4,"counter-melody":4,"counter melody harmony":5,"counter-melody harmony":5,
    "bass":6,"groove":7,"chords":8,"drum kit":9,"drumkit":9,
    "melody & bass":10,"melody and bass":10,"melody & chords":11,"melody and chords":11,
    "chords & bass":12,"chords and bass":12,"melody & chords & bass":13,"melody and chords and bass":13,
    "timpani":14,"triangle":15
  };
  const fmt = n => PART_LABELS[n-1] || String(n);

  function idxFlexible(label){
    if (!label) return -1;
    const norm = String(label).toLowerCase().replace(/\s+/g," ").trim();
    const exact = PART_LABELS.findIndex(p => p.toLowerCase() === norm);
    if (exact >= 0) return exact+1;
    const m = /^(\d{1,2})\b/.exec(norm);
    if (m) {
      const n = +m[1]; if (n>=1 && n<=15) return n;
    }
    const stripped = norm.replace(/^\d+\s*/,"");
    if (CATEGORY_TO_INDEX[stripped]) return CATEGORY_TO_INDEX[stripped];
    for (let i=0;i<PART_LABELS.length;i++){
      const cat = PART_LABELS[i].toLowerCase().replace(/^\d+\s*/,"");
      if (cat === stripped) return i+1;
    }
    return -1;
  }

  function run(){
    const state = getState();
    const sel = Array.isArray(state.instrumentSelections) ? state.instrumentSelections : [];
    console.log(`[M1] assignParts: received instrumentSelections = ${sel.length}`);
    if (!sel.length) return;

    const rows = sel.map(item => {
      const ipIdx = idxFlexible(item.instrumentPart);
      let sortNum = null;
      if (ipIdx >= 1 && ipIdx <= 6) {
        sortNum = ipIdx;
        const oct = Number(item.sortingOctave)||0;
        if (oct > 0) sortNum -= oct;
        else if (oct < 0) sortNum += Math.abs(oct);
      }
      return {
        label: item.instanceLabel, base: item.name,
        instrumentPart: item.instrumentPart,
        sortingOctave: item.sortingOctave, clef: item.clef,
        transpose: item.transpose, scoreOrder: item.scoreOrder,
        sortNumber: sortNum, idx: ipIdx, assignedPart: ""
      };
    });

    for (const r of rows) if (r.idx>=7 && r.idx<=15) r.assignedPart = fmt(r.idx);

    const pool = rows.filter(r => r.idx>=1 && r.idx<=6 && r.sortNumber!=null && !r.assignedPart);
    pool.sort((a,b) => (a.sortNumber - b.sortNumber) || String(a.label).localeCompare(b.label));
    for (let i=0; i<pool.length;) {
      const intVal = Math.floor(pool[i].sortNumber);
      let j=i; while (j<pool.length && Math.floor(pool[j].sortNumber)===intVal) j++;
      const group = pool.slice(i,j);
      group.forEach((r,k)=> r.sortNumber = Number((intVal + (k+1)/10).toFixed(2)));
      i=j;
    }
    pool.sort((a,b)=> a.sortNumber - b.sortNumber);

    if (pool.length >= 1) pool[0].assignedPart = "1 Melody";
    if (pool.length >= 2) pool[pool.length-1].assignedPart = "6 Bass";

    const mids = pool.filter(r=>!r.assignedPart);
    const orderFirst4 = ["2 Harmony I","4 Counter Melody","3 Harmony II","5 Counter Melody Harmony"];
    mids.splice(0,4).forEach((r,i)=> r.assignedPart = orderFirst4[i]);

    const cycle = ["1 Melody","6 Bass","2 Harmony I","4 Counter Melody","3 Harmony II","5 Counter Melody Harmony"];
    for (let i=0;i<mids.length;i++) mids[i].assignedPart = cycle[i % cycle.length];

    const assignedResults = rows.map(r => ({
      name: r.label, baseName: r.base, instrumentPart: r.instrumentPart,
      assignedPart: r.assignedPart || "", sortNumber: r.sortNumber,
      sortingOctave: r.sortingOctave, clef: r.clef, transpose: r.transpose, scoreOrder: r.scoreOrder
    }));
    console.log(`[M1] assignParts: produced assignedResults = ${assignedResults.length}`);
    mergeState({ assignedResults });
    AA.emit("assign:done");
  }
})();

/* ============================================================================
   M2) groupAssignments — match assignedPart to extracted partName
   ---------------------------------------------------------------------------- */
(function(){
  AA.on("assign:done", () => AA.safe("groupAssignments", run));
  function run(){
    const s = getState();
    const parts = Array.isArray(s.parts) ? s.parts : [];
    const assigned = Array.isArray(s.assignedResults) ? s.assignedResults : [];
    console.log(`[M2] groupAssignments: parts=${parts.length}, assigned=${assigned.length}`);
    if (!parts.length || !assigned.length) return;

    const norm = x => String(x||"").toLowerCase().replace(/\s+/g," ").trim();
    const groups = parts.map(p => ({
      partName: p.partName, partId: p.id,
      instruments: assigned.filter(a => norm(a.assignedPart) === norm(p.partName))
    }));
    console.log(`[M2] groupAssignments: created groups = ${groups.length}`);
    mergeState({ groupedAssignments: groups });
    AA.emit("group:done");
  }
})();


/* ========================================================================
   GLOBAL XML HELPERS (idempotent) — needed by M3/M6
   ------------------------------------------------------------------------ */
window.ensureXmlHeader = window.ensureXmlHeader || function ensureXmlHeader(xmlString){
  const s = String(xmlString || "");
  if (/^\s*<\?xml\b/i.test(s)) return s;
  return `<?xml version="1.0" encoding="UTF-8"?>\n` + s;
};

window.ensureCombinedTitle = window.ensureCombinedTitle || function ensureCombinedTitle(xmlString, title){
  const t = String(title || "Auto Arranger Score");
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, "application/xml");
    const root = doc.querySelector("score-partwise, score-timewise") || doc.documentElement;

    // movement-title (OSMD also reads this)
    let mt = root.querySelector("movement-title");
    if (!mt) {
      mt = doc.createElement("movement-title");
      root.insertBefore(mt, root.firstChild);
    }
    mt.textContent = t;

    // work/work-title (standard)
    let work = root.querySelector("work");
    if (!work) {
      work = doc.createElement("work");
      // put before part-list if present, else as first child
      const pl = root.querySelector("part-list");
      if (pl) root.insertBefore(work, pl); else root.insertBefore(work, root.firstChild);
    }
    let wt = work.querySelector("work-title");
    if (!wt) { wt = doc.createElement("work-title"); work.appendChild(wt); }
    wt.textContent = t;

    return new XMLSerializer().serializeToString(doc);
  } catch {
    // If parsing fails, just prepend a title-ish credit is overkill; return original
    return xmlString;
  }
};


/* =========================================================================
   M3) arrangeGroupedParts — write names (long+short), clef, transpose
   ------------------------------------------------------------------------- */
(function () {
  AA.on("group:done", () => AA.safe("arrangeGroupedParts", run));

  function run() {
    const state  = getState();
    const parts  = Array.isArray(state.parts) ? state.parts : [];
    const groups = Array.isArray(state.groupedAssignments) ? state.groupedAssignments : [];

    if (!parts.length || !groups.length) {
      console.warn("[M3] nothing to do");
      return;
    }

    const byName = new Map(parts.map(p => [norm(p.partName), p]));
    const arranged = [];

    for (const grp of groups) {
      const src = byName.get(norm(grp.partName));
      if (!src) continue;

      for (const inst of (grp.instruments || [])) {
        try {
          // MISMATCH FIX: assignedResults gives us the instance label in `inst.name`
          const display = (inst.instanceLabel || inst.name || inst.baseName || "").trim() || "Part";

          const xml = arrangeXmlForInstrument(src.xml, {
            longName:  display,           // show “Violin 1”
            shortName: display,           // keep short name identical to avoid OSMD fallback
            clef:      inst.clef ?? null,
            transpose: inst.transpose ?? null
          });

          arranged.push({
            instrumentName: display,      // keep for M4/M6 enforcement
            baseName:       inst.baseName || inst.name || display,
            assignedPart:   inst.assignedPart,
            sourcePartId:   src.id,
            sourcePartName: src.partName,
            xml
          });
        } catch (e) {
          console.error(`[M3] transform failed for ${(inst.instanceLabel || inst.name || inst.baseName || "Part")}`, e);
        }
      }
    }

    console.log("[M3] arrangeGroupedParts: arranged files =", arranged.length);
    mergeState({ arrangedFiles: arranged, arrangeDone: true });
    AA.emit("arrange:done");
  }

  const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g," ").trim();

  function arrangeXmlForInstrument(singlePartXml, meta) {
    const { longName, shortName, clef, transpose } = meta;
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(singlePartXml, "application/xml");
    const root   = xmlDoc.documentElement;
    const ns     = root.namespaceURI || null;

    const ensure = (parent, tag) => {
      let el = parent.querySelector(tag);
      if (!el) { el = xmlDoc.createElementNS(ns, tag); parent.appendChild(el); }
      return el;
    };

    // (1) Write names into <score-part>
    const scorePart = xmlDoc.querySelector("score-part");
    if (scorePart) {
      const pn = ensure(scorePart, "part-name");
      pn.textContent = longName || "Part";
      pn.removeAttribute("print-object");

      const pa = ensure(scorePart, "part-abbreviation");
      pa.textContent = shortName || longName || "Part";
      pa.removeAttribute("print-object");

      // OSMD-visible display variants
      const pnd = ensure(scorePart, "part-name-display");
      pnd.textContent = "";
      const pndt = xmlDoc.createElementNS(ns, "display-text");
      pndt.textContent = longName || "Part";
      pnd.appendChild(pndt);

      const pad = ensure(scorePart, "part-abbreviation-display");
      pad.textContent = "";
      const padt = xmlDoc.createElementNS(ns, "display-text");
      padt.textContent = shortName || longName || "Part";
      pad.appendChild(padt);

      // score-instrument / instrument-name
      const partId = scorePart.getAttribute("id") || "P1";
      let si = scorePart.querySelector("score-instrument");
      if (!si) {
        si = xmlDoc.createElementNS(ns, "score-instrument");
        si.setAttribute("id", `${partId}-I1`);
        scorePart.appendChild(si);
      }
      let iname = si.querySelector("instrument-name");
      if (!iname) iname = xmlDoc.createElementNS(ns, "instrument-name");
      iname.textContent = longName || "Part";
      iname.removeAttribute("print-object");
      if (!si.contains(iname)) si.appendChild(iname);
    }

    // (2) Clef (optional)
    if (clef) {
      const firstClef = xmlDoc.querySelector("attributes > clef");
      if (firstClef) {
        while (firstClef.firstChild) firstClef.removeChild(firstClef.firstChild);
        const tpl = clef === "bass"
          ? `<sign>F</sign><line>4</line>`
          : (clef === "alto"
              ? `<sign>C</sign><line>3</line>`
              : `<sign>G</sign><line>2</line>`);
        const frag = parser.parseFromString(`<x>${tpl}</x>`, "application/xml");
        const x = frag.querySelector("x");
        while (x.firstChild) firstClef.appendChild(x.firstChild);
      }
    }

    // (3) Transpose (optional)
    xmlDoc.querySelectorAll("transpose").forEach(n => n.remove());
    if (transpose && typeof transpose === "string") {
      const tnode = parser.parseFromString(`<wrap>${transpose}</wrap>`, "application/xml").querySelector("transpose");
      if (tnode) {
        const attributes = xmlDoc.querySelector("attributes");
        if (attributes) {
          const key = attributes.querySelector("key");
          if (key && key.nextSibling) attributes.insertBefore(tnode.cloneNode(true), key.nextSibling);
          else attributes.appendChild(tnode.cloneNode(true));
        }
      }
    }

    // (4) Cleanup
    xmlDoc.querySelectorAll("lyric, harmony").forEach(n => n.remove());

    return new XMLSerializer().serializeToString(xmlDoc);
  }
})();





/* =========================================================================
   M4) renameParts — assert instance labels into each arranged single-part
   - Listens:  arrange:done
   - Emits:    rename:done
   - What it does:
       * Ensures <part-name>, <part-name-display>, <part-abbreviation>,
         <part-abbreviation-display>, and <instrument-name> all match
         the instrument instance label (e.g., "Violin 1").
       * This is a safety pass even if M3 already set names.
   ------------------------------------------------------------------------- */
(function(){
  AA.on("arrange:done", () => AA.safe("renameParts", run));

  function run(){
    const state = getState();
    const arranged = Array.isArray(state.arrangedFiles) ? state.arrangedFiles : [];
    if (!arranged.length) {
      console.warn("[M4] renameParts: no arranged files; skipping.");
      AA.emit("rename:done");
      return;
    }

    const out = [];
    for (const f of arranged) {
      try {
        out.push({ ...f, xml: enforceNamesOnSinglePart(f.xml, f.instrumentName) });
      } catch (e) {
        console.warn("[M4] renameParts: failed on", f.instrumentName, e);
        out.push(f); // keep original on failure
      }
    }

    mergeState({ arrangedFiles: out, renameDone: true });
    AA.emit("rename:done");
  }

  /* Ensure all visible names inside ONE single-part file equal `label` */
  function enforceNamesOnSinglePart(xmlString, label){
    const parser = new DOMParser();
    const doc    = parser.parseFromString(xmlString, "application/xml");
    const root   = doc.documentElement;
    const ns     = root.namespaceURI || null;

    const ensure = (parent, tag) => {
      let el = parent.querySelector(tag);
      if (!el) { el = doc.createElementNS(ns, tag); parent.appendChild(el); }
      return el;
    };

    const scorePart = doc.querySelector("score-part");
    if (scorePart) {
      // Long name
      const pn = ensure(scorePart, "part-name");
      pn.textContent = label;
      pn.removeAttribute("print-object");

      // Short name (use same label to avoid OSMD fallback)
      const pa = ensure(scorePart, "part-abbreviation");
      pa.textContent = label;
      pa.removeAttribute("print-object");

      // Display variants
      const pnd = ensure(scorePart, "part-name-display");
      pnd.textContent = "";
      const pndt = doc.createElementNS(ns, "display-text");
      pndt.textContent = label;
      pnd.appendChild(pndt);

      const pad = ensure(scorePart, "part-abbreviation-display");
      pad.textContent = "";
      const padt = doc.createElementNS(ns, "display-text");
      padt.textContent = label;
      pad.appendChild(padt);

      // score-instrument / instrument-name
      const partId = scorePart.getAttribute("id") || "P1";
      let si = scorePart.querySelector("score-instrument");
      if (!si) {
        si = doc.createElementNS(ns, "score-instrument");
        si.setAttribute("id", `${partId}-I1`);
        scorePart.appendChild(si);
      }
      let iname = si.querySelector("instrument-name");
      if (!iname) iname = doc.createElementNS(ns, "instrument-name");
      iname.textContent = label;
      iname.removeAttribute("print-object");
      if (!si.contains(iname)) si.appendChild(iname);
    }

    return new XMLSerializer().serializeToString(doc);
  }
})();



/* ============================================================================
   M5) reassignPartIdsByScoreOrder — P1..Pn by scoreOrder (with dup decimals)
   ---------------------------------------------------------------------------- */
(function(){
  AA.on("rename:done", () => AA.safe("reassignPartIdsByScoreOrder", run));
  const FALLBACK_ORDER = {
    "Piccolo": 1, "Flute": 2, "Oboe": 3, "Bb Clarinet": 4, "Bassoon": 5,
    "Violin": 6, "Viola": 7, "Cello": 8, "Double Bass": 9
  };

  function run(){
    const s = getState();
    const arranged = Array.isArray(s.arrangedFiles) ? s.arrangedFiles : [];
    console.log(`[M5] reassignPartIdsByScoreOrder: arranged files = ${arranged.length}`);
    if (!arranged.length) { console.log("[M5] Nothing to re-ID — aborting."); return; }

    const baseOrder = new Map();
    const selections = Array.isArray(s.instrumentSelections) ? s.instrumentSelections : [];
    for (const x of selections) if (x?.name && Number.isFinite(+x.scoreOrder)) baseOrder.set(String(x.name), +x.scoreOrder);
    for (const [k,v] of Object.entries(FALLBACK_ORDER)) if (!baseOrder.has(k)) baseOrder.set(k,v);

    const rows = arranged.map(f => {
      const base = String(f.baseName || f.instrumentName).replace(/\s+\d+$/,"");
      const baseVal = baseOrder.get(base);
      const m = String(f.instrumentName).match(/\s+(\d+)$/);
      const idx = m ? parseInt(m[1],10) : 0;
      const eff = (Number.isFinite(baseVal)? baseVal : 999) + (idx>0 ? idx/10 : 0);
      return { f, effOrder: eff };
    }).sort((a,b)=> a.effOrder - b.effOrder);

    for (let i=0;i<rows.length;i++){
      const file = rows[i].f;
      const newId = `P${i+1}`;
      const oldId = extractPid(file.xml);
      if (!oldId) continue;
      file.xml = file.xml.split(oldId).join(newId);
      file.newPartId = newId;
    }
    console.log(`[M5] reassignPartIdsByScoreOrder: assigned IDs 1..${rows.length}`);
    mergeState({ arrangedFiles: arranged, reassignByScoreDone: true });
    AA.emit("reid:done");
  }

  function extractPid(xml){
    const m = String(xml||"").match(/<score-part\s+id="([^"]+)"/i);
    return m ? m[1] : null;
  }
})();

/* =========================================================================
   M6) combineArrangedParts — merge & adopt front-matter from source
   ------------------------------------------------------------------------- */
(function(){
  AA.on("reid:done", () => AA.safe("combineArrangedParts", run));

  function run(){
    const s = getState();
    const files = Array.isArray(s.arrangedFiles) ? s.arrangedFiles : [];
    if (!files.length) { console.warn("[M6] combineArrangedParts: no files; skipping."); return; }

    // 0) Harvest front-matter (title, subtitle, composer/arranger) from a source part
    const fm = harvestFrontMatter(Array.isArray(s.parts)? s.parts: [], s);

    // 1) Apply FM to each single-part (label: "Part")
    const singles = files.map(f => {
      try { return { ...f, xml: applyFrontMatter(f.xml, fm, /*isScore*/false) }; }
      catch(e){ console.warn("[M6] single-part FM failed", e); return f; }
    });

    // 2) Order by P#
    const rows = [];
    for (const f of singles) {
      const pid = f.newPartId || pidFromXml(f.xml);
      if (!pid) continue;
      const n = parseInt(String(pid).replace(/^P/i,''),10);
      rows.push({ f, partId: pid, partNum: Number.isFinite(n)?n:999 });
    }
    rows.sort((a,b)=> (a.partNum-b.partNum) || String(a.partId).localeCompare(String(b.partId)));
    if (!rows.length) return;

    // 3) Merge into a combined score
    let combined = rows[0].f.xml.replace(/<\/score-partwise>\s*$/i,"");
    for (let i=1;i<rows.length;i++){
      const { f, partId } = rows[i];
      const xml = f.xml;
      const sp = block(xml, `<score-part\\s+id="${esc(partId)}"`, `</score-part>`);
      if (sp){
        const plEnd = combined.lastIndexOf("</part-list>");
        if (plEnd !== -1) combined = combined.slice(0,plEnd) + "\n" + sp + "\n" + combined.slice(plEnd);
      }
      const part = block(xml, `<part\\s+id="${esc(partId)}"`, `</part>`);
      if (part){
        const rootEnd = combined.lastIndexOf("</score-partwise>");
        if (rootEnd !== -1) combined = combined.slice(0,rootEnd) + "\n" + part + "\n" + combined.slice(rootEnd);
        else combined += "\n" + part;
      }
    }
    if (!/<\/score-partwise>\s*$/i.test(combined)) combined += "\n</score-partwise>";

    // 4) Apply FM to the combined (label: "Score")
    combined = applyFrontMatter(combined, fm, /*isScore*/true);

    // Debug tap (safe): combined part-list
    try {
      const m = String(combined||"").match(/<part-list[\s\S]*?<\/part-list>/i);
      console.log("%c[M6][DEBUG] Combined <part-list> →","color:#0aa","\n",m?m[0]:"(none)");
    } catch {}

    mergeState({ arrangedFiles: singles, combinedScoreXml: combined, combineDone:true });
    console.log("[M6] combineArrangedParts: combined score built.");
    AA.emit("combine:done");
  }

  /* ---------- harvest ---------- */
  function harvestFrontMatter(parts, s){
    const out = { title:"", subtitle:"", composer:"", arranger:"" };
    const parser = new DOMParser();
    const sample = parts.find(p => /<credit\b|<movement-title>|<work-title>|<identification>/i.test(p.xml)) || parts[0];
    if (!sample) return out;

    try {
      const doc = parser.parseFromString(sample.xml, "application/xml");

      // Prefer movement-title/work-title
      const mt = doc.querySelector("movement-title")?.textContent?.trim() || "";
      const wt = doc.querySelector("work > work-title")?.textContent?.trim() || "";
      if (mt) out.title = mt; else if (wt) out.title = wt;

      // If no title yet, heuristically promote the first centered credit to title
      if (!out.title) {
        const centered = Array.from(doc.querySelectorAll('credit > credit-words[justify="center"]'))
          .map(n => (n.textContent||"").trim())
          .filter(t => t && !/^score$/i.test(t) && !/^part$/i.test(t));
        if (centered[0]) out.title = centered[0];
        if (centered[1]) out.subtitle = centered[1];
      }

      // Subtitle from an explicit credit-type if present (overrides heuristic)
      const sub = Array.from(doc.querySelectorAll("credit"))
        .find(c => (c.querySelector("credit-type")?.textContent||"").trim().toLowerCase()==="subtitle");
      if (sub) out.subtitle = sub.querySelector("credit-words")?.textContent?.trim() || out.subtitle;

      // People from identification (use as-is; do NOT add prefixes)
      const creators = Array.from(doc.querySelectorAll("identification > creator"));
      out.composer = creators.find(n => (n.getAttribute("type")||"").toLowerCase()==="composer")?.textContent?.trim() || "";
      out.arranger = creators.find(n => (n.getAttribute("type")||"").toLowerCase()==="arranger")?.textContent?.trim() || "";
    } catch(e){
      console.warn("[M6] harvestFrontMatter: parse failed", e);
    }

    // Final fallbacks
    if (!out.title) out.title = s?.selectedSong?.name || s?.song || "";
    if (!out.arranger) out.arranger = "Auto Arranger";
    return out;
  }

  /* ---------- apply to a document ---------- */
   function applyFrontMatter(xmlString, fm, isScore){
    try{
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlString, "application/xml");
      const root = doc.documentElement;
      const ns = root.namespaceURI || null;

      const ensure = (parent, tag) => {
        let el = parent.querySelector(tag);
        if (!el) { el = doc.createElementNS(ns, tag); parent.appendChild(el); }
        return el;
      };

      // (A) Title: prefer the source's title; don't inject filename
      if (fm.title) {
        // keep movement-title as the main heading (what OSMD uses)
        let mt = doc.querySelector("movement-title");
        if (!mt) {
          mt = doc.createElementNS(ns, "movement-title");
          root.insertBefore(mt, root.firstChild);
        }
        mt.textContent = fm.title;
      }

      // (B) Identification: keep composers; ensure arranger exists, but
      // OSMD will only render arranger if a credit exists too (handled below).
      let id = doc.querySelector("identification");
      if (!id) { id = doc.createElementNS(ns, "identification"); root.appendChild(id); }
      if (fm.arranger && !id.querySelector('creator[type="arranger"]')) {
        const arr = doc.createElementNS(ns, "creator");
        arr.setAttribute("type","arranger");
        arr.textContent = fm.arranger;
        id.appendChild(arr);
      }

      // (C) Credits: remove previous versions of the three we control
      doc.querySelectorAll("credit").forEach(cr => {
        const t = (cr.querySelector("credit-type")?.textContent || "").toLowerCase().trim();
        if (t === "subtitle" || t === "arranger" || t === "part name" || t === "label") {
          cr.remove();
        }
      });

      // helper to create a credit quickly
      function addCredit(type, text, { justify, halign, valign } = {}){
        const credit = doc.createElementNS(ns, "credit");
        credit.setAttribute("page","1");
        const words = doc.createElementNS(ns, "credit-words");
        words.textContent = text;
        if (justify) words.setAttribute("justify", justify);
        if (halign)  words.setAttribute("halign",  halign);
        if (valign)  words.setAttribute("valign",  valign);
        const ctype = doc.createElementNS(ns, "credit-type");
        ctype.textContent = type;
        credit.appendChild(ctype);
        credit.appendChild(words);
        // put near top of score (before part-list is fine)
        const before = root.querySelector("part-list") || root.firstChild;
        root.insertBefore(credit, before);
      }

      // Left corner label (exact Finale credit-type name)
      addCredit("part name", isScore ? "Score" : "Part", { justify:"left", halign:"left", valign:"top" });

      // Subtitle (centered) — only if we have one
      if (fm.subtitle) addCredit("subtitle", fm.subtitle, { justify:"center", halign:"center", valign:"top" });

      // Arranger (right) — OSMD needs a credit for this to appear
      if (fm.arranger) addCredit("arranger", fm.arranger, { justify:"right", halign:"right", valign:"top" });

      return new XMLSerializer().serializeToString(doc);
    } catch(e){
      console.warn("[M6] applyFrontMatter failed", e);
      return xmlString;
    }
  }

  /* ---------- utils ---------- */
  function pidFromXml(xml){ const m = String(xml||"").match(/<score-part\s+id="([^"]+)"/i); return m ? m[1] : null; }
  function esc(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function block(xml, startRe, endTag){
    const re = new RegExp(`${startRe}[\\s\\S]*?${endTag}`, "i");
    const m  = String(xml).match(re);
    return m ? m[0] : null;
  }
})();







/* =========================================================================
   M7) Final Viewer — dropdown lists all parts; ensure title; ensure XML prolog
   ------------------------------------------------------------------------- */
;(function () {
  AA.on("credits:done", () => AA.safe("finalViewer", bootWhenReady));

  async function bootWhenReady() {
    if (document.getElementById('aa-viewer')) return;
    await ensureLib("opensheetmusicdisplay", "./opensheetmusicdisplay.min.js");
    await ensureLib("html2canvas", "./html2canvas.min.js");
    await ensureLib("jspdf", "./jspdf.umd.min.js");
    buildViewerUI();
  }

  function ensureLib(globalName, src) {
    return new Promise(function(resolve){
      if (lookupGlobal(globalName)) return resolve(true);
      var script = document.createElement("script");
      script.src = src;
      script.onload = function(){ resolve(true); };
      script.onerror = function(){ console.warn("[finalViewer] Failed to load " + src); resolve(false); };
      document.head.appendChild(script);
    });
  }
  function lookupGlobal(name) {
    return name.split(".").reduce(function(o,k){ return (o && o[k]!=null ? o[k] : null); }, window);
  }

  function buildViewerUI() {
    Array.prototype.forEach.call(document.querySelectorAll('#aa-viewer'), function(n){ n.remove(); });

    var state = getState();
    var songName = (state && state.selectedSong && state.selectedSong.name) || state.song || "Auto Arranger Result";
    var partsRaw = Array.isArray(state.arrangedFiles) ? state.arrangedFiles : [];
    var hasScore = (typeof state.combinedScoreXml === "string" && state.combinedScoreXml.length > 0);
    var parts = sortPartsEvenIfNoPid(partsRaw);

    var wrap = ce("div");
    wrap.id = "aa-viewer";
    wrap.style.cssText =
      "position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;height:100vh;" +
      "background:rgba(0,0,0,0.08);padding:28px;box-sizing:border-box;overflow:hidden;";

    var backBtn = ce("button");
    backBtn.textContent = "← Back";
    backBtn.title = "Back to instrument selection";
    backBtn.style.cssText = "position:absolute;top:16px;left:16px;padding:8px 12px;border-radius:8px;border:none;" +
                            "background:#e5e7eb;color:#111;font:600 13px system-ui;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.06)";
    backBtn.addEventListener("click", function(){ backToInstrumentSelection(state); });
    wrap.appendChild(backBtn);

    var card = ce("div");
    card.style.cssText =
      "margin:auto;width:min(1200px,100%);height:calc(100vh - 56px);background:#fff;border-radius:14px;" +
      "box-shadow:0 12px 36px rgba(0,0,0,.18);padding:20px 20px 18px;box-sizing:border-box;display:flex;" +
      "flex-direction:column;gap:10px;overflow:hidden;";
    wrap.appendChild(card);

    var controls = ce("div");
    controls.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:8px;margin-top:2px;";
    card.appendChild(controls);

    var label = ce("div", { textContent: "Select Score or Part" });
    label.style.cssText = "color:#000;font:600 13px/1 system-ui;";
    controls.appendChild(label);

    var select = ce("select");
    select.id = "aa-viewer-select";
    select.style.cssText = "padding:8px 10px;font:14px system-ui;";
    if (hasScore) select.appendChild(new Option("Score","__SCORE__"));
    for (var i=0;i<parts.length;i++){
      var p = parts[i];
      var optLabel = p.instrumentName || p.baseName || "Part";
      select.appendChild(new Option(optLabel, optLabel));
    }
    controls.appendChild(select);

    var btnRow = ce("div");
    btnRow.style.cssText = "display:flex;gap:8px;flex-wrap:nowrap;justify-content:center;align-items:center;";
    btnRow.innerHTML =
      '<button id="aa-btn-visualize" class="aa-btn">Visualize</button>' +
      '<button id="aa-btn-pdf" class="aa-btn" disabled>Download PDF</button>' +
      '<button id="aa-btn-xml" class="aa-btn" disabled>Download XML</button>' +
      '<button id="aa-btn-pdf-all" class="aa-btn">Download PDF All Parts</button>' +
      '<button id="aa-btn-xml-all" class="aa-btn">Download XML ALL Parts</button>';
    controls.appendChild(btnRow);

    var styleBtn = ce("style");
    styleBtn.textContent =
      ".aa-btn{padding:8px 12px;border-radius:8px;background:#0f62fe;color:#fff;border:none;cursor:pointer;font:600 13px system-ui}" +
      ".aa-btn[disabled]{opacity:.5;cursor:not-allowed}.aa-btn:hover:not([disabled]){filter:brightness(0.92)}";
    card.appendChild(styleBtn);

    var osmdBox = ce("div");
    osmdBox.id = "aa-osmd-box";
    osmdBox.style.cssText =
      "margin-top:8px;border:1px solid #e5e5e5;border-radius:10px;background:#fff;padding:14px;" +
      "flex:1 1 auto;min-height:0;overflow-y:hidden;overflow-x:auto;white-space:nowrap;";
    card.appendChild(osmdBox);
    document.body.appendChild(wrap);

    var OSMD = lookupGlobal("opensheetmusicdisplay");
    var osmd = new OSMD.OpenSheetMusicDisplay(osmdBox, { autoResize:true, backend:"svg", drawingParameters:"default" });
    window.addEventListener("resize", function(){ fitScoreToHeight(osmd, osmdBox); });

    var btnVis    = btnRow.querySelector("#aa-btn-visualize");
    var btnPDF    = btnRow.querySelector("#aa-btn-pdf");
    var btnXML    = btnRow.querySelector("#aa-btn-xml");
    var btnPDFAll = btnRow.querySelector("#aa-btn-pdf-all");
    var btnXMLAll = btnRow.querySelector("#aa-btn-xml-all");

    var lastXml = "";

    btnVis.addEventListener("click", function(){
      var picked = pickXml(select.value);
      var xml = picked.xml;
      if (!xml) { alert("No XML found to visualize."); return; }
      (async function(){
        try{
          lastXml = ensureTitle(xml, songName);
          var processed = transformXmlForSlashes(lastXml);
          var osmdReady = withXmlProlog(processed);
          if (typeof osmd.zoom === "number") osmd.zoom = 1.0;
          await osmd.load(osmdReady);
          await osmd.render();
          await new Promise(function(r){ requestAnimationFrame(r); });
          fitScoreToHeight(osmd, osmdBox);
          btnPDF.disabled = false; btnXML.disabled = false;
        } catch(e){
          console.error("[finalViewer] render failed", e);
          alert("Failed to render this selection.");
        }
      })();
    });

    btnPDF.addEventListener("click", function(){
      if (!lastXml) { alert("Load a score/part first."); return; }
      var base = (select.value === "__SCORE__" ? "Score" : select.value);
      exportCurrentViewToPdf(osmdBox, base);
    });

    btnXML.addEventListener("click", function(){
      if (!lastXml) { alert("Load a score/part first."); return; }
      var name = (select.value === "__SCORE__" ? "Score" : select.value) || "part";
      downloadText(lastXml, safe(name) + ".musicxml", "application/xml");
    });

    btnPDFAll.addEventListener("click", function(){
      var partsNow = sortPartsEvenIfNoPid(Array.isArray(getState().arrangedFiles)?getState().arrangedFiles:[]);
      if (!partsNow.length) { alert("No parts found."); return; }
      (async function(){
        var jspdfNS = window.jspdf || (window.jspdf && window.jspdf.jsPDF ? window.jspdf : window);
        var JsPDFCtor = jspdfNS.jsPDF || jspdfNS.JSPDF || jspdfNS.jsPDFConstructor;
        if (!JsPDFCtor) { alert("jsPDF not available."); return; }
        var docName = safe(songName) + " - All Parts.pdf";
        var doc = null;
        for (var i=0;i<partsNow.length;i++){
          var p = partsNow[i];
          try{
            var processed = transformXmlForSlashes(ensureTitle(p.xml, p.instrumentName));
            var osmdReady = withXmlProlog(processed);
            await osmd.load(osmdReady);
            await osmd.render();
            var snap = await snapshotCanvas(osmdBox);
            var w = snap.w, h = snap.h, canvas = snap.canvas;
            if (!doc) doc = new JsPDFCtor({ orientation: w>=h?"landscape":"portrait", unit:"pt", format:[w,h] });
            else doc.addPage([w,h], w>=h?"landscape":"portrait");
            doc.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, w, h);
          }catch(e){ console.error("[finalViewer] PDF all parts failed on", p.instrumentName, e); }
        }
        if (doc) doc.save(docName);
      })();
    });

    btnXMLAll.addEventListener("click", function(){
      var partsNow = sortPartsEvenIfNoPid(Array.isArray(getState().arrangedFiles)?getState().arrangedFiles:[]);
      if (!partsNow.length) { alert("No parts found."); return; }
      (async function(){
        for (var i=0;i<partsNow.length;i++){
          var p = partsNow[i];
          downloadText(ensureTitle(p.xml, p.instrumentName), safe(p.instrumentName || "Part") + ".musicxml", "application/xml");
          await new Promise(function(r){ setTimeout(r,60); });
        }
      })();
    });

    function pickXml(choice){
      var s = getState();
      if (choice === "__SCORE__") return { xml: s.combinedScoreXml || "" };
      var list = Array.isArray(s.arrangedFiles) ? s.arrangedFiles : [];
      var hit = list.find(function(f){ return (f.instrumentName || f.baseName) === choice; });
      return { xml: (hit && hit.xml) || "" };
    }
  }

  /* viewer helpers */
  function sortPartsEvenIfNoPid(files){
    var out = [];
    for (var i=0;i<files.length;i++){
      var f = files[i];
      var pid = f.newPartId || extractPidFromXml(f.xml) || "";
      var n = parseInt(String(pid).replace(/^P/i,""), 10);
      out.push(Object.assign({}, f, { _pnum: (isFinite(n)?n:999) }));
    }
    out.sort(function(a,b){
      if (a._pnum !== b._pnum) return a._pnum - b._pnum;
      return String(a.instrumentName||"").localeCompare(String(b.instrumentName||""));
    });
    return out;
  }
  function extractPidFromXml(xml){
    var m = String(xml||"").match(/<score-part\s+id="([^"]+)"/i);
    return m ? m[1] : null;
  }
  function snapshotCanvas(container){
    return html2canvas(container, { scale:2, backgroundColor:"#fff" })
           .then(function(canvas){ return {canvas:canvas, w:canvas.width, h:canvas.height}; });
  }
  async function exportCurrentViewToPdf(container, baseName){
    var snap = await snapshotCanvas(container);
    var w = snap.w, h = snap.h, canvas = snap.canvas;
    var jspdfNS = window.jspdf || (window.jspdf && window.jspdf.jsPDF ? window.jspdf : window);
    var JsPDFCtor = jspdfNS.jsPDF || jspdfNS.JSPDF || jspdfNS.jsPDFConstructor;
    if (!JsPDFCtor) { alert("jsPDF not loaded."); return; }
    var pdf = new JsPDFCtor({ orientation: w>=h?"landscape":"portrait", unit:"pt", format:[w,h] });
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, w, h);
    pdf.save(safe(baseName || "score") + ".pdf");
  }
  function backToInstrumentSelection(prevState){
    var packName = (prevState && (prevState.pack || (prevState.selectedPack && prevState.selectedPack.name))) || "";
    var songName = (prevState && (prevState.song || (prevState.selectedSong && prevState.selectedSong.name))) || "";
    setState({ pack: packName, song: songName, packIndex: getState().packIndex, songIndex: getState().songIndex, timestamp: Date.now() });
    Array.prototype.forEach.call(document.querySelectorAll('#aa-viewer'), function(n){ n.remove(); });
    hideArrangingLoading();
    qs("step1") && qs("step1").classList.add("hidden");
    qs("step2") && qs("step2").classList.add("hidden");
    qs("step3") && qs("step3").classList.remove("hidden");
  }
  function fitScoreToHeight(osmd, host){
    var svg = host.querySelector("svg"); if (!svg) return;
    var maxH = host.clientHeight; if (!maxH) return;
    var svgH = 0; try { svgH = svg.getBBox().height; } catch(e){}
    if (!svgH) svgH = svg.clientHeight || svg.scrollHeight || svg.offsetHeight || 0;
    if (!svgH) return;
    var current = (typeof osmd.zoom === "number") ? osmd.zoom : 1;
    var target = Math.min(current, maxH / svgH);
    if (!isFinite(target) || target <= 0) target = 1;
    target = Math.max(0.3, Math.min(1.5, target));
    if (Math.abs(target - current) > 0.01) { osmd.zoom = target; osmd.render(); }
  }

  // --- XML utilities for OSMD ---
  function ensureTitle(xmlString, title){
    try {
      var parser = new DOMParser();
      var doc = parser.parseFromString(xmlString, "application/xml");
      var hasMovement = !!doc.querySelector("movement-title");
      var hasWork = !!doc.querySelector("work > work-title");
      if (!hasMovement && !hasWork) {
        var root = doc.querySelector("score-partwise, score-timewise") || doc.documentElement;
        var mv = doc.createElement("movement-title"); mv.textContent = title || "Auto Arranger Score";
        root.insertBefore(mv, root.firstChild);
      }
      return new XMLSerializer().serializeToString(doc);
    } catch (e) { return xmlString; }
  }
  function transformXmlForSlashes(xmlString) {
    try {
      var parser = new DOMParser();
      var xmlDoc = parser.parseFromString(xmlString, "application/xml");
      xmlDoc.querySelectorAll("lyric").forEach(function(n){ n.remove(); });
      return new XMLSerializer().serializeToString(xmlDoc);
    } catch (e) { return xmlString; }
  }
  function withXmlProlog(str){
    if (!str) return str;
    var s = String(str).replace(/^\uFEFF/, "").replace(/^\s+/, "");
    if (!/^\<\?xml/i.test(s)) s = '<?xml version="1.0" encoding="UTF-8"?>\n' + s;
    return s;
  }

  // --- file helpers ---
  function safe(name){
    return String(name || "")
      .replace(/[\\\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, " ")
      .trim();
  }
  function downloadText(text, filename, mimetype){
    try{
      var blob = new Blob([text], { type: mimetype || "application/octet-stream" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = filename || "download.txt";
      document.body.appendChild(a); a.click();
      setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 50);
    } catch(e){ console.warn("downloadText failed", e); }
  }

  function ce(tag, props){
    var el = document.createElement(tag);
    if (props) Object.assign(el, props);
    return el;
  }
})();

/* =========================================================================
   M8) applyCredits — normalize/clone credits & set OSMD header
   - Listens:  combine:done
   - Emits:    credits:done
   ------------------------------------------------------------------------- */
;(function(){
  var DEBUG_CREDITS = true; // flip to false to silence logs

  AA.on("combine:done", function(){ AA.safe("applyCredits", run); });

  function run(){
    var s = getState();
    var partsSrc = Array.isArray(s.parts) ? s.parts : [];
    var arranged = Array.isArray(s.arrangedFiles) ? s.arrangedFiles : [];
    var combined = s.combinedScoreXml || "";

    if (!combined || !arranged.length){
      console.warn("[M8] nothing to do (no combined or no arranged files).");
      AA.emit("credits:done");
      return;
    }

    // Use first original part if present; otherwise use the combined as source
    var baseXml = (partsSrc[0] && partsSrc[0].xml) || combined;
    var snap = snapshotCredits(baseXml);

    if (DEBUG_CREDITS) console.log("[M8] FINAL snapshot:", JSON.stringify(snap));

    // Apply to combined (label = "Score")
    combined = applyCreditsToDoc(combined, snap, "Score");

    // Apply to each arranged part (label = instrument name)
    var updated = arranged.map(function(f){
      var label = f.instrumentName || f.baseName || "Part";
      return Object.assign({}, f, { xml: applyCreditsToDoc(f.xml, snap, label) });
    });

    mergeState({ combinedScoreXml: combined, arrangedFiles: updated, creditsDone: true });
    AA.emit("credits:done");
  }

  /* ---------------- snapshot (read) ---------------- */

  function snapshotCredits(xmlString){
    var out = {
      titleText: "",        // for big line (work/work-title) + credit "title"
      subtitleText: "",     // for small line (movement-title) + credit "subtitle"
      composerText: "",     // credit "composer"
      arrangerText: ""      // credit "arranger"
    };
    try{
      var p   = new DOMParser();
      var doc = p.parseFromString(xmlString, "application/xml");

      function firstCredit(type){
        var hit = null;
        doc.querySelectorAll("credit").forEach(function(c){
          if (hit) return;
          var t = (c.querySelector("credit-type") && c.querySelector("credit-type").textContent || "")
                    .toLowerCase().trim();
          if (t === type) hit = (c.querySelector("credit-words") && c.querySelector("credit-words").textContent || "").trim();
        });
        return hit || "";
      }

      // Title: prefer <credit type="title">, then <movement-title>, then work/work-title
      out.titleText =
        firstCredit("title") ||
        (doc.querySelector("movement-title") && doc.querySelector("movement-title").textContent.trim()) ||
        (doc.querySelector("work > work-title") && doc.querySelector("work > work-title").textContent.trim()) ||
        "";

      // Subtitle: prefer <credit type="subtitle">
      out.subtitleText = firstCredit("subtitle") || "";

      // Composer / Arranger: prefer credit blocks, else identification creators
      out.composerText =
        firstCredit("composer") ||
        (doc.querySelector('identification > creator[type="composer"]') && doc.querySelector('identification > creator[type="composer"]').textContent.trim()) ||
        "";

      out.arrangerText =
        firstCredit("arranger") ||
        (doc.querySelector('identification > creator[type="arranger"]') && doc.querySelector('identification > creator[type="arranger"]').textContent.trim()) ||
        "";

      if (DEBUG_CREDITS){
        console.log("[M8] sourceOf:", {
          titleFromCredit: !!firstCredit("title"),
          subtitleFromCredit: !!firstCredit("subtitle"),
          composerFromCredit: !!firstCredit("composer"),
          arrangerFromCredit: !!firstCredit("arranger")
        });
      }
    }catch(e){
      console.warn("[M8] snapshotCredits failed", e);
    }
    return out;
  }

  /* ---------------- apply (write) ---------------- */

  function applyCreditsToDoc(xmlString, snap, partName){
    try{
      var p   = new DOMParser();
      var doc = p.parseFromString(xmlString, "application/xml");
      var root= doc.documentElement;

      // Remove only the types we control (avoid duplicate stacks)
      root.querySelectorAll("credit").forEach(function(c){
        var t = (c.querySelector("credit-type") && c.querySelector("credit-type").textContent || "").toLowerCase().trim();
        if (t==="title" || t==="subtitle" || t==="composer" || t==="arranger" || t==="part name" || t==="aa-partlabel") c.remove();
      });

      // Insert before <part-list> (matches your originals)
      function beforePartList(node){
        var pl = root.querySelector("part-list");
        if (pl) root.insertBefore(node, pl); else root.appendChild(node);
      }

      // Layout from <defaults><page-layout> with robust fallbacks
      var layout = readLayout(doc);
      if (DEBUG_CREDITS) console.log("[M8] layout:", layout);

      // Center stack: Title (big), Subtitle (smaller)
      if (snap.titleText)    beforePartList(makeCredit(doc, "title",    snap.titleText,    layout, "center",  0, 21.6));
      if (snap.subtitleText) beforePartList(makeCredit(doc, "subtitle", snap.subtitleText, layout, "center", 70, 16.2));

      // Right column: Arranger ABOVE Composer to avoid first-system collisions
      if (snap.arrangerText) beforePartList(makeCredit(doc, "arranger", snap.arrangerText, layout, "right",  52, 10.8));
      if (snap.composerText) beforePartList(makeCredit(doc, "composer", snap.composerText, layout, "right",  90, 10.8));

      // Left label (Score / Part)
      if (partName)          beforePartList(makeCredit(doc, "part name", partName,         layout, "left",   20, 10.8));

      // OSMD header lines (CRITICAL mapping):
      //   BIG header  = work/work-title = Title
      //   small line  = movement-title  = Subtitle
      ensureHeaderTitles(doc, root, snap.titleText, snap.subtitleText);

      return new XMLSerializer().serializeToString(doc);
    }catch(e){
      console.warn("[M8] applyCreditsToDoc failed; returning original.", e);
      return xmlString;
    }
  }

  function ensureHeaderTitles(doc, root, titleText, subtitleText){
    // BIG line → work/work-title = Title
    var work = root.querySelector("work");
    if (!work){ work = doc.createElement("work"); root.insertBefore(work, root.firstChild); }
    var wt = work.querySelector("work-title");
    if (!wt){ wt = doc.createElement("work-title"); work.appendChild(wt); }
    wt.textContent = titleText || "";

    // Small line → movement-title = Subtitle (remove if empty)
    var mt = root.querySelector("movement-title");
    if (subtitleText){
      if (!mt){ mt = doc.createElement("movement-title"); root.insertBefore(mt, root.firstChild); }
      mt.textContent = subtitleText;
    } else if (mt){
      mt.remove();
    }

    if (DEBUG_CREDITS) console.log("[M8] header set:", { workTitle: wt && wt.textContent, movementTitle: subtitleText || "" });
  }

  /* ---------------- building blocks ---------------- */

  function readLayout(doc){
    // Defaults from your sample files (used if the XML lacks them)
    var dPageWidth  = 1923;
    var dPageHeight = 2489;
    var dLeft       = 226;
    var dRight      = 113;
    var dTop        = 113;

    function qNum(sel, def){
      var n = parseFloat((doc.querySelector(sel) && doc.querySelector(sel).textContent) || "");
      return isFinite(n) ? n : def;
    }

    var pageWidth  = qNum("defaults > page-layout > page-width",  dPageWidth);
    var pageHeight = qNum("defaults > page-layout > page-height", dPageHeight);

    // Prefer margins type="both", else take the first page-margins block
    var pmBoth = doc.querySelector('defaults > page-layout > page-margins[type="both"]') ||
                 doc.querySelector('defaults > page-layout > page-margins');
    var left  = dLeft, right = dRight, top = dTop;
    if (pmBoth){
      left  = qNum("left-margin",   dLeft);
      right = qNum("right-margin",  dRight);
      top   = qNum("top-margin",    dTop);
      // If we used qNum without a parent scope, re-resolve against pmBoth:
      function qNumLocal(q, def){
        var n = parseFloat((pmBoth.querySelector(q) && pmBoth.querySelector(q).textContent) || "");
        return isFinite(n) ? n : def;
      }
      left  = qNumLocal("left-margin",  left);
      right = qNumLocal("right-margin", right);
      top   = qNumLocal("top-margin",   top);
    }

    // Coordinates: top of page is near pageHeight; y decreases as we go down
    var baseY   = pageHeight - top;         // very top text baseline
    var leftX   = left;
    var rightX  = pageWidth - right;
    var centerX = Math.round(pageWidth / 2);

    return { pageWidth, pageHeight, left, right, top, baseY, leftX, rightX, centerX };
  }

  function makeCredit(doc, type, text, layout, anchor, offsetDown, sizePt){
    var credit = doc.createElement("credit");
    credit.setAttribute("page","1");

    var ct = doc.createElement("credit-type");
    ct.textContent = type;
    credit.appendChild(ct);

    var words = doc.createElement("credit-words");
    var x = layout.leftX;
    if (anchor === "center"){
      words.setAttribute("justify","center");
      words.setAttribute("halign","center");
      x = layout.centerX;
    } else if (anchor === "right"){
      words.setAttribute("justify","right");
      words.setAttribute("halign","right");
      x = layout.rightX;
    }
    var y = Math.round(layout.baseY - (offsetDown || 0));

    words.setAttribute("default-x", String(x));
    words.setAttribute("default-y", String(y));
    if (sizePt != null) words.setAttribute("font-size", String(sizePt));
    words.setAttribute("valign","top");
    words.textContent = text;

    credit.appendChild(words);

    if (DEBUG_CREDITS) console.log("[M8] add credit:", type, { anchor: anchor||"left", x: String(x), y: y, size: sizePt||"", text: text });
    return credit;
  }
})();




   

/* ============================================================================
   H1) Helper — ensure every XML we hand to OSMD starts with an XML header
   ---------------------------------------------------------------------------- */
function ensureXmlHeader(xml) {
  const s = String(xml || "").trimStart();
  return s.startsWith("<?xml") ? s : `<?xml version="1.0" encoding="UTF-8"?>\n${s}`;
}
