/* =========================================================================
   Auto Arranger - tool.js (Top + Draft 1 flow up to XML extraction & picker)
   ------------------------------------------------------------------------- */

/* ---------- Global singletons (avoid "already declared") ---------- */
window.AUTO_ARRANGER_STATE_KEY  = window.AUTO_ARRANGER_STATE_KEY  || "autoArranger_extractedParts";
const STATE_KEY = window.AUTO_ARRANGER_STATE_KEY;

// Resolve data files
window.AUTO_ARRANGER_DATA_BASE = window.AUTO_ARRANGER_DATA_BASE || (function () {
  try {
    const me = Array.from(document.scripts).find(s => (s.src || "").includes("tool.js"))?.src;
    if (!me) return ".";
    return me.substring(0, me.lastIndexOf("/"));
  } catch { return "."; }
})();
const DATA_BASE = window.AUTO_ARRANGER_DATA_BASE;

// Also compute the site root (works on GH Pages / subpaths)
const ROOT_BASE = new URL('.', document.baseURI).href.replace(/\/$/, "");

// ---- Wizard visibility helper ----
function setWizardStage(stage /* 'library' | 'song' | 'instruments' */){
  const s1 = document.getElementById("step1");
  const s2 = document.getElementById("step2");
  const s3 = document.getElementById("step3");
  if (s1) s1.classList.toggle("hidden", stage !== "library");
  if (s2) s2.classList.toggle("hidden", stage !== "song");
  if (s3) s3.classList.toggle("hidden", stage !== "instruments");
}


/* ---------- Robust fetch helpers ---------- */
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

/* =========================================================================
   Tiny event bus + helpers
   ------------------------------------------------------------------------- */
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

/* =========================================================================
   State, DOM helpers, loading overlay
   ------------------------------------------------------------------------- */
function getState() {
  try { return JSON.parse(sessionStorage.getItem(STATE_KEY) || "{}"); }
  catch { return {}; }
}
function setState(next) { AA.suspendEvents(() => sessionStorage.setItem(STATE_KEY, JSON.stringify(next))); }
function mergeState(patch) { setState({ ...getState(), ...patch }); }

function qs(id){ return document.getElementById(id); }
function ce(tag, props){ const el = document.createElement(tag); if(props) Object.assign(el, props); return el; }

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }

/* Selectors tolerant to id differences */
function libSelectEl(){ return document.getElementById("librarySelect") || document.getElementById("libraryPackSelect") || document.querySelector('select[data-role="library"]'); }
function songSelectEl(){ return document.getElementById("songSelect") || document.getElementById("songSelectDropdown") || document.querySelector('select[data-role="song"]'); }

/* Loading overlay (used later in pipeline) */
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

/* =========================================================================
   Boot: wire Draft-1 UI (Library → Song → auto-extract → Instruments)
   ------------------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  initDraft1UI().catch(e => console.error("[initDraft1UI]", e));
});

async function initDraft1UI(){
  // guard against double-boot
  if (window.AUTO_ARRANGER_UI_BOOTED) return;
  window.AUTO_ARRANGER_UI_BOOTED = true;

  console.log("[AA] DATA_BASE =", DATA_BASE, "| ROOT_BASE =", ROOT_BASE);

  // Load packs + instruments
  const [packs, instruments] = await Promise.all([loadLibraryIndex(), loadInstrumentData()]);
  mergeState({ libraryPacks: packs, instrumentData: instruments });

  // Hook up selects
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

  // Decide which step to show
  const s = getState();
  if (s.packIndex == null) {
    // Nothing chosen yet
    setWizardStage("library");
  } else if (s.songIndex == null) {
    // Library chosen; restore selection and show Song step
    if (libSel) {
      libSel.value = String(s.packIndex);
      populateSongsForPack(s.packIndex);
    }
    setWizardStage("song");
  } else {
    // Both chosen; restore and either show instruments or re-extract
    if (libSel) {
      libSel.value = String(s.packIndex);
      populateSongsForPack(s.packIndex);
    }
    if (songSel) songSel.value = String(s.songIndex);

    if (Array.isArray(s.parts) && s.parts.length) {
      setWizardStage("instruments");
    } else {
      setWizardStage("song");   // show song step while we re-extract
      onSongChosen();           // triggers extraction and then shows instruments
    }
  }

  if (!packs.length) {
    console.warn("[AA] No library packs found. Last URL tried:", getState().libraryJsonUrl);
  }
}


/* ------------ Library & Instrument loaders ------------ */
/* Helpers used by the loaders */

function basename(path) {
  const m = String(path || "").split(/[\\/]/).pop();
  return m || "";
}
function stripExt(name) {
  return String(name || "").replace(/\.[^.]+$/, "");
}
function absolutizeUrl(u, baseUrl) {
  try {
    if (/^https?:\/\//i.test(u)) return u;
    // baseUrl is the JSON file URL; resolve relative to that file’s folder
    const b = new URL(baseUrl, location.href);
    const folder = b.href.replace(/\/[^\/]*$/, "/");
    return new URL(String(u).replace(/^\.\//, ""), folder).href;
  } catch { return u; }
}
function normalizeLibraryData(data, baseUrl) {
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
        const name = item.name || stripExt(basename(url)) || "Untitled";
        return { name, url };
      }
      return null;
    }).filter(Boolean);
    packs.push({ name: String(name || "Pack"), songs });
  };

  // Shape 1: { packs: [...] }
  if (Array.isArray(data?.packs)) {
    data.packs.forEach(p => addPack(p?.name, p?.songs || p?.files || p?.items));
    return packs;
  }
  // Shape 2: [ ... ]
  if (Array.isArray(data)) {
    data.forEach(p => addPack(p?.name, p?.songs || p?.files || p?.items));
    return packs;
  }
  // Shape 3: { "Pack Name": [ ... ], ... }
  if (data && typeof data === "object") {
    Object.entries(data).forEach(([name, items]) => {
      if (Array.isArray(items)) addPack(name, items);
    });
    return packs;
  }
  return [];
}

// --- replace your loadLibraryIndex with this robust version ---
async function loadLibraryIndex(){
  const candidates = [
    `${ROOT_BASE}/libraryData.json`,
    `${ROOT_BASE}/librarydata.json`,
    `${DATA_BASE}/libraryData.json`,
    `${DATA_BASE}/librarydata.json`,
    './libraryData.json',
    './librarydata.json',
    'libraryData.json',
    'librarydata.json'
  ];
  const { data, url } = await tryJson(candidates);
  mergeState({ libraryJsonUrl: url });

  const packs = normalizeLibraryData(data, url);
  if (!packs.length) {
    console.warn("[AA] libraryData.json loaded but no packs were recognized. Check its structure.", data);
  }
  return packs;
}

async function loadInstrumentData(){
  // Expects an array: [{ name, instrumentPart, sortingOctave, clef, transpose, scoreOrder }, ...]
  const candidates = [
    `${ROOT_BASE}/instrumentData.json`,
    `${DATA_BASE}/instrumentData.json`,
    `${ROOT_BASE}/data/instrumentData.json`,
    `${DATA_BASE}/data/instrumentData.json`,
    './instrumentData.json',
    'instrumentData.json'
  ];
  const { data, url } = await tryJson(candidates);
  mergeState({ instrumentJsonUrl: url });
  return Array.isArray(data) ? data : [];
}


/* ------------ Populate songs & selection handlers ------------ */
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

  // Go to Step 2
  qs("step2")?.classList.remove("hidden");
  qs("step1")?.classList.add("hidden");

  const songSel = songSelectEl();
  if (songSel) songSel.value = "";
}

async function onSongChosen(){
  const s = getState();
  const pack = (s.libraryPacks || [])[s.packIndex];
  if (!pack) return;

  const songSel = songSelectEl();
  const songIdx = parseInt(songSel?.value || "", 10);
  if (!Number.isFinite(songIdx)) return;

  const song = pack.songs[songIdx];
  mergeState({ songIndex: songIdx, song: song?.name || "", selectedSong: song });

  // Auto extract parts, then proceed to instruments
  if (song?.url) {
    try {
      const text = await fetch(song.url, { cache: "no-store" }).then(r => r.text());
      const parts = extractPartsFromScore(text);
      mergeState({ parts });
      qs("step3")?.classList.remove("hidden");
      qs("step2")?.classList.add("hidden");
    } catch (e) {
      console.error("[extractPartsFromScore]", e);
      alert("Failed to extract parts from this song.");
    }
  }
}

/* =========================================================================
   XML extraction (single-part scores from selected file)
   ------------------------------------------------------------------------- */
function extractPartsFromScore(xmlText){
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const serializer = new XMLSerializer();

  const scoreParts = Array.from(doc.querySelectorAll("score-part"));
  const partList = Array.from(doc.querySelectorAll("part"));

  const out = [];

  for (const sp of scoreParts) {
    const id = sp.getAttribute("id");
    if (!id) continue;

    const nameNode = sp.querySelector("part-name");
    const partName = nameNode ? nameNode.textContent.trim() : id;

    const bodyPart = partList.find(p => p.getAttribute("id") === id);
    if (!bodyPart) continue;

    // Build a single-part score-partwise
    const newDoc = document.implementation.createDocument("", "", null);
    const score = newDoc.createElement("score-partwise");

    // Copy some header metadata if present
    const root = doc.querySelector("score-partwise, score-timewise") || doc.documentElement;
    const headerTags = ["work","identification","defaults","credit"];
    for (const tag of headerTags) {
      const node = root.querySelector(tag);
      if (node) score.appendChild(newDoc.importNode(node, true));
    }

    // Create part-list with just this score-part
    const pl = newDoc.createElement("part-list");
    pl.appendChild(newDoc.importNode(sp, true));
    score.appendChild(pl);

    // Append the single body part
    score.appendChild(newDoc.importNode(bodyPart, true));
    newDoc.appendChild(score);

    const singleXml = serializer.serializeToString(newDoc);
    out.push({ id, partName, xml: singleXml });
  }

  return out;
}

/* =========================================================================
   Step 3: Instrument Picker UI (left list → Add; right list → Selections)
   - Uses instrumentData.json (fields: name, instrumentPart, sortingOctave, clef, transpose, scoreOrder)
   ------------------------------------------------------------------------- */
(function(){
  document.addEventListener("DOMContentLoaded", () => {
    // Wire only if the UI exists
    const listLeft = qs("instrumentList");
    const btnAdd = qs("btnAddInstrument");
    const listRight = qs("selectionsList");
    const btnRemove = qs("btnRemoveSelected");
    const btnSave = qs("btnSaveSelections");
    if (!listLeft || !btnAdd || !listRight || !btnRemove || !btnSave) return;

    const stateSel = { selections: [] }; // instance labels (e.g., "Violin", "Violin 2")

    // Populate left list when instrumentData is ready
    (async () => {
      const s = getState();
      const instruments = Array.isArray(s.instrumentData) ? s.instrumentData : [];
      if (instruments.length) {
        listLeft.innerHTML = instruments.map(ins => `<option value="${escapeHtml(ins.name)}">${escapeHtml(ins.name)}</option>`).join("");
      } else {
        // if instrumentData loaded later, you could listen/refresh here
        console.warn("[AA] instrumentData missing; ensure instrumentData.json is reachable.");
      }
    })();

    function baseOf(name){ return String(name).replace(/\s+\d+$/, ""); }
    function refreshRight(){
      listRight.innerHTML = stateSel.selections.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
    }
    function addSelection(baseName){
      const count = stateSel.selections.filter(n => baseOf(n) === baseName).length;
      const label = count === 0 ? baseName : `${baseName} ${count+1}`;
      stateSel.selections.push(label);
      refreshRight();
    }
    function removeSelection(label){
      const i = stateSel.selections.indexOf(label);
      if (i>=0) stateSel.selections.splice(i,1);
      // Renumber the remaining of same base
      const b = baseOf(label);
      const idxs = stateSel.selections
        .map((n,i)=>({n,i}))
        .filter(x => baseOf(x.n) === b)
        .map(x=>x.i);
      if (idxs.length === 1) {
        stateSel.selections[idxs[0]] = b;
      } else if (idxs.length > 1) {
        idxs.forEach((ii,k)=> stateSel.selections[ii] = `${b} ${k+1}`);
      }
      refreshRight();
    }

    btnAdd.addEventListener("click", () => {
      const sel = listLeft.value;
      if (!sel) return;
      addSelection(sel);
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
          instanceLabel: label,                 // "Violin 2"
          instrumentPart: meta.instrumentPart || "",
          sortingOctave: Number(meta.sortingOctave)||0,
          clef: meta.clef ?? null,
          transpose: meta.transpose ?? null,
          scoreOrder: Number(meta.scoreOrder)||999,
          assignedPart: ""                      // placeholder
        };
      });
      mergeState({ instrumentSelections });
      // Next module will listen for this:
      // showArrangingLoading(); // enable once pipeline continues
      AA.emit("instruments:saved");
    });
  });
})();




/* =========================================================================
   Pipeline reset/boot (runs immediately after "Save Selections")
   - Clears any previous processing artifacts
   - Shows the "Arranging Custom Score..." overlay
   ------------------------------------------------------------------------- */
(function(){
  AA.on("instruments:saved", () => AA.safe("pipelineReset", reset));

  function reset(){
    const s = getState();
    // Keep only selection/context; clear downstream artifacts
    setState({
      // context we keep
      packIndex: s.packIndex,
      pack: s.pack,
      songIndex: s.songIndex,
      song: s.song,
      selectedSong: s.selectedSong,
      libraryPacks: s.libraryPacks,
      instrumentData: s.instrumentData,
      instrumentSelections: s.instrumentSelections,

      // clear/initialize pipeline outputs
      parts: Array.isArray(s.parts) ? s.parts : [],
      assignedResults: [],
      groupedAssignments: [],
      arrangedFiles: [],
      combinedScoreXml: "",

      // stage flags
      arrangeDone: false,
      renameDone: false,
      reassignByScoreDone: false,
      combineDone: false,

      // timestamp for debugging
      timestamp: Date.now()
    });

    // Show loading screen while the modules run
    showArrangingLoading();
  }
})();










