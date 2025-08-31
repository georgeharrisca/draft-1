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

  // Small local helper (fallback if no global escapeHtml)
  function escapeHtml(s){
    return String(s)
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&#39;");
  }

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
            <button id="btnBackToSong" class="aa-btn" type="button" style="background:#1a1f2a;border:1px solid var(--line);color:var(--text);">Back</button>
            <button id="btnAddInstrument" class="aa-btn" type="button">Add to Score</button>
          </div>
        </div>

        <!-- RIGHT: selections -->
        <div class="aa-pane">
          <h4>Selections</h4>
          <select id="selectionsList" size="14" style="width:100%;height:360px;"></select>
          <div style="display:flex; gap:10px; margin-top:10px;">
            <button id="btnRemoveSelected" class="aa-btn" type="button">Remove</button>
            <button id="btnSaveSelections" class="aa-btn aa-accent" type="button">Save Selections</button>
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

    // ---- natural sort helpers (Instrument 2 < Instrument 10) ----
    function parseLabel(str) {
      const m = String(str).match(/^(.*?)(?:\s+(\d+))?$/);
      return {
        base: (m && m[1] ? m[1] : str).trim(),
        num:  m && m[2] ? parseInt(m[2], 10) : 0
      };
    }
    function naturalLabelCompare(a, b) {
      const A = parseLabel(a), B = parseLabel(b);
      if (A.base !== B.base) return A.base.localeCompare(B.base);
      return A.num - B.num;
    }

    // Right list helpers
    function refreshRight(){
      const sorted = [...stateSel.selections].sort(naturalLabelCompare);
      listRight.innerHTML = sorted
        .map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`)
        .join("");
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

    // Buttons (direct bindings for add/back/remove)
    if (btnAdd) {
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
    }

    if (btnBack) {
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
    }

    if (btnRemove) {
      btnRemove.addEventListener("click", () => {
        const sel = listRight.value;
        if (!sel) return;
        removeSelection(sel);
      });
    }

    // ---- Delegated SAVE handler (survives rebuilds) ----
    container.addEventListener("click", (ev) => {
      const saveBtn = ev.target.closest("#btnSaveSelections");
      if (!saveBtn) return;
      ev.preventDefault();

      const s = getState();
      const metaIndex = Object.fromEntries((s.instrumentData||[]).map(m => [m.name, m]));
      const instrumentSelections = [...stateSel.selections]
        .sort(naturalLabelCompare)
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
      console.log(`[Step3] Saved ${instrumentSelections.length} selections`, instrumentSelections);
      AA.emit("instruments:saved");
    });

  } // end setupInstrumentPicker

  // Build on DOM ready + whenever we enter Step 3
  document.addEventListener("DOMContentLoaded", () => {
    // (we rebuild on stage change)
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
     M8) apply credits
     H1) helpers (OSMD header helper)
     M9) viewer enhancers
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



/* === H: XML helpers used by M7/M9 (idempotent) === */
(() => {
  // Only define if missing to avoid duplicates
  if (typeof window.ensureTitle !== "function") {
    window.ensureTitle = function ensureTitle(xmlString, title){
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlString, "application/xml");
        const hasMovement = !!doc.querySelector("movement-title");
        const hasWork = !!doc.querySelector("work > work-title");
        if (!hasMovement && !hasWork) {
          const root = doc.querySelector("score-partwise, score-timewise") || doc.documentElement;
          const mv = doc.createElement("movement-title");
          mv.textContent = title || "Auto Arranger Score";
          root.insertBefore(mv, root.firstChild);
        }
        return new XMLSerializer().serializeToString(doc);
      } catch {
        return xmlString;
      }
    };
  }

  if (typeof window.transformXmlForSlashes !== "function") {
    window.transformXmlForSlashes = function transformXmlForSlashes(xmlString) {
      try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlString, "application/xml");
        // (keep your current behavior: strip <lyric> to avoid OSMD lyric collisions)
        xmlDoc.querySelectorAll("lyric").forEach(n => n.remove());
        return new XMLSerializer().serializeToString(xmlDoc);
      } catch {
        return xmlString;
      }
    };
  }

  if (typeof window.withXmlProlog !== "function") {
    window.withXmlProlog = function withXmlProlog(str){
      if (!str) return str;
      let s = String(str).replace(/^\uFEFF/, "").replace(/^\s+/, "");
      if (!/^\<\?xml/i.test(s)) s = `<?xml version="1.0" encoding="UTF-8"?>\n` + s;
      return s;
    };
  }
})();




// --- overlay helper shim (define only if missing) ---------------------------
(function(){
  if (typeof window.getArrangerFromXml === "function") return;
  window.getArrangerFromXml = function(xmlString){
    try{
      const doc = new DOMParser().parseFromString(xmlString || "", "application/xml");
      // 1) credit/credit-type = arranger
      for (const c of doc.querySelectorAll("credit")) {
        const t = (c.querySelector("credit-type")?.textContent || "").toLowerCase().trim();
        if (t === "arranger") {
          const w = c.querySelector("credit-words");
          const txt = (w?.textContent || "").trim();
          if (txt) return txt;
        }
      }
      // 2) identification/creator[type=arranger]
      const fallback = doc.querySelector('identification > creator[type="arranger"]');
      const txt = (fallback?.textContent || "").trim();
      return txt || "Arranged by Auto Arranger";
    } catch (_) {
      return "Arranged by Auto Arranger";
    }
  };
})();



/* =========================================================================
   M7) Final Viewer
   ------------------------------------------------------------------------- */
;(function () {
  // Start viewer once combine is done
  AA.on("combine:done", () => AA.safe("finalViewer", bootWhenReady));

  async function bootWhenReady() {
    if (document.getElementById("aa-viewer")) return;
    await ensureLib("opensheetmusicdisplay", "./opensheetmusicdisplay.min.js");
    await ensureLib("html2canvas", "./html2canvas.min.js");
    await ensureLib("jspdf", "./jspdf.umd.min.js");
    await ensureLib("JSZip", "./jszip.min.js");
    buildViewerUI();
  }

  function ensureLib(globalName, src) {
    return new Promise((resolve) => {
      if (lookupGlobal(globalName)) return resolve(true);
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => resolve(true);
      s.onerror = () => { console.warn("[finalViewer] Failed to load", src); resolve(false); };
      document.head.appendChild(s);
    });
  }
  function lookupGlobal(name){
    return name.split(".").reduce((o,k)=> (o && o[k]!=null) ? o[k] : null, window);
  }

  function buildViewerUI(){
    // Remove any existing viewer
    document.querySelectorAll('#aa-viewer').forEach(n => n.remove());

    const state    = getState();
    const songName = (state && state.selectedSong && state.selectedSong.name) || state.song || "Auto Arranger Result";
    const partsRaw = Array.isArray(state.arrangedFiles) ? state.arrangedFiles : [];
    const hasScore = typeof state.combinedScoreXml === "string" && state.combinedScoreXml.length > 0;
    const parts    = sortPartsEvenIfNoPid(partsRaw);

    const cleanupFns = [];

    const wrap = ce("div");
    wrap.id = "aa-viewer";
    wrap.style.cssText = "position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;height:100vh;background:rgba(0,0,0,0.08);padding:28px;box-sizing:border-box;overflow:hidden;";

    const backBtn = ce("button");
    backBtn.textContent = "← Back";
    backBtn.title = "Back to instrument selection";
    backBtn.style.cssText = "position:absolute;top:16px;left:16px;padding:8px 12px;border-radius:8px;border:none;background:#e5e7eb;color:#111;font:600 13px system-ui;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.06)";
    backBtn.addEventListener("click", () => backToInstrumentSelection({ cleanupFns }));
    wrap.appendChild(backBtn);

    const card = ce("div");
    card.style.cssText = "margin:auto;width:min(1200px,100%);height:calc(100vh - 56px);background:#fff;border-radius:14px;box-shadow:0 12px 36px rgba(0,0,0,.18);padding:20px 20px 18px;box-sizing:border-box;display:flex;flex-direction:column;gap:10px;overflow:hidden;";
    wrap.appendChild(card);

    const title = ce("h2", { textContent: songName });
    title.style.cssText = "margin:0;text-align:center;color:#000;font:700 20px/1.2 system-ui,Arial";
    card.appendChild(title);

    const controls = ce("div");
    controls.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:8px;margin-top:2px;";
    card.appendChild(controls);

    const label = ce("div", { textContent: "Select Score or Part" });
    label.style.cssText = "color:#000;font:600 13px/1 system-ui;";
    controls.appendChild(label);

    const select = ce("select");
    select.id = "aa-viewer-select";
    select.style.cssText = "padding:8px 10px;font:14px system-ui;";
    if (hasScore) select.appendChild(new Option("Score","__SCORE__"));
    for (const p of parts) {
      const name = p.instrumentName || p.baseName || "Part";
      select.appendChild(new Option(name, name));
    }
    controls.appendChild(select);

    const btnRow = ce("div");
    btnRow.style.cssText = "display:flex;gap:8px;flex-wrap:nowrap;justify-content:center;align-items:center;";
    btnRow.innerHTML = [
      '<button id="aa-btn-pdf" class="aa-btn" disabled>Download PDF</button>',
      '<button id="aa-btn-xml" class="aa-btn" disabled>Download XML</button>',
      '<button id="aa-btn-pdf-all" class="aa-btn">Download PDF All Parts &amp; Score</button>',
      '<button id="aa-btn-xml-all" class="aa-btn">Download XML All Parts &amp; Score</button>'
    ].join("");
    controls.appendChild(btnRow);

    // Bars-per-system row (orange)
    const barRow = ce("div");
    barRow.style.cssText = "display:flex;gap:10px;flex-wrap:wrap;justify-content:center;align-items:center;margin-top:4px;";
    barRow.innerHTML = [
      '<span style="font:600 13px system-ui;color:#333;margin-right:6px;">Bars Per System:</span>',
      '<button class="aa-btn aa-btn-orange" data-bars="4">4 Bars</button>',
      '<button class="aa-btn aa-btn-orange" data-bars="8">8 Bars</button>',
      '<button class="aa-btn aa-btn-orange" data-bars="12">12 Bars</button>',
      '<button class="aa-btn aa-btn-orange" data-bars="16">16 Bars</button>'
    ].join("");
    controls.appendChild(barRow);

    const styleBtn = ce("style");
    styleBtn.textContent = `
      .aa-btn{padding:8px 12px;border-radius:8px;background:#0f62fe;color:#fff;border:none;cursor:pointer;font:600 13px system-ui}
      .aa-btn[disabled]{opacity:.5;cursor:not-allowed}
      .aa-btn:hover:not([disabled]){filter:brightness(0.92)}
      .aa-btn-orange{background:#ff7a00}
      .aa-btn-orange[data-active="1"]{box-shadow:0 0 0 2px #ff7a00 inset;background:#ff9a33}
    `;
    card.appendChild(styleBtn);

    const osmdBox = ce("div");
    osmdBox.id = "aa-osmd-box";
    // vertical fit, horizontal scroll
    osmdBox.style.cssText = "margin-top:8px;border:1px solid #e5e5e5;border-radius:10px;background:#fff;padding:14px;flex:1 1 auto;min-height:0;overflow-y:hidden;overflow-x:auto;white-space:nowrap;position:relative;";
    card.appendChild(osmdBox);
    document.body.appendChild(wrap);

    const OSMD = lookupGlobal("opensheetmusicdisplay");
    // Respect XML system/page breaks
    const osmd = new OSMD.OpenSheetMusicDisplay(osmdBox, {
      autoResize: true,
      backend: "svg",
      drawingParameters: "default",
      newSystemFromXML: true,
      newPageFromXML: true
    });

    const btnPDF    = btnRow.querySelector("#aa-btn-pdf");
    const btnXML    = btnRow.querySelector("#aa-btn-xml");
    const btnPDFAll = btnRow.querySelector("#aa-btn-pdf-all");
    const btnXMLAll = btnRow.querySelector("#aa-btn-xml-all");

    let lastXml = "";
    let overlayRaf = 0;
    let barsPerSystemChoice = 0; // 0 = Auto/off

    function setBarsActive(n){
      barsPerSystemChoice = Number(n)||0;
      barRow.querySelectorAll(".aa-btn-orange").forEach(b=>{
        b.dataset.active = (String(b.getAttribute("data-bars")) === String(barsPerSystemChoice)) ? "1" : "0";
      });
      console.log(`[M7] Bars per system set to ${barsPerSystemChoice || "Auto"}`);
    }

    const scheduleOverlay = () => {
      if (overlayRaf) cancelAnimationFrame(overlayRaf);
      overlayRaf = requestAnimationFrame(() => {
        overlayRaf = 0;
        if (!lastXml) return;
        const pickedLabel = (select.value === "__SCORE__" ? "Score" : select.value) || "";
        const arranger    = getArrangerFromXml(lastXml);
        overlayCredits(osmd, osmdBox, pickedLabel, arranger);
        ensureOverlayOnTop(osmdBox);
      });
    };
    cleanupFns.push(() => { if (overlayRaf) cancelAnimationFrame(overlayRaf); overlayRaf = 0; });

    const onResize = () => { fitScoreToHeight(osmd, osmdBox); scheduleOverlay(); };
    window.addEventListener("resize", onResize);
    cleanupFns.push(() => window.removeEventListener("resize", onResize));

    const ro = new ResizeObserver(() => { fitScoreToHeight(osmd, osmdBox); scheduleOverlay(); });
    ro.observe(osmdBox);
    cleanupFns.push(() => ro.disconnect());

    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "childList") {
          const added = [...m.addedNodes];
          if (added.some(n => n.nodeName === "SVG" || (n.querySelector && n.querySelector("svg")))) {
            forceIntrinsicSvgWidth(osmdBox);
            scheduleOverlay();
            return;
          }
        }
      }
    });
    mo.observe(osmdBox, { childList: true, subtree: true });
    cleanupFns.push(() => mo.disconnect());

    select.addEventListener("change", renderSelection);

    barRow.addEventListener("click", (ev) => {
      const b = ev.target.closest(".aa-btn-orange");
      if (!b) return;
      const n = Number(b.getAttribute("data-bars"))||0;
      setBarsActive(n);
      renderSelection();
    });

    async function renderSelection(){
      const { xml } = pickXml(select.value);
      if (!xml) {
        btnPDF.disabled = true; btnXML.disabled = true;
        lastXml = "";
        overlayCleanup(osmdBox);
        return;
      }
      try {
        let work = ensureTitle(xml, songName);
        work = transformXmlForSlashes(work);
        work = applyBarsPerSystem(work, barsPerSystemChoice);
        work = applyScalingForBars(work, barsPerSystemChoice);
        work = withXmlProlog(work);

        if (typeof osmd.zoom === "number") osmd.zoom = 1.0;
        await osmd.load(work);
        await osmd.render();
        await new Promise(r => requestAnimationFrame(r));
        fitScoreToHeight(osmd, osmdBox);   // vertical fit (90%)
        forceIntrinsicSvgWidth(osmdBox);   // keep intrinsic width → horizontal scroll
        lastXml = work;
        btnPDF.disabled = false;
        btnXML.disabled = false;
        scheduleOverlay();

        if (typeof AA !== "undefined" && AA.emit) {
          AA.emit("viewer:rendered", { osmd, host: osmdBox });
        }
      } catch(e){
        console.error("[finalViewer] render failed", e);
        alert("Failed to render this selection.");
      }
    }

    // Render first item immediately
    requestAnimationFrame(() => {
      if (select.options.length > 0) {
        select.selectedIndex = 0;
        setBarsActive(8); // default choice
        renderSelection();
      }
    });

    btnPDF.addEventListener("click", async () => {
      if (!lastXml) { alert("Load a score/part first."); return; }
      const base = (select.value === "__SCORE__" ? "Score" : select.value);
      await exportCurrentViewToPdf(osmdBox, base);
      scheduleOverlay();
    });

    btnXML.addEventListener("click", () => {
      if (!lastXml) { alert("Load a score/part first."); return; }
      const name = (select.value === "__SCORE__" ? "Score" : select.value) || "part";
      downloadText(lastXml, safe(name) + ".musicxml", "application/xml");
    });

    // ---------- ZIP: PDFs for Score + all Parts (ghost renderer, no flicker) ----------
    btnPDFAll.addEventListener("click", async () => {
      const s = getState();
      const items = [];
      if (s.combinedScoreXml) items.push({ label: "Score", xml: s.combinedScoreXml });
      (Array.isArray(s.arrangedFiles)?s.arrangedFiles:[]).forEach(p => {
        items.push({ label: p.instrumentName || p.baseName || "Part", xml: p.xml });
      });
      if (!items.length) { alert("No score or parts found."); return; }

      try {
        const zip = new JSZip();
        // ghost renderer setup
        const { ghost, ghostBox, cleanup } = createGhostOSMD(osmdBox);

        for (const it of items) {
          let xmlWork = ensureTitle(it.xml, songName);
          xmlWork = transformXmlForSlashes(xmlWork);
          xmlWork = applyBarsPerSystem(xmlWork, barsPerSystemChoice);
          xmlWork = applyScalingForBars(xmlWork, barsPerSystemChoice);
          xmlWork = withXmlProlog(xmlWork);

          const ab = await renderXmlToPdfArrayBuffer(ghost, ghostBox, xmlWork);
          zip.file(`${safe(songName)} - ${safe(it.label)}.pdf`, ab);
        }
        cleanup();

        const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
        const zipName = `${safe(songName)} - PDFs (Score & Parts).zip`;
        triggerBlobDownload(blob, zipName);
      } catch (e) {
        console.error("[finalViewer] ZIP PDFs failed", e);
        alert("Failed to export PDFs.");
      } finally {
        resetViewerToDefault();
      }
    });

    // ---------- ZIP: XMLs for Score + all Parts ----------
    btnXMLAll.addEventListener("click", async () => {
      const s = getState();
      const items = [];
      if (s.combinedScoreXml) items.push({ label: "Score", xml: s.combinedScoreXml });
      (Array.isArray(s.arrangedFiles)?s.arrangedFiles:[]).forEach(p => {
        items.push({ label: p.instrumentName || p.baseName || "Part", xml: p.xml });
      });
      if (!items.length) { alert("No score or parts found."); return; }

      try {
        const zip = new JSZip();
        for (const it of items) {
          let xmlWork = ensureTitle(it.xml, songName);
          xmlWork = transformXmlForSlashes(xmlWork);
          xmlWork = applyBarsPerSystem(xmlWork, barsPerSystemChoice);
          xmlWork = applyScalingForBars(xmlWork, barsPerSystemChoice);
          xmlWork = withXmlProlog(xmlWork);
          zip.file(`${safe(songName)} - ${safe(it.label)}.musicxml`, xmlWork);
        }
        const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
        const zipName = `${safe(songName)} - XMLs (Score & Parts).zip`;
        triggerBlobDownload(blob, zipName);
      } catch (e) {
        console.error("[finalViewer] ZIP XMLs failed", e);
        alert("Failed to export XMLs.");
      } finally {
        resetViewerToDefault();
      }
    });

    function pickXml(choice){
      const s = getState();
      if (choice === "__SCORE__") return { xml: s.combinedScoreXml || "" };
      const list = Array.isArray(s.arrangedFiles) ? s.arrangedFiles : [];
      const hit = list.find(f => (f.instrumentName || f.baseName) === choice);
      return { xml: (hit && hit.xml) || "" };
    }

    function ensureOverlayOnTop(host){
      const ov = host.querySelector(".aa-overlay");
      if (ov && ov.parentNode === host) host.appendChild(ov);
    }
    function overlayCleanup(host){
      const ov = host.querySelector(".aa-overlay");
      if (ov) ov.innerHTML = "";
    }

    // reset to first option and rerender (as if just loaded)
    function resetViewerToDefault(){
      if (!select || select.options.length === 0) return;
      select.selectedIndex = 0;
      lastXml = "";
      osmdBox.scrollLeft = 0;
      renderSelection();
    }
  } // buildViewerUI

  /* ===== ghost renderer (prevents flicker) ===== */
  function createGhostOSMD(referenceBox){
    const dims = referenceBox.getBoundingClientRect();
    const ghostBox = document.createElement("div");
    ghostBox.id = "aa-osmd-ghost";
    ghostBox.style.cssText = `position:fixed;left:0;top:0;width:${Math.max(800, Math.floor(dims.width))}px;height:${Math.max(600, Math.floor(dims.height))}px;opacity:0;pointer-events:none;z-index:-1;background:#fff;`;
    document.body.appendChild(ghostBox);

    const OSMD = lookupGlobal("opensheetmusicdisplay");
    const ghost = new OSMD.OpenSheetMusicDisplay(ghostBox, {
      autoResize: false,
      backend: "svg",
      drawingParameters: "default",
      newSystemFromXML: true,
      newPageFromXML: true
    });

    const cleanup = () => {
      try { ghostBox.remove(); } catch(_) {}
    };
    return { ghost, ghostBox, cleanup };
  }

  async function renderXmlToPdfArrayBuffer(ghost, ghostBox, xml){
    const jspdfNS = window.jspdf || (window.jspdf && window.jspdf.jsPDF ? window.jspdf : window);
    const JsPDFCtor = jspdfNS.jsPDF || jspdfNS.JSPDF || jspdfNS.jsPDFConstructor;
    if (!JsPDFCtor) throw new Error("jsPDF not available.");

    await ghost.load(xml);
    await ghost.render();
    await new Promise(r => requestAnimationFrame(r));
    fitScoreToHeight(ghost, ghostBox);
    forceIntrinsicSvgWidth(ghostBox);

    const { canvas, w, h } = await snapshotCanvas(ghostBox);
    const PDF_DOWNSCALE = 0.9;
    const pageW = Math.floor(w * PDF_DOWNSCALE);
    const pageH = Math.floor(h * PDF_DOWNSCALE);

    const pdf = new JsPDFCtor({ orientation: pageW>=pageH?"landscape":"portrait", unit:"pt", format:[pageW,pageH] });
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, pageW, pageH);
    return pdf.output("arraybuffer");
  }

  /* ===== viewer helpers ===== */
  function sortPartsEvenIfNoPid(files){
    const out = [];
    for (const f of files){
      const pid = f.newPartId || extractPidFromXml(f.xml) || "";
      const n = parseInt(String(pid).replace(/^P/i,""), 10);
      out.push(Object.assign({}, f, { _pnum: (isFinite(n)?n:999) }));
    }
    out.sort((a,b) => (a._pnum !== b._pnum) ? a._pnum - b._pnum : String(a.instrumentName||"").localeCompare(String(b.instrumentName||"")));
    return out;
  }
  function extractPidFromXml(xml){
    const m = String(xml||"").match(/<score-part\s+id="([^"]+)"/i);
    return m ? m[1] : null;
  }
  function snapshotCanvas(container){
    return html2canvas(container, { scale:2, backgroundColor:"#fff" })
           .then(canvas => ({canvas, w:canvas.width, h:canvas.height}));
  }
  async function exportCurrentViewToPdf(container, baseName){
    const { canvas, w, h } = await snapshotCanvas(container);
    const pdfDown = 0.9;
    const jspdfNS = window.jspdf || (window.jspdf && window.jspdf.jsPDF ? window.jspdf : window);
    const JsPDFCtor = jspdfNS.jsPDF || jspdfNS.JSPDF || jspdfNS.jsPDFConstructor;
    if (!JsPDFCtor) { alert("jsPDF not loaded."); return; }
    const pageW = Math.floor(w * pdfDown);
    const pageH = Math.floor(h * pdfDown);
    const pdf = new JsPDFCtor({ orientation: pageW>=pageH?"landscape":"portrait", unit:"pt", format:[pageW,pageH] });
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, pageW, pageH);
    pdf.save(safe(baseName || "score") + ".pdf");
  }
  function triggerBlobDownload(blob, filename){
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 100);
  }

  // Vertical-fit only; keep intrinsic width for horizontal scroll
  function fitScoreToHeight(osmd, host){
    const svg = host.querySelector("svg"); if (!svg) return;
    const maxH = host.clientHeight; if (!maxH) return;
    let svgH = 0; try { svgH = svg.getBBox().height; } catch(e){}
    if (!svgH) svgH = svg.clientHeight || svg.scrollHeight || svg.offsetHeight || 0;
    if (!svgH) return;
    const current = (typeof osmd.zoom === "number") ? osmd.zoom : 1;
    const SHRINK = 0.90;
    let target = Math.min(current, (maxH * SHRINK) / svgH);
    if (!isFinite(target) || target <= 0) target = 1;
    target = Math.max(0.3, Math.min(1.5, target));
    if (Math.abs(target - current) > 0.01) { osmd.zoom = target; osmd.render(); }
  }
  function forceIntrinsicSvgWidth(host){
    const svg = host.querySelector("svg"); if (!svg) return;
    let vbw = 0;
    const vb = svg.viewBox && svg.viewBox.baseVal;
    if (vb && vb.width) vbw = vb.width;
    if (!vbw) {
      try { vbw = svg.getBBox().width; } catch(e){}
    }
    if (vbw) svg.style.width = Math.ceil(vbw) + "px";
    else svg.style.removeProperty("width");
  }

   if (typeof AA !== "undefined" && AA.emit) {
  AA.emit("viewer:rendered", { osmd, host: osmdBox });
}
   
   
  // --- MusicXML helpers -------------------------------------------------
  function ensureTitle(xmlString, title){
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlString, "application/xml");
      const hasMovement = !!doc.querySelector("movement-title");
      const hasWork     = !!doc.querySelector("work > work-title");
      if (!hasMovement && !hasWork) {
        const root = doc.querySelector("score-partwise, score-timewise") || doc.documentElement;
        const mv = doc.createElement("movement-title"); mv.textContent = title || "Auto Arranger Score";
        root.insertBefore(mv, root.firstChild);
      }
      return new XMLSerializer().serializeToString(doc);
    } catch (e) { return xmlString; }
  }

  function transformXmlForSlashes(xmlString) {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlString, "application/xml");
      xmlDoc.querySelectorAll("lyric").forEach(n => n.remove());
      return new XMLSerializer().serializeToString(xmlDoc);
    } catch (e) { return xmlString; }
  }

  function withXmlProlog(str){
    if (!str) return str;
    let s = String(str).replace(/^\uFEFF/, "").replace(/^\s+/, "");
    if (!/^\<\?xml/i.test(s)) s = '<?xml version="1.0" encoding="UTF-8"?>\n' + s;
    return s;
  }

  function safe(name){
    return String(name || "").replace(/[\\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim();
  }

  function downloadText(text, filename, mimetype){
    try{
      const blob = new Blob([text], { type: mimetype || "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename || "download.txt";
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 50);
    } catch(e){ console.warn("downloadText failed", e); }
  }

  // remove ALL <print> elements (so we can reapply cleanly or return to Auto)
  function stripAllPrints(doc){
    const prints = Array.from(doc.getElementsByTagName("print"));
    prints.forEach(n => n.parentNode && n.parentNode.removeChild(n));
  }

  // Insert forced system breaks every N measures (first part only)
  function applyBarsPerSystem(xmlString, barsPerSystem){
    const N = Number(barsPerSystem)||0;
    try{
      const doc  = new DOMParser().parseFromString(String(xmlString), "application/xml");
      const root = doc.documentElement;
      const ns   = root.namespaceURI || null;

      // clean slate
      stripAllPrints(doc);
      if (!N) return new XMLSerializer().serializeToString(doc);

      function mkPrint(){
        const p = ns ? doc.createElementNS(ns,"print") : doc.createElement("print");
        p.setAttribute("new-system","yes");
        return p;
      }

      let inserted = 0;

      if (/score-partwise/i.test(root.nodeName)) {
        const parts = Array.from(doc.getElementsByTagName("part"));
        if (parts.length) {
          const firstPart = parts[0];
          const measures = Array.from(firstPart.getElementsByTagName("measure"));
          for (let i=0;i<measures.length;i++){
            if (i>0 && (i % N)===0) {
              const m = measures[i];
              const p = mkPrint();
              m.insertBefore(p, m.firstChild);
              inserted++;
            }
          }
        }
        console.log(`[M7] applyBarsPerSystem(partwise): inserted ${inserted} system breaks into first part`);
      } else if (/score-timewise/i.test(root.nodeName)) {
        const measures = Array.from(root.getElementsByTagName("measure"));
        for (let i=0;i<measures.length;i++){
          if (i>0 && (i % N)===0) {
            const m = measures[i];
            const firstPart = m.getElementsByTagName("part")[0];
            if (firstPart) {
              const p = mkPrint();
              firstPart.insertBefore(p, firstPart.firstChild);
              inserted++;
            }
          }
        }
        console.log(`[M7] applyBarsPerSystem(timewise): inserted ${inserted} system breaks into first-part-per-measure`);
      }

      return new XMLSerializer().serializeToString(doc);
    }catch(e){
      console.warn("[M7] applyBarsPerSystem failed", e);
      return xmlString;
    }
  }

  // Gently scale engraving so requested bars/system are more likely to fit
  function applyScalingForBars(xmlString, barsPerSystem){
    const N = Number(barsPerSystem)||0;
    if (!N) return xmlString;
    const kMap = { 4: 1.00, 8: 1.15, 12: 1.30, 16: 1.50 };
    const k = kMap[N] || 1.00;
    try {
      const doc  = new DOMParser().parseFromString(String(xmlString), "application/xml");
      const root = doc.documentElement;
      const ns   = root.namespaceURI || null;

      let defaults = doc.querySelector("defaults");
      if (!defaults) {
        defaults = ns ? doc.createElementNS(ns, "defaults") : doc.createElement("defaults");
        root.insertBefore(defaults, root.firstChild);
      }
      let scaling = defaults.querySelector("scaling");
      if (!scaling) {
        scaling = ns ? doc.createElementNS(ns, "scaling") : doc.createElement("scaling");
        defaults.appendChild(scaling);
      }
      let mm = scaling.querySelector("millimeters");
      if (!mm) {
        mm = ns ? doc.createElementNS(ns, "millimeters") : doc.createElement("millimeters");
        mm.textContent = "7.0";
        scaling.appendChild(mm);
      }
      let tenthsNode = scaling.querySelector("tenths");
      if (!tenthsNode) {
        tenthsNode = ns ? doc.createElementNS(ns, "tenths") : doc.createElement("tenths");
        tenthsNode.textContent = "40";
        scaling.appendChild(tenthsNode);
      }
      const oldTenths = parseFloat(tenthsNode.textContent) || 40;
      const newTenths = Math.round(oldTenths * k);
      tenthsNode.textContent = String(newTenths);

      console.log(`[M7] applyScalingForBars: tenths ${oldTenths} -> ${newTenths} (k=${k}) for ${N} bars/system`);
      return new XMLSerializer().serializeToString(doc);
    } catch (e) {
      console.warn("[M7] applyScalingForBars failed", e);
      return xmlString;
    }
  }

  // --- Back to Step 3 (preserve pack/song & instrumentData; clear pipeline) ---
  function backToInstrumentSelection({ cleanupFns = [] } = {}) {
    // tear down viewer safely
    try { cleanupFns.forEach(fn => { try { fn(); } catch(_){} }); } catch(_) {}
    try { document.getElementById("aa-viewer")?.remove(); } catch(_) {}
    try { document.getElementById("aa-osmd-ghost")?.remove(); } catch(_) {}

    // IMPORTANT: merge-only reset so instrumentData / libraryData remain
    if (typeof mergeState === "function") {
      mergeState({
        // clear only what should reset
        instrumentSelections: [],
        parts: [],
        assignedResults: [],
        groupedAssignments: [],
        arrangedFiles: [],
        combinedScoreXml: "",
        barsPerSystem: 0,
        arrangeDone: false,
        renameDone: false,
        reassignByScoreDone: false,
        combineDone: false,
        timestamp: Date.now()
      });
    } else {
      // fallback (if only setState exists): include preserved globals explicitly
      const cur = getState() || {};
      setState({
        packIndex: cur.packIndex ?? null,
        pack: cur.pack ?? null,
        songIndex: cur.songIndex ?? null,
        song: cur.song ?? null,
        selectedSong: cur.selectedSong ?? null,
        libraryData: cur.libraryData ?? [],
        instrumentData: cur.instrumentData ?? [],
        instrumentSelections: [],
        parts: [],
        assignedResults: [],
        groupedAssignments: [],
        arrangedFiles: [],
        combinedScoreXml: "",
        barsPerSystem: 0,
        arrangeDone: false,
        renameDone: false,
        reassignByScoreDone: false,
        combineDone: false,
        timestamp: Date.now()
      });
    }

    // show Step 3 (Instrument Picker)
    if (typeof setWizardStage === "function") {
      setWizardStage("instruments");
    } else {
      document.getElementById("step1")?.classList.add("hidden");
      document.getElementById("step2")?.classList.add("hidden");
      document.getElementById("step3")?.classList.remove("hidden");
    }

    if (AA && typeof AA.emit === "function") {
      AA.emit("viewer:closed");
      AA.emit("viewer:backToInstruments");
    }
  }

  // --- overlay (viewer-only) -------------------------------------------
  function getArrangerFromXml(xmlString){
    try{
      const p = new DOMParser();
      const doc = p.parseFromString(xmlString || "", "application/xml");
      let arr = "";
      doc.querySelectorAll("credit").forEach(c => {
        const t = (c.querySelector("credit-type") && c.querySelector("credit-type").textContent || "").toLowerCase().trim();
        if (!arr && t === "arranger") {
          const w = c.querySelector("credit-words");
          arr = (w && w.textContent || "").trim();
        }
      });
      if (!arr) {
        const fallback = doc.querySelector('identification > creator[type="arranger"]');
        if (fallback) arr = (fallback.textContent || "").trim();
      }
      return arr || "Arranged by Auto Arranger";
    } catch(e){ return "Arranged by Auto Arranger"; }
  }

  function overlayCredits(osmd, host, pickedLabel, arrangerText){
    try {
      const PART_TOP_PAD_DEFAULT   = 10;
      const PART_LEFT_PAD_DEFAULT  = 18;
      const ARR_TOP_PAD_DEFAULT    = 6;
      const ARR_RIGHT_PAD_DEFAULT  = 20;

      const ARR_TOP_TWEAK          = 8;
      const ARR_RIGHT_INSET        = 40;

      const PART_FONT_PX_DEFAULT   = 11;
      const ARR_FONT_PX_DEFAULT    = 11;

      let overlay = host.querySelector(".aa-overlay");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.className = "aa-overlay";
        overlay.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:2;";
        host.appendChild(overlay);
      } else {
        overlay.innerHTML = "";
      }

      const svg = host.querySelector("svg");
      if (!svg) return;

      const svgRect  = svg.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();

      const absLeft  = (px) => (px - hostRect.left) + "px";
      const absTop   = (px) => (px - hostRect.top)  + "px";
      const absRight = (px) => (hostRect.right - px) + "px";

      let composerTextNode = null;
      for (const t of svg.querySelectorAll("text")) {
        const txt = (t.textContent || "");
        if (/compos/i.test(txt)) { composerTextNode = t; break; }
      }
      const cs = composerTextNode ? getComputedStyle(composerTextNode) : null;
      const measuredPx = (cs && cs.fontSize && cs.fontSize.endsWith("px"))
        ? parseFloat(cs.fontSize) : NaN;

      let scalePos = NaN;
      const vb = svg.viewBox && svg.viewBox.baseVal;
      if (vb && vb.height) scalePos = svgRect.height / vb.height;
      if (!scalePos || !isFinite(scalePos)) {
        const zoom = (typeof osmd.zoom === "number" && isFinite(osmd.zoom)) ? osmd.zoom : 1;
        scalePos = zoom;
      }

      const family = (cs && cs.fontFamily) ? cs.fontFamily : (getComputedStyle(host).fontFamily || "serif");
      const weight = (cs && cs.fontWeight) ? cs.fontWeight : "normal";
      const fstyle = (cs && cs.fontStyle)  ? cs.fontStyle  : "normal";

      const partPx = (isFinite(measuredPx) && measuredPx > 0)
        ? Math.round(measuredPx)
        : Math.round(PART_FONT_PX_DEFAULT * (scalePos || 1));

      const arrPx  = (isFinite(measuredPx) && measuredPx > 0)
        ? Math.round(measuredPx)
        : Math.round(ARR_FONT_PX_DEFAULT * (scalePos || 1));

      const partTop   = svgRect.top  + PART_TOP_PAD_DEFAULT  * scalePos;
      const partLeft  = svgRect.left + PART_LEFT_PAD_DEFAULT * scalePos;
      const arrTop    = svgRect.top  + (ARR_TOP_PAD_DEFAULT + ARR_TOP_TWEAK) * scalePos;
      const arrRightX = svgRect.right - (ARR_RIGHT_PAD_DEFAULT + ARR_RIGHT_INSET) * scalePos;

      if (pickedLabel) {
        const el = document.createElement("div");
        el.textContent = pickedLabel;
        el.style.cssText =
          "position:absolute;" +
          "left:" + absLeft(partLeft) + ";" +
          "top:" + absTop(partTop) + ";" +
          "font-size:" + partPx + "px;" +
          "font-weight:" + weight + ";" +
          "font-style:" + fstyle + ";" +
          "font-family:" + family + ";" +
          "color:#111;letter-spacing:.2px;pointer-events:none;user-select:none;white-space:nowrap;";
        overlay.appendChild(el);
      }

      if (arrangerText) {
        const el = document.createElement("div");
        el.textContent = arrangerText;
        el.style.cssText =
          "position:absolute;" +
          "right:" + absRight(arrRightX) + ";" +
          "top:" + absTop(arrTop) + ";" +
          "font-size:" + arrPx + "px;" +
          "font-weight:" + weight + ";" +
          "font-style:" + fstyle + ";" +
          "font-family:" + family + ";" +
          "color:#111;text-align:right;letter-spacing:.2px;pointer-events:none;user-select:none;white-space:nowrap;";
        overlay.appendChild(el);
      }
    } catch (e) {
      console.warn("[M7 overlay] skipped due to error:", e);
    }
  }

  // tiny DOM helper
  function ce(tag, props){ const el = document.createElement(tag); if (props) Object.assign(el, props); return el; }
})();



/* =========================================================================
   M8) applyCredits — clone credits from original & set OSMD header
   - Title/Subtitle/Composer shown via standard credits + header
   - Arranger: write as real <credit-type>arranger</...> AND also as 'rights' (right side alias)
   - Part/Score label: write as 'lyricist' (left) AND as 'part name' (semantic)
   - Also mirror the part/score into <movement-number> for extra fallback
   - Listens:  combine:done  |  Emits: credits:done
   ------------------------------------------------------------------------- */
;(function(){
  var DEBUG_CREDITS = true;

  AA.on("combine:done", function(){ AA.safe("applyCredits", run); });

  async function run(){
    var s = getState();
    var arranged = Array.isArray(s.arrangedFiles) ? s.arrangedFiles : [];
    var combined = s.combinedScoreXml || "";
    if (!combined || !arranged.length){
      console.warn("[M8] nothing to do (no combined or no arranged files).");
      AA.emit("credits:done");
      return;
    }

    // choose the richest original as credit source (prefer the original file URL if present)
    var baseXml = await findBestCreditSource(s, combined);
    if (DEBUG_CREDITS) console.log("[M8] credit source chosen:", sniffSource(baseXml));

    // snapshot the source credits
    var snap = snapshotCredits(baseXml);
    if (!snap.subtitleText){
      var subAny = findAnyCreditInState(s, "subtitle");
      if (subAny){ snap.subtitleText = subAny; if (DEBUG_CREDITS) console.log("[M8] subtitle via global scan:", subAny); }
    }
    if (DEBUG_CREDITS) console.log("[M8] FINAL snapshot:", JSON.stringify(snap));

    // apply to combined + parts
    combined = applyCreditsToDoc(combined, snap, "Score");
    var updated = arranged.map(function(f){
      var label = f.instrumentName || f.baseName || "Part";
      return Object.assign({}, f, { xml: applyCreditsToDoc(f.xml, snap, label) });
    });

    mergeState({ combinedScoreXml: combined, arrangedFiles: updated, creditsDone:true });
    AA.emit("credits:done");
  }

  /* --------- credit-source helpers --------- */
  async function findBestCreditSource(state, combined){
    var url = (state.selectedSong && state.selectedSong.url) || state.songUrl || null;
    if (url){
      try{
        var txt = await fetch(url, { cache:"no-store" }).then(r => r.ok ? r.text() : "");
        if (txt && /<score-(partwise|timewise)\b/i.test(txt)) {
          if (DEBUG_CREDITS) console.log("[M8] fetched original XML from", url);
          return txt;
        }
      }catch(e){ console.warn("[M8] fetch original failed", e); }
    }
    var guesses = [
      state.originalXml, state.sourceXml, state.fullScoreXml, state.selectedSongXml,
      state.songXml, state.rawXml, state.scoreXml, combined
    ].filter(function(x){ return typeof x === "string" && /<score-(partwise|timewise)\b/i.test(x); });
    if (guesses.length) return bestByCreditDensity(guesses);

    var pool = [];
    try{
      var seen = new Set();
      (function walk(obj){
        if (!obj || seen.has(obj)) return;
        seen.add(obj);
        if (typeof obj === "string"){
          if (/<score-(partwise|timewise)\b/i.test(obj)) pool.push(obj);
          return;
        }
        if (Array.isArray(obj)) { for (var i=0;i<obj.length;i++) walk(obj[i]); return; }
        if (typeof obj === "object") { for (var k in obj) if (obj.hasOwnProperty(k)) walk(obj[k]); }
      })(state);
    }catch(_){}
    return pool.length ? bestByCreditDensity(pool) : combined;
  }
  function bestByCreditDensity(list){
    var best = list[0], max = -1;
    for (var i=0;i<list.length;i++){
      var x = String(list[i]);
      var score = (x.match(/<credit-type>/gi)||[]).length + (x.match(/<credit\b/gi)||[]).length;
      if (score > max){ max = score; best = x; }
    }
    return best;
  }
  function sniffSource(xml){
    return {
      chars: xml.length,
      credits: (xml.match(/<credit-type>/gi)||[]).length,
      hasSub: /<credit-type>\s*subtitle/i.test(xml),
      hasMovTitle: /<movement-title>/i.test(xml)
    };
  }
  function findAnyCreditInState(state, type){
    var found = null, lowerType = String(type).toLowerCase();
    try{
      var seen = new Set();
      (function walk(obj){
        if (found || !obj || seen.has(obj)) return;
        seen.add(obj);
        if (typeof obj === "string" && /<credit-type>/i.test(obj)){
          try{
            var p = new DOMParser().parseFromString(obj, "application/xml");
            p.querySelectorAll("credit").forEach(function(c){
              if (found) return;
              var t = (c.querySelector("credit-type") && c.querySelector("credit-type").textContent || "").toLowerCase().trim();
              if (t === lowerType){
                var w = (c.querySelector("credit-words") && c.querySelector("credit-words").textContent || "").trim();
                if (w) found = w;
              }
            });
          }catch(_){}
        }
        if (Array.isArray(obj)) { for (var i=0;i<obj.length;i++) walk(obj[i]); return; }
        if (typeof obj === "object") { for (var k in obj) if (obj.hasOwnProperty(k)) walk(obj[k]); }
      })(state);
    }catch(_){}
    return found;
  }

  /* --------- snapshot (read) --------- */
  function snapshotCredits(xmlString){
    var out = { titleText:"", subtitleText:"", composerText:"", arrangerText:"" };
    try{
      var p   = new DOMParser();
      var doc = p.parseFromString(xmlString, "application/xml");

      function firstCredit(type){
        var want = String(type).toLowerCase(), hit = "";
        doc.querySelectorAll("credit").forEach(function(c){
          if (hit) return;
          var t = (c.querySelector("credit-type") && c.querySelector("credit-type").textContent || "").toLowerCase().trim();
          if (t === want){
            var w = (c.querySelector("credit-words") && c.querySelector("credit-words").textContent || "").trim();
            if (w) hit = w;
          }
        });
        return hit;
      }

      out.titleText =
        firstCredit("title") ||
        (doc.querySelector("movement-title") && doc.querySelector("movement-title").textContent.trim()) ||
        (doc.querySelector("work > work-title") && doc.querySelector("work > work-title").textContent.trim()) || "";

      out.subtitleText = firstCredit("subtitle") || "";

      out.composerText =
        firstCredit("composer") ||
        (doc.querySelector('identification > creator[type="composer"]') && doc.querySelector('identification > creator[type="composer"]').textContent.trim()) || "";

      out.arrangerText =
        firstCredit("arranger") ||
        (doc.querySelector('identification > creator[type="arranger"]') && doc.querySelector('identification > creator[type="arranger"]').textContent.trim()) || "";

      if (DEBUG_CREDITS){
        console.log("[M8] sourceOf:", {
          titleFromCredit: !!firstCredit("title"),
          subtitleFromCredit: !!firstCredit("subtitle"),
          composerFromCredit: !!firstCredit("composer"),
          arrangerFromCredit: !!firstCredit("arranger")
        });
      }
    }catch(e){ console.warn("[M8] snapshotCredits failed", e); }
    return out;
  }

  /* --------- apply (write) --------- */
  function applyCreditsToDoc(xmlString, snap, partName){
    try{
      var p   = new DOMParser();
      var doc = p.parseFromString(xmlString, "application/xml");
      var root= doc.documentElement;

      // remove any old managed-types so we don't duplicate
      root.querySelectorAll("credit").forEach(function(c){
        var t = (c.querySelector("credit-type") && c.querySelector("credit-type").textContent || "").toLowerCase().trim();
        if (!t || t==="title" || t==="subtitle" || t==="composer" || t==="arranger" || t==="lyricist" || t==="part name" || t==="rights") c.remove();
      });

      var ly = readLayout(doc);
      if (DEBUG_CREDITS) console.log("[M8] layout:", ly);

      function beforePartList(node){
        var pl = root.querySelector("part-list");
        if (pl) root.insertBefore(node, pl); else root.appendChild(node);
      }

      function addCredit(opts){
        var type = opts.type || null;
        var text = opts.text;
        if (!text) return;

        var credit = doc.createElement("credit");
        credit.setAttribute("page","1");

        if (type){
          var ct = doc.createElement("credit-type");
          ct.textContent = type;
          credit.appendChild(ct);
        }

        var words = doc.createElement("credit-words");
        var anchor = opts.anchor || "left";
        if (anchor === "center"){
          words.setAttribute("justify","center");
          words.setAttribute("halign","center");
          words.setAttribute("default-x", String(ly.centerX));
        } else if (anchor === "right"){
          words.setAttribute("justify","right");
          words.setAttribute("halign","right");
          words.setAttribute("default-x", String(ly.rightX));
        } else {
          words.setAttribute("justify","left");
          words.setAttribute("halign","left");
          words.setAttribute("default-x", String(ly.leftX));
        }
        words.setAttribute("default-y", String(opts.y));
        if (opts.size != null) words.setAttribute("font-size", String(opts.size));
        words.setAttribute("valign","top");
        words.textContent = text;

        credit.appendChild(words);
        beforePartList(credit);
        if (DEBUG_CREDITS) console.log("[M8] add credit:", (type||"(no type)"), { anchor, text, x: words.getAttribute("default-x"), y: opts.y, size: opts.size });
      }

      // positions (tenths) matching your sample
      var yTitle    = ly.pageHeight - ly.top - 1; // ~2375
      var ySubtitle = 2282;
      var yComposer = 2298;
      var yArranger = 2247;
      var yPart     = 2380;

      // Title / Subtitle
      addCredit({ type:"title",    text:snap.titleText,    anchor:"center", size:21.6, y:yTitle    });
      addCredit({ type:"subtitle", text:snap.subtitleText, anchor:"center", size:16.2, y:ySubtitle });

      // Composer (right)
      addCredit({ type:"composer", text:snap.composerText, anchor:"right",  size:10.8, y:yComposer });

      // Arranger: semantic + alias (some OSMD builds only show known types; 'rights' often renders on the right)
      addCredit({ type:"arranger", text:snap.arrangerText, anchor:"right",  size:10.8, y:yArranger });
      addCredit({ type:"rights",   text:snap.arrangerText, anchor:"right",  size:10.8, y:yArranger });

      // Part/Score label: OSMD-visible + semantic + header fallback
      if (partName){
        addCredit({ type:"lyricist",  text:partName, anchor:"left", size:10.8, y:yPart });      // OSMD-visible (left)
        addCredit({ type:"part name", text:partName, anchor:"left", size:10.8, y:yPart });      // semantic for other apps
        ensureMovementNumber(doc, root, partName);                                              // extra fallback
      }

      // Header mapping (BIG = Title → work-title, small = Subtitle → movement-title)
      ensureHeaderTitles(doc, root, snap.titleText, snap.subtitleText);
      ensureCreator(doc, "arranger", snap.arrangerText); // keep <identification> semantic

      if (DEBUG_CREDITS) console.log("[M8] header set:", { workTitle: snap.titleText, movementTitle: snap.subtitleText||"", movementNumber: partName||"" });

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

    // Small line → movement-title = Subtitle (remove if none)
    var mt = root.querySelector("movement-title");
    if (subtitleText){
      if (!mt){ mt = doc.createElement("movement-title"); root.insertBefore(mt, root.firstChild); }
      mt.textContent = subtitleText;
    } else if (mt){
      mt.remove();
    }
  }

  function ensureCreator(doc, type, text){
    if (!text) return;
    var id = doc.querySelector("identification");
    if (!id){ id = doc.createElement("identification"); doc.documentElement.insertBefore(id, doc.documentElement.firstChild); }
    var existing = id.querySelector('creator[type="'+type+'"]');
    if (!existing){
      existing = doc.createElement("creator");
      existing.setAttribute("type", type);
      id.appendChild(existing);
    }
    existing.textContent = text;
  }

  function ensureMovementNumber(doc, root, label){
    if (!label) return;
    var mn = root.querySelector("movement-number");
    if (!mn){
      mn = doc.createElement("movement-number");
      root.insertBefore(mn, root.firstChild);
    }
    mn.textContent = label;
  }

  /* --------- layout helper --------- */
  function readLayout(doc){
    var d = { pageWidth:1923, pageHeight:2489, left:226, right:113, top:113 };
    try{
      var defaults = doc.querySelector("defaults");
      var pl = defaults && defaults.querySelector("page-layout");
      var both = pl && (pl.querySelector('page-margins[type="both"]') || pl.querySelector("page-margins"));
      function num(q, v){ try{ var n = parseFloat(q.textContent); return isFinite(n)?n:v; } catch(e){ return v; } }
      d.pageWidth  = pl ? num(pl.querySelector("page-width"),  d.pageWidth)  : d.pageWidth;
      d.pageHeight = pl ? num(pl.querySelector("page-height"), d.pageHeight) : d.pageHeight;
      d.left  = both ? num(both.querySelector("left-margin"),  d.left)  : d.left;
      d.right = both ? num(both.querySelector("right-margin"), d.right) : d.right;
      d.top   = both ? num(both.querySelector("top-margin"),   d.top)   : d.top;
    }catch(_){}
    d.leftX   = d.left;
    d.rightX  = d.pageWidth - d.right;
    d.centerX = Math.round(d.pageWidth / 2);
    return d;
  }
})();










   

/* ============================================================================
   H1) Helper — ensure every XML we hand to OSMD starts with an XML header
   ---------------------------------------------------------------------------- */
function ensureXmlHeader(xml) {
  const s = String(xml || "").trimStart();
  return s.startsWith("<?xml") ? s : `<?xml version="1.0" encoding="UTF-8"?>\n${s}`;
}






/* =========================================================================
   M9) OSMD Page Layout (Letter) + Full-Width Systems + Fit-to-Height
   ------------------------------------------------------------------------- */
;(function () {
  const FIT_SHRINK = 0.90; // match your “slightly smaller” look

  // Fit vertically (like your M7 helper, but local here so we can call it too)
  function fitToHeight(osmd, host){
    try{
      const svg = host.querySelector("svg"); if (!svg) return;
      const maxH = host.clientHeight; if (!maxH) return;

      let svgH = 0;
      try { svgH = svg.getBBox().height; } catch(_) {}
      if (!svgH) svgH = svg.clientHeight || svg.scrollHeight || svg.offsetHeight || 0;
      if (!svgH) return;

      const current = (typeof osmd.zoom === "number") ? osmd.zoom : 1;
      let target = (maxH * FIT_SHRINK) / svgH;
      if (!isFinite(target) || target <= 0) target = 1;
      target = Math.max(0.3, Math.min(1.5, target));

      if (Math.abs(target - current) > 0.01) {
        osmd.zoom = target;
        osmd.render(); // re-render at the new zoom
      }
    } catch(e) {
      console.warn("[M9] fitToHeight skipped:", e);
    }
  }

  // Make OSMD do proper paged layout and stretch systems to page width
  function enforceLetterAndStretch(osmd){
    try {
      // Prefer official API if present
      if (typeof osmd.setOptions === "function") {
        osmd.setOptions({
          // keep your existing backend etc.; these are safe repeats
          backend: "svg",
          // force paged layout on Letter
          pageFormat: "Letter",          // OSMD >= 1.6
          // for some versions: pageBackgroundColor makes pages opaque
          pageBackgroundColor: "#ffffff",
          // respect page/system hints from MusicXML (you already use these)
          newPageFromXML: true,
          newSystemFromXML: true
        });
      }

      // Nudge engraving rules that many builds expose:
      const r = osmd.rules;
      if (r) {
        // stretch every system, including the last one
        if ("JustifySystemLines"   in r) r.JustifySystemLines   = true;
        if ("StretchLastSystemLine" in r) r.StretchLastSystemLine = true;
        // if available, ensure we really fill width
        if ("SystemFillFactor" in r && isFinite(r.SystemFillFactor)) {
          r.SystemFillFactor = 1.0;
        }
      }
    } catch (e) {
      console.warn("[M9] enforceLetterAndStretch skipped:", e);
    }
  }

  // After every viewer render, apply rules and fit vertically
  if (typeof AA !== "undefined" && AA.on) {
    AA.on("viewer:rendered", ({ osmd, host }) => {
      if (!osmd || !host) return;

      // 1) enforce paging + justification
      enforceLetterAndStretch(osmd);

      // 2) re-render once with new rules/options
      try { osmd.render(); } catch(_) {}

      // 3) fit vertically to ~90% so whole pages are visible
      requestAnimationFrame(() => fitToHeight(osmd, host));
    });
  }
})();

