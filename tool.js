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

















