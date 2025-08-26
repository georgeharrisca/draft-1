document.addEventListener("DOMContentLoaded", () => {
  // ---- Step containers ----
  const step1 = document.getElementById("step1");
  const step2 = document.getElementById("step2");
  const step3 = document.getElementById("step3");

  // ---- Step 1 elements ----
  const librarySelect = document.getElementById("librarySelect");
  const packsStatus = document.getElementById("packsStatus");

  // ---- Step 2 elements ----
  const songSelect = document.getElementById("songSelect");
  const backButton = document.getElementById("backButton");
  const statusEl = document.getElementById("status");

  // ---- Step 3 elements ----
  const instrumentGrid = document.getElementById("instrumentGrid");
  const backToSong = document.getElementById("backToSong");
  const saveInstruments = document.getElementById("saveInstruments");
  const instStatus = document.getElementById("instStatus");

  // ---- Stepper dots (visual only) ----
  const dots = document.querySelectorAll(".stepper .dot");
  const setStep = (n) => dots.forEach((d,i)=>d.classList.toggle("active", i<=n));

  // ---- Choice flow (breadcrumb under stepper) ----
  const choiceFlow = document.getElementById("choiceFlow");
  const stateTrail = { library: "", song: "", instrumentsDone: false };
  const renderTrail = () => {
    const parts = [];
    if (stateTrail.library) parts.push(`<strong>${escapeHtml(stateTrail.library)}</strong>`);
    if (stateTrail.song) parts.push(`<strong>${escapeHtml(stateTrail.song)}</strong>`);
    if (stateTrail.instrumentsDone) parts.push(`<strong>Instruments Selected</strong>`);
    choiceFlow.innerHTML = parts.join(" &gt; ");
  };

  // ---- Data holders ----
  let libraryData = {};
  let instrumentData = [];

// Selection state for the two-pane UI
let selectionCounts = {};   // { "Violin": 3, "Cello": 1, ... }
let selectionOrder = [];    // keeps first-seen order of instrument names

  
  // JSON endpoints (relative or swap to raw GitHub)
  const LIBRARY_INDEX_URL = "./libraryData.json";
  const INSTRUMENT_INDEX_URL = "./instrumentData.json";

  // ====== Init ======
  init();

  async function init() {
    // Show only Step 1
    step1.classList.remove("hidden");
    step2.classList.add("hidden");
    step3.classList.add("hidden");
    setStep(0);
    stateTrail.library = "";
    stateTrail.song = "";
    stateTrail.instrumentsDone = false;
    renderTrail();

    await Promise.all([loadLibraryData(), loadInstrumentData()]);
  }

  async function loadLibraryData() {
    packsStatus.textContent = "Loading packs…";
    try {
      const res = await fetch(LIBRARY_INDEX_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      libraryData = await res.json();

      librarySelect.innerHTML = '<option value="">-- Choose a Library Pack --</option>';
      Object.keys(libraryData).forEach(packName => {
        const opt = document.createElement("option");
        opt.value = packName;      // key
        opt.textContent = packName; // display text
        librarySelect.appendChild(opt);
      });
      packsStatus.textContent = "";
    } catch (err) {
      console.error("Failed to load libraryData.json:", err);
      librarySelect.innerHTML = '<option value="">(Failed to load packs)</option>';
      packsStatus.textContent = "Could not load library packs. Ensure libraryData.json is deployed.";
      packsStatus.classList.add("err");
    }
  }

  async function loadInstrumentData() {
    try {
      const res = await fetch(INSTRUMENT_INDEX_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      instrumentData = await res.json();
    } catch (err) {
      console.error("Failed to load instrumentData.json:", err);
      instrumentData = [];
    }
  }

  // ====== Step 1 → Step 2 ======
  librarySelect.addEventListener("change", () => {
    const pack = librarySelect.value;
    if (!pack) return;

    // Visible text supports arbitrary pack names
    const packName = librarySelect.options[librarySelect.selectedIndex].textContent;

    // Update breadcrumb
    stateTrail.library = packName;
    stateTrail.song = "";
    stateTrail.instrumentsDone = false;
    renderTrail();

    // Populate songs
    songSelect.innerHTML = '<option value="">-- Choose a Song --</option>';
    (libraryData[pack] || []).forEach(song => {
      const opt = document.createElement("option");
      opt.value = song.url;
      opt.textContent = song.name;
      songSelect.appendChild(opt);
    });

    // Transition
    statusEl.textContent = "";
    step1.classList.add("hidden");
    step2.classList.remove("hidden");
    step3.classList.add("hidden");
    setStep(1);
  });

  // ====== Step 2: on song select → auto-extract → Step 3 ======
  songSelect.addEventListener("change", async () => {
    const songUrl = songSelect.value;
    if (!songUrl) return;

    // Breadcrumb update
    const songName = songSelect.options[songSelect.selectedIndex].textContent;
    stateTrail.song = songName;
    stateTrail.instrumentsDone = false;
    renderTrail();

    // Auto-extract
    statusEl.textContent = "Extracting parts…";
    try {
      const xmlText = await (await fetch(songUrl)).text();
      const partsPayload = extractParts(xmlText);

      const packName = librarySelect.options[librarySelect.selectedIndex].textContent;

      const state = {
        timestamp: Date.now(),
        pack: packName,
        song: songName,
        parts: partsPayload.parts,        // [{ id, partName, xml }]
        scoreMeta: partsPayload.scoreMeta // { movementTitle, composer, workTitle }
      };
      sessionStorage.setItem("autoArranger_extractedParts", JSON.stringify(state));

      statusEl.textContent = "Parts data ready.";
      statusEl.classList.remove("err");
      statusEl.classList.add("ok");

   function renderInstrumentSelectors() {
  // reset current selections each time we enter step 3
  selectionCounts = {};
  selectionOrder = [];

  // Build two-pane UI
  instrumentGrid.innerHTML = `
    <div class="two-pane">
      <div class="pane" id="paneLeft">
        <h4>Instruments</h4>
        <ul id="instList" class="list" role="listbox" aria-label="Available instruments"></ul>
        <div class="row" style="margin-top:12px;">
          <button id="addToScore" class="btn" type="button" disabled>Add to Score</button>
        </div>
      </div>
      <div class="pane" id="paneRight">
        <h4>Selections</h4>
        <ul id="selList" class="list" aria-live="polite"></ul>
      </div>
    </div>
  `;

  const instList = document.getElementById("instList");
  const selList  = document.getElementById("selList");
  const addBtn   = document.getElementById("addToScore");

  // Populate left list (no backend data shown)
  instrumentData.forEach(inst => {
    const li = document.createElement("li");
    li.textContent = inst.name;
    li.setAttribute("tabindex", "0");
    li.dataset.name = inst.name;
    instList.appendChild(li);
  });

  let selectedName = null;
  function setActive(li) {
    instList.querySelectorAll("li").forEach(n => n.classList.remove("active"));
    if (li) {
      li.classList.add("active");
      selectedName = li.dataset.name;
      addBtn.disabled = false;
    } else {
      selectedName = null;
      addBtn.disabled = true;
    }
  }

  instList.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    setActive(li);
  });
  instList.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      const li = e.target.closest("li");
      if (!li) return;
      e.preventDefault();
      setActive(li);
    }
  });

  addBtn.addEventListener("click", () => {
    if (!selectedName) return;
    if (!selectionCounts[selectedName]) {
      selectionCounts[selectedName] = 0;
      selectionOrder.push(selectedName);
    }
    selectionCounts[selectedName] += 1;
    renderSelections();
  });

  function renderSelections() {
    selList.innerHTML = "";
    if (!selectionOrder.length) {
      const empty = document.createElement("div");
      empty.className = "sel-empty";
      empty.textContent = "No selections yet";
      selList.appendChild(empty);
      return;
    }
    // For each instrument, render N numbered rows: Violin 1, Violin 2, ...
    for (const name of selectionOrder) {
      const count = selectionCounts[name] || 0;
      for (let i = 1; i <= count; i++) {
        const li = document.createElement("li");
        li.textContent = count > 1 ? `${name} ${i}` : name;
        selList.appendChild(li);
      }
    }
  }

  // initial empty state
  renderSelections();
}


  // Back Step 2 → Step 1
  backButton.addEventListener("click", () => {
    step2.classList.add("hidden");
    step1.classList.remove("hidden");
    step3.classList.add("hidden");
    librarySelect.value = "";
    songSelect.innerHTML = "";
    statusEl.textContent = "";
    setStep(0);

    // Clear breadcrumb
    stateTrail.library = "";
    stateTrail.song = "";
    stateTrail.instrumentsDone = false;
    renderTrail();
  });

  // ====== Step 3: Instruments UI ======
  function renderInstrumentSelectors() {
    instrumentGrid.innerHTML = "";
    instrumentData.forEach(inst => {
      const chrom = getChromaticFromTranspose(inst.transpose);
      const chromDisplay = chrom === null ? "—" : (chrom > 0 ? `+${chrom}` : `${chrom}`);

      const wrapper = document.createElement("div");
      wrapper.className = "inst-item";
      wrapper.innerHTML = `
        <h4>${escapeHtml(inst.name)}</h4>
        <div class="note">
          Part: ${escapeHtml(inst.instrumentPart)} • Octave: ${inst.Octave >= 0 ? "+"+inst.Octave : inst.Octave}<br>
          Clef: ${escapeHtml(inst.clef || "—")} • Transpose: ${chromDisplay}
        </div>
        <div style="margin-top:8px;">
          <label for="qty_${cssId(inst.name)}" style="margin:0 0 6px 0;">Quantity</label>
          <input id="qty_${cssId(inst.name)}" type="number" min="0" step="1" value="0" />
        </div>
      `;
      instrumentGrid.appendChild(wrapper);
    });
    instStatus.textContent = "";
  }

  function cssId(s){ return s.replace(/\s+/g, "_").replace(/[^\w\-]/g, ""); }
  function escapeHtml(s){ return String(s ?? "").replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }

  // Back Step 3 → Step 2
  backToSong.addEventListener("click", () => {
    step3.classList.add("hidden");
    step2.classList.remove("hidden");
    setStep(1);

    // Breadcrumb back to library > song
    stateTrail.instrumentsDone = false;
    renderTrail();
  });

  saveInstruments.addEventListener("click", () => {
  // Build selections from selectionCounts
  const selections = [];
  for (const [name, qty] of Object.entries(selectionCounts)) {
    if (qty > 0) {
      const meta = instrumentData.find(i => i.name === name);
      if (meta) {
        selections.push({
          name: meta.name,
          quantity: qty,                 // <-- counts from right pane
          instrumentPart: meta.instrumentPart,
          Octave: meta.Octave,
          clef: meta.clef ?? null,
          transpose: meta.transpose ?? null,
          assignedPart: ""               // placeholder
        });
      }
    }
  }

  const prevRaw = sessionStorage.getItem("autoArranger_extractedParts");
  const prevState = prevRaw ? JSON.parse(prevRaw) : {};
  const prevHadInst = Array.isArray(prevState.instrumentSelections);

  const state = { ...prevState, instrumentSelections: selections };
  sessionStorage.setItem("autoArranger_extractedParts", JSON.stringify(state));

  instStatus.textContent = selections.length
    ? `Saved ${selections.reduce((a,c)=>a+c.quantity,0)} instruments.`
    : "No instruments selected.";
  instStatus.classList.remove("err");
  instStatus.classList.add("ok");
  setStep(3);

  // Breadcrumb
  stateTrail.instrumentsDone = selections.length > 0;
  renderTrail();

  // If guard won’t emit (because instrumentSelections already existed), emit manually
  if (prevHadInst) {
    window.AA && AA.emit && AA.emit("instruments:saved", state);
  }
});


    const prev = sessionStorage.getItem("autoArranger_extractedParts");
    const state = prev ? JSON.parse(prev) : {};
    state.instrumentSelections = selections;
    sessionStorage.setItem("autoArranger_extractedParts", JSON.stringify(state));

    instStatus.textContent = selections.length
      ? `Saved ${selections.reduce((a,c)=>a+c.quantity,0)} instruments.`
      : "No instruments selected.";
    instStatus.classList.remove("err");
    instStatus.classList.add("ok");
    setStep(3);

    // Breadcrumb: add "Instruments Selected"
    stateTrail.instrumentsDone = selections.length > 0;
    renderTrail();
  });

  // ====== MusicXML extraction helpers ======
  function extractParts(xmlText) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlText, "application/xml");

    const movementTitle = textOrNull(xml.querySelector("movement-title"));
    const composer = textOrNull(xml.querySelector("identification creator[type='composer']")) ||
                     textOrNull(xml.querySelector("identification > creator"));
    const workTitle = textOrNull(xml.querySelector("work > work-title"));

    const partList = Array.from(xml.querySelectorAll("score-part"));
    const idToName = new Map();
    partList.forEach(sp => {
      const id = sp.getAttribute("id") || "";
      const pn = textOrNull(sp.querySelector("part-name")) || id;
      idToName.set(id, pn);
    });

    const parts = Array.from(xml.querySelectorAll("part")).map((partEl, idx) => {
      const id = partEl.getAttribute("id") || `P${idx+1}`;
      const partName = idToName.get(id) || `Part ${idx+1}`;
      const singleXml = buildSinglePartXml(xml, partEl, id, partName);
      return { id, partName, xml: singleXml };
    });

    return { scoreMeta: { movementTitle, workTitle, composer }, parts };
  }

  function textOrNull(node) { return node ? (node.textContent || "").trim() : null; }

  function buildSinglePartXml(fullDoc, partEl, partId, partName) {
    const serialize = node => new XMLSerializer().serializeToString(node);
    const optional = node => node ? serialize(node) : "";

    const movementTitle = fullDoc.querySelector("movement-title");
    const identification = fullDoc.querySelector("identification");
    const defaults = fullDoc.querySelector("defaults");
    const credits = fullDoc.querySelectorAll("credit");

    const scorePart = `<score-part id="${escapeXml(partId)}">
      <part-name>${escapeXml(partName)}</part-name>
    </score-part>`;

    const partString = serialize(partEl);

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  ${optional(movementTitle)}
  ${optional(identification)}
  ${optional(defaults)}
  ${Array.from(credits).map(serialize).join("")}
  <part-list>
    ${scorePart}
  </part-list>
  ${partString}
</score-partwise>`;
  }

  function escapeXml(s) {
    return String(s)
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&apos;");
  }

  // Parse a MusicXML <transpose> snippet to get the <chromatic> value (number), else null
  function getChromaticFromTranspose(transposeXml) {
    if (!transposeXml || typeof transposeXml !== "string") return null;
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(`<root>${transposeXml}</root>`, "application/xml");
      const chromNode = doc.querySelector("chromatic");
      if (!chromNode) return null;
      const n = parseInt(chromNode.textContent.trim(), 10);
      return Number.isFinite(n) ? n : null;
    } catch { return null; }
  }
});
/* ========== Auto Arranger: Draft 1 Guard/Module Layer (append-only) ========== */
(function () {
  const AA = (window.AA = window.AA || {});
  AA.VERSION = "draft-1";
  AA.DEBUG = false; // set true for verbose console logs

  // --- tiny event bus ---
  const listeners = {};
  AA.on = function (evt, fn) { (listeners[evt] ||= []).push(fn); return () => AA.off(evt, fn); };
  AA.off = function (evt, fn) { const a = listeners[evt]; if (!a) return; const i = a.indexOf(fn); if (i > -1) a.splice(i, 1); };
  AA.emit = function (evt, payload) {
    (listeners[evt] || []).forEach(fn => { try { fn(payload); } catch (e) { console.error("[AA] listener error:", evt, e); } });
  };

  // --- observe sessionStorage writes to our state key (no edits to core code needed) ---
  const STATE_KEY = "autoArranger_extractedParts";
  const CP_KEY = "autoArranger_checkpoints";
  const _setItem = sessionStorage.setItem.bind(sessionStorage);
  sessionStorage.setItem = function (k, v) {
    const prev = sessionStorage.getItem(k);
    _setItem(k, v);
    if (k !== STATE_KEY) return;
    try {
      const prevObj = prev ? JSON.parse(prev) : {};
      const nextObj = v ? JSON.parse(v) : {};
      // fire events when parts first appear and when instrumentSelections first appear
      if (!prevObj.parts && nextObj.parts) AA.emit("parts:extracted", nextObj);
      if (!prevObj.instrumentSelections && nextObj.instrumentSelections) AA.emit("instruments:saved", nextObj);
    } catch { /* no-op */ }
  };

  // --- checkpoints (save/restore JSON state only) ---
  AA.saveCheckpoint = function (name) {
    const raw = sessionStorage.getItem(STATE_KEY);
    if (!raw) return false;
    const all = JSON.parse(sessionStorage.getItem(CP_KEY) || "{}");
    all[name] = raw;
    _setItem(CP_KEY, JSON.stringify(all)); // use original to avoid re-triggering events
    if (AA.DEBUG) console.log("[AA] checkpoint saved:", name);
    return true;
  };
  AA.restoreCheckpoint = function (name) {
    const all = JSON.parse(sessionStorage.getItem(CP_KEY) || "{}");
    if (!all[name]) return false;
    sessionStorage.setItem(STATE_KEY, all[name]); // will re-run our patched setItem
    if (AA.DEBUG) console.log("[AA] checkpoint restored:", name);
    return true;
  };

  // --- automatically save "draft-1" once instruments are saved (the current working milestone) ---
  AA.on("instruments:saved", () => AA.saveCheckpoint("draft-1"));

  // --- safe wrapper for future modules ---
  AA.safe = function (moduleName, fn) {
    try { return fn(); }
    catch (err) {
      console.error(`[AA] Module "${moduleName}" failed:`, err);
      AA.restoreCheckpoint("draft-1");
      alert(`"${moduleName}" hit an error. Restored to Draft 1 state.`);
    }
  };

  // --- quick keyboard restore: Ctrl + Shift + D ---
  document.addEventListener("keydown", (e) => {
    const key = (e.key || "").toLowerCase();
    if (e.ctrlKey && e.shiftKey && key === "d") {
      AA.restoreCheckpoint("draft-1");
    }
  });


  


  
  // --- example pattern for future modules (keep appending below this line) ---

  

  
/* =====================================================================
   Auto Arranger — Draft 1 Guard / Module Layer (append-only, loop-safe)
   ===================================================================== */
(function () {
  const AA = (window.AA = window.AA || {});
  if (AA.__guardInstalled) return;
  AA.__guardInstalled = true;

  AA.VERSION = "draft-1";
  AA.DEBUG = false;

  // --- event bus ---
  const listeners = {};
  AA.on  = (evt, fn) => ((listeners[evt] ||= []).push(fn), () => AA.off(evt, fn));
  AA.off = (evt, fn) => { const a = listeners[evt]; if (!a) return; const i = a.indexOf(fn); if (i>-1) a.splice(i,1); };
  AA.emit = (evt, payload) => (listeners[evt]||[]).forEach(fn => { try{ fn(payload); }catch(e){ console.error("[AA] listener error:", evt, e); } });

  // --- suspension helper to prevent re-entrant emits while mutating state ---
  AA.__suspend = false;
  AA.suspendEvents = fn => { try { AA.__suspend = true; return fn(); } finally { AA.__suspend = false; } };

  // --- storage patch with TRANSITION-based emits (prev -> next) ---
  const STATE_KEY = "autoArranger_extractedParts";
  const CP_KEY = "autoArranger_checkpoints";
  const _setItem = sessionStorage.setItem.bind(sessionStorage);
  sessionStorage.setItem = function (k, v) {
    const prevRaw = sessionStorage.getItem(k);
    _setItem(k, v);
    if (k !== STATE_KEY || AA.__suspend) return;

    try {
      const prev = prevRaw ? JSON.parse(prevRaw) : {};
      const next = v ? JSON.parse(v) : {};

      const prevHasParts = !!prev?.parts;
      const nextHasParts = !!next?.parts;
      const prevHasInst  = Array.isArray(prev?.instrumentSelections);
      const nextHasInst  = Array.isArray(next?.instrumentSelections);

      if (!prevHasParts && nextHasParts) AA.emit("parts:extracted", next);
      if (!prevHasInst  && nextHasInst ) AA.emit("instruments:saved", next);
      // (Do NOT emit on subsequent writes that merely add results, to avoid loops)
    } catch (e) {
      console.error("[AA] Failed to parse state on setItem:", e);
    }
  };

  // --- checkpoints ---
  AA.saveCheckpoint = (name) => {
    const raw = sessionStorage.getItem(STATE_KEY); if (!raw) return false;
    const all = JSON.parse(sessionStorage.getItem(CP_KEY) || "{}");
    all[name] = raw; _setItem(CP_KEY, JSON.stringify(all));
    if (AA.DEBUG) console.log("[AA] checkpoint saved:", name);
    return true;
  };
  AA.restoreCheckpoint = (name) => {
    const all = JSON.parse(sessionStorage.getItem(CP_KEY) || "{}");
    if (!all[name]) return false;
    sessionStorage.setItem(STATE_KEY, all[name]);
    if (AA.DEBUG) console.log("[AA] checkpoint restored:", name);
    return true;
  };

  AA.on("instruments:saved", () => AA.saveCheckpoint("draft-1"));

  AA.safe = (moduleName, fn) => {
    try { return fn(); }
    catch (err) {
      console.error(`[AA] Module "${moduleName}" failed:`, err?.stack || err);
      AA.restoreCheckpoint("draft-1");
      alert(`"${moduleName}" hit an error. Restored to Draft 1 state.`);
    }
  };

  document.addEventListener("keydown", (e) => {
    const key = (e.key || "").toLowerCase();
    if (e.ctrlKey && e.shiftKey && key === "d") AA.restoreCheckpoint("draft-1");
  });
})();

/* =====================================================================
   Module: assignParts (append-only, loop-safe)
   ===================================================================== */
(function () {
  if (!window.AA) return;

  const NUM_LABEL = {
    1: "1 Melody",
    2: "2 Harmony",
    3: "3 Harmony II",
    4: "4 Counter Melody",
    5: "5 Counter Melody Harmony",
    6: "6 Bass"
  };

  const norm = s => String(s ?? "").replace(/\s+/g," ").trim();

  const NAME_TO_NUM = new Map([
    ["Melody",1],
    ["Harmony I",2],["Harmony 1",2],
    ["Harmony II",3],["Harmony 2",3],
    ["Counter Melody",4],
    ["Counter Melody Harmony",5],
    ["Bass",6],
    ["Groove",7],
    ["Chords",8],
    ["Drum Kit",9],["Drumkit",9],
    ["Melody & Bass",10],
    ["Melody & Chords",11],
    ["Chords & Bass",12],
    ["Melody & Chords & Bass",13],
    ["Timpani",14],
    ["Triangle",15],
  ]);

  const INITIAL_FOUR = [2,4,3,5];
  const CYCLE = [1,6,2,4,3,5];
  const STATE_KEY = "autoArranger_extractedParts";

  AA.on("instruments:saved", () => AA.safe("assignParts", runAssignParts));
  window.runAssignParts = runAssignParts;

  document.getElementById("backToSong")?.addEventListener("click", hidePanel);
  document.getElementById("backButton")?.addEventListener("click", hidePanel);

  function runAssignParts() {
    const raw = sessionStorage.getItem(STATE_KEY);
    if (!raw) return;

    let state;
    try { state = JSON.parse(raw); } catch (e) { console.error("[assignParts] bad JSON state", e); return; }

    const selections = Array.isArray(state.instrumentSelections) ? state.instrumentSelections : [];
    if (!selections.length) { hidePanel(); return; }

    const expanded = expandSelections(selections);

    const fixed = [];
    const numeric = [];
    for (const it of expanded) {
      const partNum = NAME_TO_NUM.get(norm(it.instrumentPart)) ?? 99;
      if (partNum >= 7) {
        fixed.push({ ...it, sortRaw: null, sortDisplay: "—", assignedPart: norm(it.instrumentPart) });
      } else if (partNum >= 1 && partNum <= 6) {
        const octave = toSignedInt(it.Octave);
        const sortRaw = partNum - octave; // subtract positive, add abs(negative)
        numeric.push({ ...it, sortRaw, sortDisplay: "", assignedPart: "" });
      } else {
        fixed.push({ ...it, sortRaw: null, sortDisplay: "—", assignedPart: norm(it.instrumentPart) || "(Unknown)" });
      }
    }

    numeric.sort((a,b) => (a.sortRaw - b.sortRaw) || a.name.localeCompare(b.name));
    applyTieBreakDecimals(numeric);

    const assignedNumeric = assignNumericParts(numeric);

    assignedNumeric.sort((a,b) => (a.sortRaw - b.sortRaw) || compareSortDisplay(a.sortDisplay,b.sortDisplay));
    fixed.sort((a,b) => a.name.localeCompare(b.name));

    const finalList = [...assignedNumeric, ...fixed];

    // persist WITHOUT re-emitting instruments:saved
    AA.suspendEvents(() => {
      state.assignedResults = finalList.map(({ name, instrumentPart, Octave, sortDisplay, assignedPart }) => ({
        name, instrumentPart, Octave, sortNumber: sortDisplay, assignedPart
      }));
      sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
    });

    renderAssignmentsPanel(finalList);
  }

  function expandSelections(selections) {
    const out = [];
    for (const s of selections) {
      const qty = Math.max(0, parseInt(s.quantity || 0, 10) || 0);
      const baseName = norm(s.name || "");
      for (let i = 1; i <= qty; i++) {
        out.push({
          name: qty > 1 ? `${baseName} ${i}` : baseName,
          instrumentPart: norm(s.instrumentPart),
          Octave: toSignedInt(s.Octave),
          clef: s.clef ?? null,
          transpose: s.transpose ?? null
        });
      }
    }
    out.sort((a,b)=> a.name.localeCompare(b.name));
    return out;
  }

  function toSignedInt(v) {
    if (typeof v === "number" && Number.isFinite(v)) return v|0;
    const s = String(v ?? "").replace(/\u2013|\u2014/g,"-").trim(); // normalize en/em dash
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : 0;
  }

  function applyTieBreakDecimals(arr) {
    let i = 0;
    while (i < arr.length) {
      const base = arr[i].sortRaw;
      let j = i;
      while (j < arr.length && arr[j].sortRaw === base) j++;
      const count = j - i;
      if (count === 1) {
        arr[i].sortDisplay = `${base.toFixed(1)}`.replace(/\.0+$/,".0");
      } else {
        for (let k=0; k<count; k++) arr[i+k].sortDisplay = `${base}.${k+1}`;
      }
      i = j;
    }
  }

  function assignNumericParts(listIn) {
    const list = listIn.map(x => ({...x}));
    if (!list.length) return list;

    const taken = new Set();

    // 1) lowest -> 1 Melody
    list[0].assignedPart = NUM_LABEL[1];
    taken.add(list[0].name);

    // 2) highest -> 6 Bass (if exists)
    if (list.length >= 2) {
      const hi = list.length - 1;
      if (!taken.has(list[hi].name)) {
        list[hi].assignedPart = NUM_LABEL[6];
        taken.add(list[hi].name);
      }
    }

    // 3) next four lowest -> 2,4,3,5
    const remaining = list.filter(x => !taken.has(x.name));
    for (let i=0; i<Math.min(4, remaining.length); i++) {
      const labels = [2,4,3,5];
      remaining[i].assignedPart = NUM_LABEL[labels[i]];
      taken.add(remaining[i].name);
    }

    // 4) rest -> cycle 1,6,2,4,3,5
    const rest = list.filter(x => !taken.has(x.name));
    const cycle = [1,6,2,4,3,5];
    for (let i=0; i<rest.length; i++) {
      rest[i].assignedPart = NUM_LABEL[cycle[i % cycle.length]];
    }

    return list;
  }

  function compareSortDisplay(a, b) {
    const na = parseFloat(a), nb = parseFloat(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return String(a).localeCompare(String(b));
  }

  function renderAssignmentsPanel(list) {
    const root = document.getElementById("aa-modules-root") || document.body;
    let panel = document.getElementById("aa-assignments-panel");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "aa-assignments-panel";
      panel.className = "card";
      panel.innerHTML = `
        <div class="card-header"><strong>Assigned Parts</strong></div>
        <div class="card-body">
          <div class="note">Ordered by sortNumber (lowest → highest). Fixed parts (7–15) show sortNumber as "—".</div>
          <div style="overflow:auto; margin-top:12px;">
            <table id="aa-assignments-table" style="width:100%; border-collapse:collapse;">
              <thead>
                <tr>
                  <th style="text-align:left; border-bottom:1px solid var(--line); padding:8px;">Instrument</th>
                  <th style="text-align:left; border-bottom:1px solid var(--line); padding:8px;">sortNumber</th>
                  <th style="text-align:left; border-bottom:1px solid var(--line); padding:8px;">assignedPart</th>
                </tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>
        </div>`;
      if (root.id === "aa-modules-root") {
        root.removeAttribute("hidden");
        root.setAttribute("aria-hidden","false");
        root.appendChild(panel);
      } else {
        document.body.appendChild(panel);
      }
    }

    const tbody = panel.querySelector("tbody");
    tbody.innerHTML = "";
    for (const row of list) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="padding:8px; border-bottom:1px solid var(--line);">${esc(row.name)}</td>
        <td style="padding:8px; border-bottom:1px solid var(--line); color:var(--muted);">${esc(row.sortDisplay || "—")}</td>
        <td style="padding:8px; border-bottom:1px solid var(--line);"><strong>${esc(row.assignedPart || "")}</strong></td>
      `;
      tbody.appendChild(tr);
    }
    panel.style.display = "block";
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function hidePanel(){ const p = document.getElementById("aa-assignments-panel"); if (p) p.style.display = "none"; }
  function esc(s){ return String(s ?? "").replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
})();

  
/* =====================================================================
   Module: arrangingLoadingScreen (append-only)
   - On instruments:saved → show a full-page "Arranging Custom Score…" view
   - Keep all computed data in sessionStorage; no table visualization
   ===================================================================== */
(function(){
  if (!window.AA) return;

  function showLoading() {
    // Create overlay if needed
    let ov = document.getElementById("aa-loading");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "aa-loading";
      ov.setAttribute("role","status");
      // full-viewport overlay with your banner behind a dark veil
      ov.style.position = "fixed";
      ov.style.inset = "0";
      ov.style.zIndex = "9999";
      ov.style.display = "flex";
      ov.style.alignItems = "center";
      ov.style.justifyContent = "center";
      ov.style.textAlign = "center";
      ov.style.background = "linear-gradient(180deg, rgba(11,13,18,.92), rgba(11,13,18,.96)), var(--banner) center/cover no-repeat";
      ov.innerHTML = `
        <div>
          <div style="font-weight:700;font-size:28px;letter-spacing:.3px;">Arranging Custom Score…</div>
          <!-- optional hint or spinner space -->
        </div>
      `;
      document.body.appendChild(ov);
    } else {
      ov.style.display = "flex";
    }

    // Hide earlier steps/panels
    document.getElementById("step1")?.classList.add("hidden");
    document.getElementById("step2")?.classList.add("hidden");
    document.getElementById("step3")?.classList.add("hidden");

    // Hide assignments panel if the assignParts module rendered it
    const ap = document.getElementById("aa-assignments-panel");
    if (ap) ap.style.display = "none";
  }

  // Show loading screen as soon as instruments are saved
  AA.on("instruments:saved", () => {
    showLoading();
    // If assignParts renders right after, hide its panel again on next tick
    setTimeout(() => {
      const ap = document.getElementById("aa-assignments-panel");
      if (ap) ap.style.display = "none";
    }, 0);
  });

  // Optional helper for future steps to dismiss the loading view
  window.hideArrangingLoading = function(){
    const ov = document.getElementById("aa-loading");
    if (ov) ov.style.display = "none";
  };
})();


  
  
  
  // AA.on("instruments:saved", (state) => {
  //   AA.safe("assignParts", () => {
  //     const s = JSON.parse(sessionStorage.getItem(STATE_KEY));
  //     // ...compute new fields here...
  //     sessionStorage.setItem(STATE_KEY, JSON.stringify(s));
  //   });
  // });

})();
