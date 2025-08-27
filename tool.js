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
   I) STEP 3: INSTRUMENT PICKER UI (left list → Add; right list → Selections)
   ========================================================================== */
(function(){

  // Ensure we have a Step 3 host; create if missing
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

  // Build UI once; if it already exists, just ensure Back button is present.
  function ensureInstrumentPickerMarkup(){
    const host = ensureStep3Host();

    // De-dupe: if multiple #aa-pickers somehow exist, keep the first.
    const containers = Array.from(document.querySelectorAll("#aa-pickers"));
    let container = containers[0];
    if (containers.length > 1) {
      containers.slice(1).forEach(n => n.remove());
    }

    if (!container) {
      host.insertAdjacentHTML("beforeend", `
        <div id="aa-pickers" class="aa-grid" style="margin-top:12px;">
          <div class="aa-pane">
            <h4>Instruments</h4>
            <select id="instrumentList" size="10"></select>
            <div id="leftControls" style="display:flex; gap:10px; margin-top:10px;">
              <button id="btnBackToSong" class="aa-btn" style="background:#1a1f2a;border:1px solid var(--line);color:var(--text);">Back</button>
              <button id="btnAddInstrument" class="aa-btn">Add to Score</button>
            </div>
          </div>
          <div class="aa-pane">
            <h4>Selections</h4>
            <select id="selectionsList" size="10"></select>
            <div style="display:flex; gap:10px; margin-top:10px;">
              <button id="btnRemoveSelected" class="aa-btn">Remove</button>
              <button id="btnSaveSelections" class="aa-btn aa-accent">Save Selections</button>
            </div>
          </div>
        </div>
      `);
      container = document.getElementById("aa-pickers");
      console.log("[AA] Built Step 3 instrument picker UI.");
    } else {
      // Upgrade existing UI: add Back button if it’s missing
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
          console.log("[AA] Added Back button to existing Step 3 UI.");
        }
      }
    }
    return container;
  }

  function setupInstrumentPicker(){
    const container = ensureInstrumentPickerMarkup();
    if (!container) return;

    // Always scope to the single container to avoid duplicate-id issues
    const listLeft  = container.querySelector("#instrumentList");
    const btnAdd    = container.querySelector("#btnAddInstrument");
    const btnBack   = container.querySelector("#btnBackToSong");
    const listRight = container.querySelector("#selectionsList");
    const btnRemove = container.querySelector("#btnRemoveSelected");
    const btnSave   = container.querySelector("#btnSaveSelections");
    const note      = document.getElementById("instStatus");

    if (!listLeft || !btnAdd || !btnBack || !listRight || !btnRemove || !btnSave) {
      console.warn("[AA] Step 3 UI elements missing; picker not wired.");
      return;
    }

    // Populate/refresh left list
    const populateLeftList = () => {
      const s = getState();
      const instruments = Array.isArray(s.instrumentData) ? s.instrumentData : [];
      if (instruments.length) {
        listLeft.innerHTML = instruments
          .map(ins => `<option value="${escapeHtml(ins.name)}">${escapeHtml(ins.name)}</option>`)
          .join("");
        if (note) note.textContent = "";
      } else {
        listLeft.innerHTML = "";
        if (note) note.textContent = "No instruments found in instrumentData.json.";
      }
    };

    // Avoid double-wiring; but still allow repopulation
    if (container.dataset.wired === "1") {
      populateLeftList();
      return;
    }
    container.dataset.wired = "1";

    // Initial population + listen for data refresh
    populateLeftList();
    AA.on("data:instrumentData", populateLeftList);

    // Right pane state & helpers
    const stateSel = { selections: [] };
    const baseOf = (name) => String(name).replace(/\s+\d+$/, "");
    const refreshRight = () => {
      listRight.innerHTML = stateSel.selections
        .map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`)
        .join("");
    };
    const addSelection = (baseName) => {
      const count = stateSel.selections.filter(n => baseOf(n) === baseName).length;
      const label = count === 0 ? baseName : `${baseName} ${count+1}`;
      stateSel.selections.push(label);
      refreshRight();
    };
    const removeSelection = (label) => {
      const i = stateSel.selections.indexOf(label);
      if (i>=0) stateSel.selections.splice(i,1);
      const b = baseOf(label);
      const idxs = stateSel.selections
        .map((n,i)=>({n,i}))
        .filter(x => baseOf(x.n) === b)
        .map(x=>x.i);
      if (idxs.length === 1)      stateSel.selections[idxs[0]] = b;
      else if (idxs.length > 1)   idxs.forEach((ii,k)=> stateSel.selections[ii] = `${b} ${k+1}`);
      refreshRight();
    };

    // Handlers
    btnAdd.addEventListener("click", () => {
      const sel = listLeft.value;
      if (!sel) return;
      addSelection(sel);
    });
    btnBack.addEventListener("click", () => {
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
      const instrumentSelections = stateSel.selections.map(label => {
        const base = baseOf(label);
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

  // Build on DOM ready (in case state restore lands on Step 3)
  document.addEventListener("DOMContentLoaded", setupInstrumentPicker);
  // Rebuild when entering instruments stage
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












