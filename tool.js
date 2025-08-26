/* =========================================================================
   Auto Arranger - Unified tool.js
   Draft 1 + Modules: selection → extract → assign → group → arrange → rename
   → re-ID by scoreOrder → combine → view

   Storage key
   ------------------------------------------------------------------------- */
const STATE_KEY = "autoArranger_extractedParts";

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
    suspendEvents(fn){
      suspendDepth++;
      try { fn(); } finally { suspendDepth--; }
    }
  };
  return API;
})();

/* =========================================================================
   Utilities: state, DOM helpers, loading overlay
   ------------------------------------------------------------------------- */
function getState() {
  try { return JSON.parse(sessionStorage.getItem(STATE_KEY) || "{}"); }
  catch { return {}; }
}
function setState(next) {
  AA.suspendEvents(() => sessionStorage.setItem(STATE_KEY, JSON.stringify(next)));
}
function mergeState(patch) {
  const s = getState();
  setState({ ...s, ...patch });
}

function qs(id){ return document.getElementById(id); }
function ce(tag, props){ const el = document.createElement(tag); if(props) Object.assign(el, props); return el; }

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
   Boot: wire Draft-1 UI (Library → Song → Extract → Instruments)
   ------------------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  initDraft1UI().catch(e => console.error("[initDraft1UI]", e));
});

async function initDraft1UI(){
  // Fetch library packs and instruments
  const [packs, instruments] = await Promise.all([loadLibraryIndex(), loadInstrumentData()]);
  mergeState({ libraryPacks: packs, instrumentData: instruments });

  // STEP 1: Library
  const libSel = qs("librarySelect");
  if (libSel) {
    libSel.innerHTML = `<option value="">-- Select a Library Pack --</option>` +
      packs.map((p,i)=> `<option value="${i}">${escapeHtml(p.name)}</option>`).join("");
    libSel.addEventListener("change", onLibraryChosen);
  }

  // STEP 2: Song
  const songSel = qs("songSelect");
  if (songSel) {
    songSel.addEventListener("change", onSongChosen);
  }

  // STEP 3: Instrument selection
  wireInstrumentPicker(instruments);

  // Restore stepper UI if state already has choices
  const s = getState();
  if (s.packIndex != null) {
    libSel.value = String(s.packIndex);
    populateSongsForPack(s.packIndex);
    qs("step2")?.classList.remove("hidden");
  }
  if (s.songIndex != null) {
    songSel.value = String(s.songIndex);
    // When song selected, extraction happens automatically
    // So we trigger it if not done yet.
    if (!Array.isArray(s.parts) || !s.parts.length) {
      onSongChosen();
    } else {
      qs("step3")?.classList.remove("hidden");
    }
  }
}

/* ------------ Library & Song ------------ */
async function loadLibraryIndex(){
  // expects either:
  // { "packs": [ { "name": "...", "songs": [ { "name":"...", "url":"..." } ] }, ... ] }
  // or just: [ { "name": "...", "songs": [...] }, ... ]
  const data = await fetchJson(`${DATA_BASE}/libraryData.json`); // <-- renamed file
  return Array.isArray(data.packs) ? data.packs
       : Array.isArray(data)       ? data
       : [];
}

async function loadInstrumentData(){
  // expects array of objects with: name, instrumentPart, sortingOctave, clef, transpose, scoreOrder
  const res = await fetch("./instrumentData.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load instrumentData.json");
  return await res.json();
}

function populateSongsForPack(packIndex){
  const packs = getState().libraryPacks || [];
  const pack = packs[packIndex];
  const songSel = qs("songSelect");
  if (!pack || !songSel) return;

  songSel.innerHTML = `<option value="">-- Select a Song --</option>` +
    pack.songs.map((s,i)=> `<option value="${i}">${escapeHtml(s.name)}</option>`).join("");
}

function onLibraryChosen(){
  const idx = parseInt(qs("librarySelect").value, 10);
  if (!Number.isFinite(idx)) return;
  const packs = getState().libraryPacks || [];
  const pack = packs[idx];
  mergeState({ packIndex: idx, pack: pack?.name || "", songIndex: null, song: null, parts: [] });

  populateSongsForPack(idx);

  // Go to Step 2
  qs("step2")?.classList.remove("hidden");
  qs("step1")?.classList.add("hidden");
  // Clear any previous song selection
  if (qs("songSelect")) qs("songSelect").value = "";
}

async function onSongChosen(){
  const s = getState();
  const pack = (s.libraryPacks || [])[s.packIndex];
  if (!pack) return;
  const songIdx = parseInt(qs("songSelect").value, 10);
  if (!Number.isFinite(songIdx)) return;
  const song = pack.songs[songIdx];

  mergeState({ songIndex: songIdx, song: song?.name || "", selectedSong: song });

  // Auto extract parts (no UI), then go to instruments
  if (song?.url) {
    try {
      const text = await fetch(song.url, { cache: "no-store" }).then(r => r.text());
      const parts = extractPartsFromScore(text);
      mergeState({ parts });
      // Proceed to instrument selection
      qs("step3")?.classList.remove("hidden");
      qs("step2")?.classList.add("hidden");
    } catch (e) {
      console.error("[extractPartsFromScore]", e);
      alert("Failed to extract parts from this song.");
    }
  }
}

/* ------------ XML extraction ------------ */
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

    // Copy score header (work, identification, etc.) shallowly if present
    const headerNodes = ["work","identification","defaults","credit","part-list"];
    const root = doc.querySelector("score-partwise, score-timewise") || doc.documentElement;
    for (const tag of headerNodes) {
      const node = root.querySelector(tag);
      if (node && tag !== "part-list") {
        score.appendChild(newDoc.importNode(node, true));
      }
    }

    // Create part-list holding just this score-part
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
   Step 3: Instrument Picker UI (left Instruments, right Selections)
   ------------------------------------------------------------------------- */
function wireInstrumentPicker(instruments){
  const listLeft = qs("instrumentList");
  const btnAdd = qs("btnAddInstrument");
  const listRight = qs("selectionsList");
  const btnRemove = qs("btnRemoveSelected");
  const btnSave = qs("btnSaveSelections");

  if (listLeft) {
    listLeft.innerHTML = instruments.map(ins => `<option value="${escapeHtml(ins.name)}">${escapeHtml(ins.name)}</option>`).join("");
  }

  const stateSel = {
    selections: [] // array of instance names, e.g., "Violin", "Violin 2"
  };

  function refreshRight(){
    if (!listRight) return;
    listRight.innerHTML = stateSel.selections.map((name,i)=> `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
  }

  function addSelection(baseName){
    // count existing of same base
    const current = stateSel.selections.filter(n => baseOf(n) === baseName).length;
    const label = current === 0 ? baseName : `${baseName} ${current+1}`;
    stateSel.selections.push(label);
    refreshRight();
  }

  function removeSelection(label){
    const idx = stateSel.selections.indexOf(label);
    if (idx>=0) stateSel.selections.splice(idx,1);
    // Renumber this base
    renumberBase(baseOf(label));
    refreshRight();
  }

  function renumberBase(base){
    const all = stateSel.selections;
    const idxs = all
      .map((n,i)=> ({n,i}))
      .filter(x => baseOf(x.n) === base)
      .map(x=>x.i);
    if (idxs.length === 1) {
      // single -> no number suffix
      all[idxs[0]] = base;
    } else if (idxs.length > 1) {
      idxs.forEach((i,k) => { all[i] = `${base} ${k+1}`; });
    }
  }

  function baseOf(name){ return String(name).replace(/\s+\d+$/, ""); }

  btnAdd?.addEventListener("click", () => {
    const sel = listLeft?.value;
    if (!sel) return;
    addSelection(sel);
  });

  btnRemove?.addEventListener("click", () => {
    const sel = listRight?.value;
    if (!sel) return;
    removeSelection(sel);
  });

  btnSave?.addEventListener("click", () => {
    const s = getState();
    const metaIndex = Object.fromEntries((s.instrumentData||[]).map(m => [m.name, m]));
    // Build instrumentSelections with full meta
    const instrumentSelections = stateSel.selections.map(label => {
      const base = label.replace(/\s+\d+$/, "");
      const meta = metaIndex[base] || {};
      return {
        name: base,
        instanceLabel: label,              // "Violin 2"
        instrumentPart: meta.instrumentPart || "",
        sortingOctave: Number(meta.sortingOctave)||0,
        clef: meta.clef ?? null,
        transpose: meta.transpose ?? null, // cleaned per module during arrange
        scoreOrder: Number(meta.scoreOrder)||999,
        assignedPart: ""                   // placeholder
      };
    });

    mergeState({ instrumentSelections });
    // kick off pipeline
    showArrangingLoading();
    AA.emit("instruments:saved");
  });
}




/* =========================================================================
   Module: assignParts (uses sortingOctave; 7–15 passthrough)
   Rules:
   - Any instrument with instrumentPart ∈ {7..15} => assignedPart = instrumentPart; sortNumber = null
   - For 1..6: sortNumber = base(1..6) then adjust by sortingOctave (positive subtract, negative add abs)
   - After tie-break (alphabetical -> +0.1, +0.2...), assign:
     * lowest sortNumber -> "1 Melody"
     * highest sortNumber -> "6 Bass" (if at least 2 instruments)
     * next four lowest -> 2,4,3,5
     * remaining (lowest→highest) cycle 1,6,2,4,3,5
   ------------------------------------------------------------------------- */
(function(){
  AA.on("instruments:saved", () => AA.safe("assignParts", run));

  const PART_LABELS = [
    "1 Melody",
    "2 Harmony I",
    "3 Harmony II",
    "4 Counter Melody",
    "5 Counter Melody Harmony",
    "6 Bass",
    "7 Groove",
    "8 Chords",
    "9 Drum Kit",
    "10 Melody & Bass",
    "11 Melody & Chords",
    "12 Chords & Bass",
    "13 Melody & Chords & Bass",
    "14 Timpani",
    "15 Triangle"
  ];

  function run(){
    const state = getState();
    const sel = Array.isArray(state.instrumentSelections) ? state.instrumentSelections : [];
    if (!sel.length) return;

    const rows = sel.map(item => {
      const ipIdx = indexOfPart(item.instrumentPart);
      let sortNum = null;
      if (ipIdx >=1 && ipIdx<=6) {
        sortNum = ipIdx;
        const oct = Number(item.sortingOctave)||0;
        if (oct > 0) sortNum -= oct;
        else if (oct < 0) sortNum += Math.abs(oct);
      }
      return {
        label: item.instanceLabel, // "Violin 2"
        base: item.name,           // "Violin"
        instrumentPart: item.instrumentPart,
        sortingOctave: item.sortingOctave,
        clef: item.clef,
        transpose: item.transpose,
        scoreOrder: item.scoreOrder,
        sortNumber: sortNum,
        assignedPart: ""
      };
    });

    // Early assignment for 7..15
    for (const r of rows) {
      const idx = indexOfPart(r.instrumentPart);
      if (idx >=7 && idx<=15) r.assignedPart = formatPart(idx);
    }

    // Numeric pool 1..6 only (and not already locked by 7..15)
    const pool = rows.filter(r => r.sortNumber != null && !r.assignedPart);

    // Tie-break: group by integer sortNumber
    pool.sort((a,b) => (a.sortNumber - b.sortNumber) || String(a.label).localeCompare(b.label));
    // now inject decimal tie-breaks by alpha within same integer
    for (let i=0; i<pool.length;) {
      const intVal = Math.floor(pool[i].sortNumber);
      let j = i;
      while (j<pool.length && Math.floor(pool[j].sortNumber) === intVal) j++;
      const group = pool.slice(i, j);
      group.forEach((r,k) => r.sortNumber = Number((intVal + (k+1)/10).toFixed(2)));
      i = j;
    }
    // Re-sort by new decimals
    pool.sort((a,b) => a.sortNumber - b.sortNumber);

    // Assign required pattern:
    // lowest -> 1, highest -> 6, next 4 -> 2,4,3,5; remaining cycle {1,6,2,4,3,5}
    if (pool.length >= 1) pool[0].assignedPart = "1 Melody";
    if (pool.length >= 2) {
      const hi = pool[pool.length-1];
      hi.assignedPart = "6 Bass";
    }

    // Middle set (excluding the two finalized)
    const mids = pool.filter(r => r.assignedPart === "");
    // next four (lowest to highest) -> 2,4,3,5
    const firstFour = mids.splice(0,4);
    const orderFirst4 = ["2 Harmony I", "4 Counter Melody", "3 Harmony II", "5 Counter Melody Harmony"];
    firstFour.forEach((r,idx) => r.assignedPart = orderFirst4[idx]);

    // Remaining cycle
    const cycle = ["1 Melody","6 Bass","2 Harmony I","4 Counter Melody","3 Harmony II","5 Counter Melody Harmony"];
    for (let i=0; i<mids.length; i++) {
      mids[i].assignedPart = cycle[i % cycle.length];
    }

    // Merge back assignments
    const assignedResults = rows.map(r => ({
      name: r.label,
      baseName: r.base,
      instrumentPart: r.instrumentPart,
      assignedPart: r.assignedPart || "",   // empty if 7..15 didn't exist? (No, set above)
      sortNumber: r.sortNumber,
      sortingOctave: r.sortingOctave,
      clef: r.clef,
      transpose: r.transpose,
      scoreOrder: r.scoreOrder
    }));

    mergeState({ assignedResults });
    // Next stage
    AA.emit("assign:done");
  }

  function indexOfPart(label){
    const norm = String(label||"").replace(/\s+/g," ").trim().toLowerCase();
    for (let i=0;i<PART_LABELS.length;i++){
      if (PART_LABELS[i].toLowerCase() === norm) return i+1;
    }
    return -1;
  }
  function formatPart(n){ return PART_LABELS[n-1] || String(n); }
})();




/* =========================================================================
   Module: groupAssignments — match assignedPart to extracted partName
   ------------------------------------------------------------------------- */
(function(){
  AA.on("assign:done", () => AA.safe("groupAssignments", run));
  function run(){
    const state = getState();
    const parts = Array.isArray(state.parts) ? state.parts : [];
    const assigned = Array.isArray(state.assignedResults) ? state.assignedResults : [];
    if (!parts.length || !assigned.length) return;

    const norm = s => String(s||"").toLowerCase().replace(/\s+/g," ").trim();
    const byName = new Map(parts.map(p => [norm(p.partName), p]));

    const groups = [];
    for (const p of parts) {
      const key = norm(p.partName);
      const members = assigned.filter(a => norm(a.assignedPart) === key);
      groups.push({ partName: p.partName, partId: p.id, instruments: members });
    }

    mergeState({ groupedAssignments: groups });
    AA.emit("group:done");
  }
})();




/* =========================================================================
   Module: arrangeGroupedParts — Clef & Transpose only, NO octave edits
   Also set part-name to instrument instance label, part-abbreviation → "abbrev."
   ------------------------------------------------------------------------- */
(function () {
  AA.on("group:done", () => AA.safe("arrangeGroupedParts", run));

  function run() {
    const state = getState();
    const parts = Array.isArray(state.parts) ? state.parts : [];
    const groups = Array.isArray(state.groupedAssignments) ? state.groupedAssignments : [];
    if (!parts.length || !groups.length) return;

    const partByName = new Map(parts.map(p => [norm(p.partName), p]));
    const arranged = [];

    for (const grp of groups) {
      const src = partByName.get(norm(grp.partName));
      if (!src) continue;

      for (const inst of (grp.instruments || [])) {
        try {
          const xml = arrangeXmlForInstrument(src.xml, inst.name, inst.instanceLabel, {
            clef: inst.clef ?? null,
            transpose: inst.transpose ?? null
          });
          arranged.push({
            instrumentName: inst.instanceLabel, // "Violin 2"
            baseName: inst.name,                // "Violin"
            assignedPart: inst.assignedPart,
            sourcePartId: src.id,
            sourcePartName: src.partName,
            xml
          });
        } catch (e) {
          console.error(`[arrangeGroupedParts] transform failed for ${inst.instanceLabel}`, e);
        }
      }
    }

    mergeState({ arrangedFiles: arranged, arrangeDone: true });
    AA.emit("arrange:done");
  }

  const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g," ").trim();

  function arrangeXmlForInstrument(singlePartXml, baseName, instanceLabel, meta) {
    const { clef, transpose } = meta;
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(singlePartXml, "application/xml");

    // (1) part-name → instrument instance; part-abbreviation → "abbrev."
    const scorePart = xmlDoc.querySelector("score-part");
    const partName = scorePart?.querySelector("part-name");
    if (partName) partName.textContent = instanceLabel;
    const partAbbrev = scorePart?.querySelector("part-abbreviation");
    if (partAbbrev) partAbbrev.textContent = "abbrev.";

    // (2) Clef replacement (if provided)
    if (clef) {
      const firstClef = xmlDoc.querySelector("attributes > clef");
      if (firstClef) {
        while (firstClef.firstChild) firstClef.removeChild(firstClef.firstChild);
        const tpl = clef === "bass"
          ? `<sign>F</sign><line>4</line>`
          : (clef === "alto"
              ? `<sign>C</sign><line>3</line>`
              : `<sign>G</sign><line>2</line>`); // treble default
        const frag = parser.parseFromString(`<x>${tpl}</x>`, "application/xml");
        const x = frag.querySelector("x");
        while (x.firstChild) firstClef.appendChild(x.firstChild);
      }
    }

    // (3) Transpose: clear all, then insert only meta.transpose (if any) into first <attributes>
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

    // (4) Cleanups
    xmlDoc.querySelectorAll("lyric").forEach(n => n.remove());
    xmlDoc.querySelectorAll("harmony").forEach(n => n.remove());

    return new XMLSerializer().serializeToString(xmlDoc);
  }
})();




/* =========================================================================
   Module: reassignPartNamesAbbrev (safety pass; already set in arranger)
   ------------------------------------------------------------------------- */
(function(){
  AA.on("arrange:done", () => AA.safe("renameParts", run));
  function run(){
    const state = getState();
    const arranged = Array.isArray(state.arrangedFiles) ? state.arrangedFiles : [];
    for (const f of arranged) {
      try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(f.xml, "application/xml");
        const sp = xmlDoc.querySelector("score-part");
        const pn = sp?.querySelector("part-name");
        if (pn) pn.textContent = f.instrumentName;
        const pa = sp?.querySelector("part-abbreviation");
        if (pa) pa.textContent = "abbrev.";
        f.xml = new XMLSerializer().serializeToString(xmlDoc);
      } catch(e){ console.warn("[renameParts]", e); }
    }
    mergeState({ arrangedFiles: arranged, renameDone: true });
    AA.emit("rename:done");
  }
})();




/* =========================================================================
   Module: reassignPartIdsByScoreOrder
   - Uses base scoreOrder + .(instance number / 10) for duplicates
   - Assigns P1..Pn by ascending effective scoreOrder
   ------------------------------------------------------------------------- */
(function(){
  AA.on("rename:done", () => AA.safe("reassignPartIdsByScoreOrder", run));

  // Fallback (if instrumentSelections missing scoreOrder)
  const FALLBACK_ORDER = {
    "Piccolo": 1, "Flute": 2, "Oboe": 3, "Bb Clarinet": 4, "Bassoon": 5,
    "Violin": 6, "Viola": 7, "Cello": 8, "Double Bass": 9
  };

  function run(){
    const state = getState();
    const arranged = Array.isArray(state.arrangedFiles) ? state.arrangedFiles : [];
    if (!arranged.length) return;

    // Build base order from selections
    const baseOrder = new Map();
    const selections = Array.isArray(state.instrumentSelections) ? state.instrumentSelections : [];
    for (const s of selections) {
      if (s?.name && Number.isFinite(Number(s.scoreOrder))) baseOrder.set(String(s.name), Number(s.scoreOrder));
    }
    // Fill gaps
    for (const [k,v] of Object.entries(FALLBACK_ORDER)) if (!baseOrder.has(k)) baseOrder.set(k, v);

    const rows = arranged.map(f => {
      const base = String(f.baseName || f.instrumentName).replace(/\s+\d+$/,"");
      const baseVal = baseOrder.get(base);
      const m = String(f.instrumentName).match(/\s+(\d+)$/);
      const idx = m ? parseInt(m[1], 10) : 0;
      const eff = (Number.isFinite(baseVal)? baseVal : 999) + (idx>0 ? idx/10 : 0);
      return { f, effOrder: eff };
    });

    rows.sort((a,b)=> a.effOrder - b.effOrder);

    for (let i=0;i<rows.length;i++){
      const file = rows[i].f;
      const newId = `P${i+1}`;
      const oldId = extractPid(file.xml);
      if (!oldId) continue;
      file.xml = file.xml.split(oldId).join(newId);
      file.newPartId = newId;
    }

    mergeState({ arrangedFiles: arranged, reassignByScoreDone: true });
    AA.emit("reid:done");
  }

  function extractPid(xml){
    const m = String(xml||"").match(/<score-part\s+id="([^"]+)"/i);
    return m ? m[1] : null;
  }
})();




/* =========================================================================
   Module: combineArrangedParts → combinedScoreXml
   ------------------------------------------------------------------------- */
(function(){
  AA.on("reid:done", () => AA.safe("combineArrangedParts", run));

  function run(){
    const state = getState();
    const files = Array.isArray(state.arrangedFiles) ? state.arrangedFiles : [];
    if (!files.length) return;

    const rows = [];
    for (const f of files) {
      const pid = f.newPartId || extractPidFromXml(f.xml);
      if (!pid) continue;
      const num = parseInt(String(pid).replace(/^P/i, ""), 10);
      rows.push({ f, partId: pid, partNum: Number.isFinite(num) ? num : Number.POSITIVE_INFINITY });
    }
    rows.sort((a,b)=> (a.partNum - b.partNum) || String(a.partId).localeCompare(String(b.partId)));

    let combined = rows[0].f.xml;
    combined = combined.replace(/<\/score-partwise>\s*$/i, "");

    for (let i=1;i<rows.length;i++){
      const { f, partId } = rows[i];
      const text = f.xml;
      const scorePartBlock = block(text, `<score-part\\s+id="${esc(partId)}">`, `</score-part>`);
      if (scorePartBlock) {
        const plEnd = combined.lastIndexOf("</part-list>");
        if (plEnd !== -1) combined = combined.slice(0,plEnd) + "\n" + scorePartBlock + combined.slice(plEnd);
      }
      const partBlock = block(text, `<part\\s+id="${esc(partId)}">`, `</part>`);
      if (partBlock) {
        const rootEnd = combined.lastIndexOf("</score-partwise>");
        if (rootEnd !== -1) combined = combined.slice(0, rootEnd) + "\n" + partBlock + combined.slice(rootEnd);
        else combined += "\n" + partBlock;
      }
    }
    if (!/<\/score-partwise>\s*$/i.test(combined)) combined += "\n</score-partwise>";

    mergeState({ combinedScoreXml: combined, combineDone: true });
    AA.emit("combine:done");
  }

  function block(xml, startRe, endTag){
    const re = new RegExp(`${startRe}[\\s\\S]*?${endTag}`, "i");
    const m = String(xml).match(re);
    return m ? m[0] : null;
  }
  function extractPidFromXml(xml){
    const m = String(xml||"").match(/<score-part\s+id="([^"]+)"/i);
    return m ? m[1] : null;
  }
  function esc(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
})();




/* =========================================================================
   FINAL VIEWER (centered, back clears processing, shrink-to-fit vertical)
   Loads OSMD/html2canvas/jsPDF from repo root
   ------------------------------------------------------------------------- */
(function () {
  AA.on("combine:done", () => AA.safe("finalViewer", bootWhenReady));

  async function bootWhenReady() {
    // guard
    if (document.getElementById('aa-viewer')) return;

    await ensureLib("opensheetmusicdisplay", "./opensheetmusicdisplay.min.js");
    await ensureLib("html2canvas", "./html2canvas.min.js");
    await ensureLib("jspdf", "./jspdf.umd.min.js");

    buildViewerUI();
  }

  function ensureLib(globalName, src) {
    return new Promise(resolve => {
      if (lookupGlobal(globalName)) return resolve(true);
      const script = document.createElement("script");
      script.src = src;
      script.onload = () => resolve(true);
      script.onerror = () => { console.warn(`[finalViewer] Failed to load ${src}`); resolve(false); };
      document.head.appendChild(script);
    });
  }
  function lookupGlobal(name) { return name.split(".").reduce((o,k)=> (o && o[k]!=null ? o[k] : null), window); }

  function buildViewerUI() {
    // de-dupe
    document.querySelectorAll('#aa-viewer').forEach(n => n.remove());

    const state = getState();
    const songName = state?.selectedSong?.name || state?.song || "Auto Arranger Result";
    const partsRaw = Array.isArray(state.arrangedFiles) ? state.arrangedFiles : [];
    const hasScore = typeof state.combinedScoreXml === "string" && state.combinedScoreXml.length > 0;

    const parts = sortPartsByPid(partsRaw);

    const wrap = ce("div");
    wrap.id = "aa-viewer";
    wrap.style.cssText = `
      position: fixed; inset: 0; z-index: 99999;
      display: flex; flex-direction: column;
      height: 100vh; background: rgba(0,0,0,0.08);
      padding: 28px; box-sizing: border-box; overflow:hidden;
    `;

    const backBtn = ce("button");
    backBtn.textContent = "← Back";
    backBtn.title = "Back to instrument selection";
    backBtn.style.cssText = `
      position: absolute; top: 16px; left: 16px; padding: 8px 12px; border-radius: 8px; border: none;
      background: #e5e7eb; color: #111; font: 600 13px system-ui; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.06);
    `;
    backBtn.addEventListener("click", () => backToInstrumentSelection(state));
    wrap.appendChild(backBtn);

    const card = ce("div");
    card.style.cssText = `
      margin: auto; width: min(1200px, 100%); height: calc(100vh - 56px);
      background: #ffffff; border-radius: 14px; box-shadow: 0 12px 36px rgba(0,0,0,0.18);
      padding: 20px 20px 18px; box-sizing: border-box; display: flex; flex-direction: column; gap: 10px; overflow: hidden;
    `;
    wrap.appendChild(card);

    const title = ce("h2", { textContent: songName });
    title.style.cssText = `margin:0; text-align:center; color:#000; font:700 20px/1.2 system-ui,Arial`;
    card.appendChild(title);

    const controls = ce("div");
    controls.style.cssText = `display:flex; flex-direction:column; align-items:center; gap:8px; margin-top:2px;`;
    card.appendChild(controls);

    const label = ce("div", { textContent: "Select Score or Part" });
    label.style.cssText = `color:#000; font:600 13px/1 system-ui;`;
    controls.appendChild(label);

    const select = ce("select");
    select.id = "aa-viewer-select";
    select.style.cssText = `padding:8px 10px; font:14px system-ui;`;
    if (hasScore) select.appendChild(new Option("Score","__SCORE__"));
    for (const p of parts) select.appendChild(new Option(p.instrumentName, p.instrumentName));
    controls.appendChild(select);

    const btnRow = ce("div");
    btnRow.style.cssText = `display:flex; gap:8px; flex-wrap:nowrap; justify-content:center; align-items:center;`;
    btnRow.innerHTML = `
      <button id="aa-btn-visualize" class="aa-btn">Visualize</button>
      <button id="aa-btn-pdf" class="aa-btn" disabled>Download PDF</button>
      <button id="aa-btn-xml" class="aa-btn" disabled>Download XML</button>
      <button id="aa-btn-pdf-all" class="aa-btn">Download PDF All Parts</button>
      <button id="aa-btn-xml-all" class="aa-btn">Download XML ALL Parts</button>
    `;
    controls.appendChild(btnRow);

    const styleBtn = ce("style");
    styleBtn.textContent = `
      .aa-btn { padding:8px 12px; border-radius:8px; background:#0f62fe; color:white; border:none; cursor:pointer; font:600 13px system-ui; }
      .aa-btn[disabled] { opacity:0.5; cursor:not-allowed; }
      .aa-btn:hover:not([disabled]) { filter:brightness(0.92); }
    `;
    card.appendChild(styleBtn);

    const osmdBox = ce("div");
    osmdBox.id = "aa-osmd-box";
    osmdBox.style.cssText = `
      margin-top:8px; border:1px solid #e5e5e5; border-radius:10px; background:#fff; padding:14px;
      flex:1 1 auto; min-height:0; overflow-y:hidden; overflow-x:auto; white-space:nowrap;
    `;
    card.appendChild(osmdBox);

    document.body.appendChild(wrap);

    const OSMD = lookupGlobal("opensheetmusicdisplay");
    const osmd = new OSMD.OpenSheetMusicDisplay(osmdBox, { autoResize:true, backend:"svg", drawingParameters:"default" });

    window.addEventListener("resize", () => fitScoreToHeight(osmd, osmdBox));

    const btnVis = btnRow.querySelector("#aa-btn-visualize");
    const btnPDF = btnRow.querySelector("#aa-btn-pdf");
    const btnXML = btnRow.querySelector("#aa-btn-xml");
    const btnPDFAll = btnRow.querySelector("#aa-btn-pdf-all");
    const btnXMLAll = btnRow.querySelector("#aa-btn-xml-all");

    let lastXml = "";

    btnVis.addEventListener("click", async () => {
      const { xml } = pickXml(select.value);
      if (!xml) return alert("No XML found to visualize.");

      try {
        lastXml = xml;
        const processed = transformXmlForSlashes(xml);

        if (typeof osmd.zoom === "number") osmd.zoom = 1.0;
        await osmd.load(processed);
        await osmd.render();

        await new Promise(r => requestAnimationFrame(r));
        fitScoreToHeight(osmd, osmdBox);

        btnPDF.disabled = false;
        btnXML.disabled = false;
      } catch(e){
        console.error("[finalViewer] render failed", e);
        alert("Failed to render this selection.");
      }
    });

    btnPDF.addEventListener("click", async () => {
      if (!lastXml) return alert("Load a score/part first.");
      await exportCurrentViewToPdf(osmdBox, select.value.replace(/[^a-z0-9 _-]/gi,"") || "score");
    });
    btnXML.addEventListener("click", () => {
      if (!lastXml) return alert("Load a score/part first.");
      const name = (select.value === "__SCORE__" ? "Score" : select.value) || "part";
      downloadText(lastXml, `${safe(name)}.musicxml`, "application/xml");
    });
    btnPDFAll.addEventListener("click", async () => {
      const parts = sortPartsByPid(Array.isArray(getState().arrangedFiles)?getState().arrangedFiles:[]);
      if (!parts.length) return alert("No parts found.");
      const jspdfNS = window.jspdf || window.jspdf?.jsPDF ? window.jspdf : window;
      const jsPDF = jspdfNS.jsPDF || jspdfNS.JSPDF || jspdfNS.jsPDFConstructor;
      if (!jsPDF) return alert("jsPDF not available.");

      const docName = `${safe(songName)} - All Parts.pdf`;
      let doc = null;
      for (const p of parts) {
        try {
          const processed = transformXmlForSlashes(p.xml);
          await osmd.load(processed);
          await osmd.render();
          const { canvas, w, h } = await snapshotCanvas(osmdBox);
          if (!doc) doc = new (jspdfNS.jsPDF)({ orientation: w>=h?"landscape":"portrait", unit:"pt", format:[w,h] });
          else doc.addPage([w,h], w>=h?"landscape":"portrait");
          doc.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, w, h);
        } catch(e){ console.error("[finalViewer] PDF all parts failed on", p.instrumentName, e); }
      }
      if (doc) doc.save(docName);
    });
    btnXMLAll.addEventListener("click", async () => {
      const parts = sortPartsByPid(Array.isArray(getState().arrangedFiles)?getState().arrangedFiles:[]);
      if (!parts.length) return alert("No parts found.");
      for (const p of parts) {
        downloadText(p.xml, `${safe(p.instrumentName)}.musicxml`, "application/xml");
        await new Promise(r => setTimeout(r, 60));
      }
    });

    function pickXml(choice){
      const s = getState();
      if (choice === "__SCORE__") return { xml: s.combinedScoreXml || "" };
      const hit = (Array.isArray(s.arrangedFiles) ? s.arrangedFiles : []).find(f => f.instrumentName === choice);
      return { xml: hit?.xml || "" };
    }
  }

  /* viewer helpers */
  function sortPartsByPid(files){
    const out = [];
    for (const f of files) {
      const pid = f.newPartId || extractPidFromXml(f.xml);
      if (!pid) continue;
      const n = parseInt(String(pid).replace(/^P/i,""), 10);
      out.push({ ...f, _pnum: Number.isFinite(n)?n:999 });
    }
    out.sort((a,b)=> (a._pnum - b._pnum) || String(a.instrumentName).localeCompare(String(b.instrumentName)));
    return out;
  }
  function extractPidFromXml(xml){ const m = String(xml||"").match(/<score-part\s+id="([^"]+)"/i); return m ? m[1] : null; }
  function snapshotCanvas(container){ return html2canvas(container, { scale:2, backgroundColor:"#fff" }).then(canvas => ({canvas, w:canvas.width, h:canvas.height})); }
  async function exportCurrentViewToPdf(container, baseName){
    const { canvas, w, h } = await snapshotCanvas(container);
    const jspdfNS = window.jspdf || window.jspdf?.jsPDF ? window.jspdf : window;
    const jsPDF = jspdfNS.jsPDF || jspdfNS.JSPDF || jspdfNS.jsPDFConstructor;
    if (!jsPDF) return alert("jsPDF not loaded.");
    const pdf = new (jspdfNS.jsPDF)({ orientation: w>=h?"landscape":"portrait", unit:"pt", format:[w,h] });
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, w, h);
    pdf.save(`${safe(baseName)}.pdf`);
  }
  function backToInstrumentSelection(prevState){
    // clear processing, keep pack & song to auto-reselect
    const packName = prevState?.pack || prevState?.selectedPack?.name || "";
    const songName = prevState?.song || prevState?.selectedSong?.name || "";
    setState({ pack: packName, song: songName, packIndex: getState().packIndex, songIndex: getState().songIndex, timestamp: Date.now() });

    // remove any and all viewer overlays
    document.querySelectorAll('#aa-viewer').forEach(n => n.remove());
    hideArrangingLoading();

    // show Step 3 (instrument selection); user can adjust and Save again
    qs("step1")?.classList.add("hidden");
    qs("step2")?.classList.add("hidden");
    qs("step3")?.classList.remove("hidden");
  }

  function fitScoreToHeight(osmd, host){
    const svg = host.querySelector("svg");
    if (!svg) return;
    const maxH = host.clientHeight;
    if (!maxH) return;
    let svgH = 0;
    try { svgH = svg.getBBox().height; } catch {}
    if (!svgH) svgH = svg.clientHeight || svg.scrollHeight || svg.offsetHeight || 0;
    if (!svgH) return;
    const current = typeof osmd.zoom === "number" ? osmd.zoom : 1;
    let target = Math.min(current, maxH / svgH);
    if (!isFinite(target) || target <= 0) target = 1;
    target = Math.max(0.3, Math.min(1.5, target));
    if (Math.abs(target - current) > 0.01) { osmd.zoom = target; osmd.render(); }
  }

  // Simple slash-head transform (no-op if not needed)
  function transformXmlForSlashes(xmlString) {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlString, "application/xml");
      xmlDoc.querySelectorAll("lyric").forEach(n => n.remove()); // keep clean
      return new XMLSerializer().serializeToString(xmlDoc);
    } catch { return xmlString; }
  }
})();

/* =========================================================================
   Helpers
   ------------------------------------------------------------------------- */
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }
function safe(s){ return String(s||"").replace(/[\/\\:?*"<>|]+/g,"-"); }
