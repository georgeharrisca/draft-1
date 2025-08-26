// ===============================
// Auto Arranger — Draft 1 (core)
// ===============================
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

  // ---- Two-pane selection state (Step 3)
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

      const nextState = {
        timestamp: Date.now(),
        pack: packName,
        song: songName,
        parts: partsPayload.parts,        // [{ id, partName, xml }]
        scoreMeta: partsPayload.scoreMeta // { movementTitle, composer, workTitle }
      };
      sessionStorage.setItem("autoArranger_extractedParts", JSON.stringify(nextState));

      statusEl.textContent = "Parts data ready.";
      statusEl.classList.remove("err");
      statusEl.classList.add("ok");

      // Go to instruments
      renderInstrumentSelectors();
      step2.classList.add("hidden");
      step3.classList.remove("hidden");
      setStep(2);
    } catch (err) {
      console.error(err);
      statusEl.textContent = "Failed to extract parts.";
      statusEl.classList.remove("ok");
      statusEl.classList.add("err");
    }
  });

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

    // Hide assignments panel if any (older module)
    const p = document.getElementById("aa-assignments-panel");
    if (p) p.style.display = "none";
  });

// ====== Step 3: Instruments UI (two-pane) ======
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
        <div class="row" style="margin-top:12px;">
          <button id="removeFromScore" class="btn" type="button" disabled>Remove</button>
        </div>
      </div>
    </div>
  `;

  const instList = document.getElementById("instList");
  const selList  = document.getElementById("selList");
  const addBtn   = document.getElementById("addToScore");
  const removeBtn = document.getElementById("removeFromScore");

  // Populate left list (no backend data shown)
  instrumentData.forEach(inst => {
    const li = document.createElement("li");
    li.textContent = inst.name;
    li.setAttribute("tabindex", "0");
    li.dataset.name = inst.name;
    instList.appendChild(li);
  });

  let selectedLeftName = null;
  let selectedRightBase = null;

  function setActiveLeft(li) {
    instList.querySelectorAll("li").forEach(n => n.classList.remove("active"));
    if (li) {
      li.classList.add("active");
      selectedLeftName = li.dataset.name;
      addBtn.disabled = false;
    } else {
      selectedLeftName = null;
      addBtn.disabled = true;
    }
  }

  function setActiveRight(li) {
    selList.querySelectorAll("li").forEach(n => n.classList.remove("active"));
    if (li) {
      li.classList.add("active");
      selectedRightBase = parseBaseName(li.textContent);
      removeBtn.disabled = false;
    } else {
      selectedRightBase = null;
      removeBtn.disabled = true;
    }
  }

  // Left interactions
  instList.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    setActiveLeft(li);
  });
  instList.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      const li = e.target.closest("li");
      if (!li) return;
      e.preventDefault();
      setActiveLeft(li);
    }
  });

  // Right interactions (select row to remove)
  selList.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    setActiveRight(li);
  });
  selList.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      const li = e.target.closest("li");
      if (!li) return;
      e.preventDefault();
      setActiveRight(li);
    }
  });

  // Add to Score
  addBtn.addEventListener("click", () => {
    if (!selectedLeftName) return;
    if (!selectionCounts[selectedLeftName]) {
      selectionCounts[selectedLeftName] = 0;
      selectionOrder.push(selectedLeftName);
    }
    selectionCounts[selectedLeftName] += 1;
    renderSelections();
    // reset right selection after list changes
    setActiveRight(null);
  });

  // Remove selected row from right pane
  removeBtn.addEventListener("click", () => {
    if (!selectedRightBase) return;
    const base = selectedRightBase;
    if (selectionCounts[base] && selectionCounts[base] > 0) {
      selectionCounts[base] -= 1;
      if (selectionCounts[base] === 0) {
        delete selectionCounts[base];
        // remove from order list
        const idx = selectionOrder.indexOf(base);
        if (idx > -1) selectionOrder.splice(idx, 1);
      }
      renderSelections();
      setActiveRight(null);
    }
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
        li.setAttribute("tabindex", "0");
        selList.appendChild(li);
      }
    }
  }

  function parseBaseName(label) {
    // strips trailing " <number>" if present
    const m = String(label).match(/^(.*?)(?:\s+\d+)?$/);
    return m ? m[1] : String(label);
  }

  // initial empty state
  renderSelections();
}


  // Back Step 3 → Step 2
  backToSong.addEventListener("click", () => {
    step3.classList.add("hidden");
    step2.classList.remove("hidden");
    setStep(1);

    // Breadcrumb back to library > song
    stateTrail.instrumentsDone = false;
    renderTrail();

    // Hide assignments panel if visible (older module)
    const p = document.getElementById("aa-assignments-panel");
    if (p) p.style.display = "none";
  });

  // Save instrument selections (two-pane UI)
  saveInstruments.addEventListener("click", () => {
    // Build selections from selectionCounts
    const selections = [];
    for (const [name, qty] of Object.entries(selectionCounts)) {
      if (qty > 0) {
        const meta = instrumentData.find(i => i.name === name);
        if (meta) {
          selections.push({
            name: meta.name,
            quantity: qty,                 // counts from right pane
            instrumentPart: meta.instrumentPart,
            Octave: meta.Octave,
            clef: meta.clef ?? null,
            transpose: meta.transpose ?? null,
            scoreOrder: meta.scoreOrder, 
            assignedPart: ""               // placeholder
          });
        }
      }
    }

    const prevRaw = sessionStorage.getItem("autoArranger_extractedParts");
    const prevState = prevRaw ? JSON.parse(prevRaw) : {};
    const prevHadInst = Array.isArray(prevState.instrumentSelections);

    // Use a different identifier to avoid any duplicate 'state' declarations
    const nextState = { ...prevState, instrumentSelections: selections };
    sessionStorage.setItem("autoArranger_extractedParts", JSON.stringify(nextState));

    instStatus.textContent = selections.length
      ? `Saved ${selections.reduce((a,c)=>a+c.quantity,0)} instruments.`
      : "No instruments selected.";
    instStatus.classList.remove("err");
    instStatus.classList.add("ok");
    setStep(3);

    // Breadcrumb
    stateTrail.instrumentsDone = selections.length > 0;
    renderTrail();

    // If guard won’t auto-emit (because instrumentSelections already existed), emit manually
    if (prevHadInst && window.AA?.emit) {
      AA.emit("instruments:saved", nextState);
    }
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

  function escapeHtml(s){ return String(s ?? "").replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }
});







// ================================================================
// Guard / Checkpoint Layer (append-only, loop-safe)
// ================================================================






(function () {
  const AA = (window.AA = window.AA || {});
  if (AA.__guardInstalled) return;
  AA.__guardInstalled = true;

  AA.VERSION = "draft-1";
  AA.DEBUG = false;

  // event bus
  const listeners = {};
  AA.on  = (evt, fn) => ((listeners[evt] ||= []).push(fn), () => AA.off(evt, fn));
  AA.off = (evt, fn) => { const a = listeners[evt]; if (!a) return; const i = a.indexOf(fn); if (i>-1) a.splice(i,1); };
  AA.emit = (evt, payload) => (listeners[evt]||[]).forEach(fn => { try{ fn(payload); }catch(e){ console.error("[AA] listener error:", evt, e); } });

  // suspend emits while mutating state to avoid loops
  AA.__suspend = false;
  AA.suspendEvents = fn => { try { AA.__suspend = true; return fn(); } finally { AA.__suspend = false; } };

  // storage patch with transition-based emits (prev -> next)
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
    } catch (e) {
      console.error("[AA] Failed to parse state on setItem:", e);
    }
  };

  // checkpoints
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

// ================================================================
// Module: assignParts (append-only, no table render)
// ================================================================
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

  function runAssignParts() {
    const raw = sessionStorage.getItem(STATE_KEY);
    if (!raw) return;

    let state;
    try { state = JSON.parse(raw); } catch (e) { console.error("[assignParts] bad JSON state", e); return; }

    const selections = Array.isArray(state.instrumentSelections) ? state.instrumentSelections : [];
    if (!selections.length) return;

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

    // No table render here (next steps will use sessionStorage data)
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
})();

// ================================================================
// Module: arrangingLoadingScreen (append-only)
// ================================================================
(function(){
  if (!window.AA) return;

  function showLoading() {
    let ov = document.getElementById("aa-loading");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "aa-loading";
      ov.setAttribute("role","status");
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

    // Hide older assignments panel if present
    const ap = document.getElementById("aa-assignments-panel");
    if (ap) ap.style.display = "none";
  }

  // Show loading screen as soon as instruments are saved
  AA.on("instruments:saved", () => {
    showLoading();
  });

  // Optional helper for future steps
  window.hideArrangingLoading = function(){
    const ov = document.getElementById("aa-loading");
    if (ov) ov.style.display = "none";
  };
})();
/* =====================================================================
   Module: groupAssignmentsToParts (append-only)
   - Requires: state.parts (extracted from song), state.assignedResults (from assignParts)
   - Produces: state.groupedAssignments = [
       { partName, partId, instruments: [
           { name, assignedPart, instrumentPart, sortNumber, Octave }
         ] }
     ]
   - No UI; data is stored for the next processing step.
   ===================================================================== */
(function(){
  if (!window.AA) return;
  const STATE_KEY = "autoArranger_extractedParts";
  const norm = s => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

  // Run right after instruments are saved. This listener is registered
  // AFTER the assignParts module, so it fires after assignments are computed.
  AA.on("instruments:saved", () => AA.safe("groupAssignmentsToParts", groupNow));

  function groupNow() {
    const raw = sessionStorage.getItem(STATE_KEY);
    if (!raw) return;

    let state;
    try { state = JSON.parse(raw); } catch (e) { console.error("[groupAssignmentsToParts] bad JSON state", e); return; }

    const parts = Array.isArray(state.parts) ? state.parts : [];
    const assigned = Array.isArray(state.assignedResults) ? state.assignedResults : [];

    if (!parts.length || !assigned.length) {
      // Either the song didn't extract or assignments aren't ready; nothing to do.
      return;
    }

    // Build initial groups directly from the score's parts (preserves score order)
    const groups = parts.map(p => ({
      partName: p.partName,
      partId: p.id,
      instruments: []
    }));

    // Fast lookup for groups by normalized part name
    const groupMap = new Map(groups.map(g => [norm(g.partName), g]));

    // Attach instruments to their matching score parts
    for (const instr of assigned) {
      const key = norm(instr.assignedPart || "");
      const grp = groupMap.get(key);

      const entry = {
        name: instr.name,
        assignedPart: instr.assignedPart,
        instrumentPart: instr.instrumentPart,
        sortNumber: instr.sortNumber ?? null,
        Octave: instr.Octave ?? null
      };

      if (grp) {
        grp.instruments.push(entry);
      } else {
        // Fallback: if a matching score part wasn't found (shouldn't happen),
        // create a catch-all group so nothing is lost.
        let fallback = groupMap.get("__missing__:" + key);
        if (!fallback) {
          fallback = { partName: instr.assignedPart || "(Unknown)", partId: null, instruments: [] };
          groupMap.set("__missing__:" + key, fallback);
          groups.push(fallback);
        }
        fallback.instruments.push(entry);
      }
    }

    // Persist without re-triggering lifecycle events
    AA.suspendEvents(() => {
      state.groupedAssignments = groups;
      sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
    });

    if (AA.DEBUG) console.log("[AA] groupedAssignments:", groups);
  }
})();
/* =====================================================================
   Module: arrangeGroupedParts (append-only, backend-only) — Octave edits DISABLED
   - Input  (sessionStorage):
       state.parts[]              -> extracted single-part MusicXML docs
       state.instrumentSelections -> [{ name, quantity, clef, transpose, Octave, scoreOrder, ... }]
       state.assignedResults[]    -> [{ name, assignedPart, sortNumber, Octave, ... }]
       state.groupedAssignments[] -> [{ partName, partId, instruments:[{ name, ...}] }]
   - Output (sessionStorage):
       state.arrangedFiles[] -> [{
         instrumentName, baseName, assignedPart,
         sourcePartId, sourcePartName,
         xml   // serialized MusicXML string for this instrument
       }]
       state.arrangeDone = true
   - NOTE: Octave is NOT applied to the XML here (only used earlier for categorizing).
   ===================================================================== */
(function () {
  if (!window.AA) return;
  const STATE_KEY = "autoArranger_extractedParts";

  const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g," ").trim();
  const baseNameOf = (label) => String(label || "").replace(/\s+\d+$/, ""); // "Violin 2" -> "Violin"

  // Start when instruments are saved (assignParts + grouping are already wired)
  AA.on("instruments:saved", () => AA.safe("arrangeGroupedParts", run));

  async function run() {
    const raw = sessionStorage.getItem(STATE_KEY);
    if (!raw) return;

    let state;
    try { state = JSON.parse(raw); } catch (e) { console.error("[arrangeGroupedParts] bad JSON", e); return; }

    const parts = Array.isArray(state.parts) ? state.parts : [];
    const groups = Array.isArray(state.groupedAssignments) ? state.groupedAssignments : [];
    const selections = Array.isArray(state.instrumentSelections) ? state.instrumentSelections : [];

    if (!parts.length || !groups.length) {
      return;
    }

    // Index score parts by normalized name
    const partByName = new Map(parts.map(p => [norm(p.partName), p]));

    // Quick lookup for instrument meta (clef/transpose/octave) by base name
    const metaByBase = new Map(selections.map(s => [s.name, {
      clef: s.clef ?? null,
      transpose: s.transpose ?? null,
      // Octave kept here but NOT applied to XML in this version
      Octave: toInt(s.Octave)
    }]));

    const arranged = [];

    for (const grp of groups) {
      const src = partByName.get(norm(grp.partName));
      if (!src) continue;

      for (const inst of (grp.instruments || [])) {
        const base = baseNameOf(inst.name);
        const meta = metaByBase.get(base) || { clef: null, transpose: null, Octave: 0 };

        try {
          const xml = arrangeXmlForInstrument(src.xml, inst.name, meta);
          arranged.push({
            instrumentName: inst.name,
            baseName: base,
            assignedPart: inst.assignedPart,
            sourcePartId: src.id,
            sourcePartName: src.partName,
            xml
          });
        } catch (e) {
          console.error(`[arrangeGroupedParts] transform failed for ${inst.name}`, e);
        }
      }
    }

    AA.suspendEvents(() => {
      state.arrangedFiles = arranged;
      state.arrangeDone = true;
      sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
    });
  }

  // ---- helpers ----
  function toInt(v) {
    if (typeof v === "number" && Number.isFinite(v)) return v|0;
    const s = String(v ?? "").replace(/\u2013|\u2014/g,"-").trim();
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : 0;
  }

  // Core transform — Octave shift intentionally DISABLED
  function arrangeXmlForInstrument(singlePartXml, instrumentLabel, meta) {
    const { clef, transpose /*, Octave: octaveShift */ } = meta;

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(singlePartXml, "application/xml");

    // (1) Octave shift — DISABLED on purpose
    // if (octaveShift && Number.isFinite(octaveShift)) { ... }

    // (2) Part-name → instrument instance label
    const partName = xmlDoc.querySelector("score-part part-name");
    if (partName) partName.textContent = instrumentLabel;

    // (3) Clef replacement (if provided)
    if (clef) {
      const clefNode = xmlDoc.querySelector("clef");
      if (clefNode) {
        while (clefNode.firstChild) clefNode.removeChild(clefNode.firstChild);
        const tpl = clef === "bass"
          ? `<sign>F</sign><line>4</line>`
          : (clef === "alto"
              ? `<sign>C</sign><line>3</line>`
              : `<sign>G</sign><line>2</line>`); // treble default
        const frag = parser.parseFromString(`<x>${tpl}</x>`, "application/xml");
        const x = frag.querySelector("x");
        while (x.firstChild) clefNode.appendChild(x.firstChild);
      }
    }

    // (4) Transpose in <score-part> and first <attributes> (after <key>)
    if (transpose && typeof transpose === "string") {
      // <score-part>
      const scorePart = xmlDoc.querySelector("score-part");
      if (scorePart) {
        const existing = scorePart.querySelector("transpose");
        if (existing) existing.remove();
        const tnode = parser.parseFromString(`<wrap>${transpose}</wrap>`, "application/xml").querySelector("transpose");
        if (tnode) scorePart.appendChild(tnode);
      }
      // <attributes>
      const attributes = xmlDoc.querySelector("attributes");
      if (attributes) {
        const existing = attributes.querySelector("transpose");
        if (existing) existing.remove();
        const tnode = parser.parseFromString(`<wrap>${transpose}</wrap>`, "application/xml").querySelector("transpose");
        if (tnode) {
          const key = attributes.querySelector("key");
          if (key && key.nextSibling) attributes.insertBefore(tnode, key.nextSibling);
          else attributes.appendChild(tnode);
        }
      }
    }

    // (5) Cleanups (lyrics & chord symbols)
    xmlDoc.querySelectorAll("lyric").forEach(n => n.remove());
    xmlDoc.querySelectorAll("harmony").forEach(n => n.remove());

    return new XMLSerializer().serializeToString(xmlDoc);
  }
})();


/* =====================================================================
   Module: renamePartsToInstrumentNames (extended: abbreviations too)
   - Input (sessionStorage):
       state.arrangedFiles[]         -> [{ instrumentName, baseName, xml, ... }]
       state.instrumentSelections[]  -> [{ name, partAbbreviation? , ... }]  // optional, future
   - Behavior:
       For each arranged file:
         • <score-part><part-name>                = instrumentName
         • <score-part><score-instrument><instrument-name> (if present) = instrumentName
         • <score-part><part-name-display>        (if present) = instrumentName (simple text fallback)
         • <score-part><part-abbreviation>        = partAbbrev (from selections) OR "abbrev."
         • <score-part><part-abbreviation-display> (if present) = same
         • If <part-abbreviation> is missing, create it right after <part-name>
   - Output:
       state.arrangedFiles[] (xml updated)
       state.renameDone = true
   ===================================================================== */
(function () {
  if (!window.AA) return;
  const STATE_KEY = "autoArranger_extractedParts";

  AA.on("instruments:saved", () => AA.safe("renamePartsToInstrumentNames", run));

  function run() {
    const raw = sessionStorage.getItem(STATE_KEY);
    if (!raw) return;

    let state;
    try { state = JSON.parse(raw); } catch (e) { console.error("[renamePartsToInstrumentNames] bad JSON", e); return; }

    const files = Array.isArray(state.arrangedFiles) ? state.arrangedFiles : [];
    if (!files.length) return;

    // Optional: pull per-instrument abbreviations if you add them later to instrumentSelections
    const abbrevByBase = new Map();
    if (Array.isArray(state.instrumentSelections)) {
      for (const s of state.instrumentSelections) {
        if (s && s.name) {
          const base = String(s.name);
          if (s.partAbbreviation && typeof s.partAbbreviation === "string") {
            abbrevByBase.set(base, s.partAbbreviation);
          }
        }
      }
    }

    const parser = new DOMParser();
    const serializer = new XMLSerializer();

    for (const f of files) {
      const instLabel = String(f.instrumentName || "").trim();
      if (!instLabel || !f.xml) continue;

      // choose abbreviation: future meta -> fallback "abbrev."
      const base = f.baseName ? String(f.baseName) : instLabel.replace(/\s+\d+$/, "");
      const partAbbrev = abbrevByBase.get(base) || "abbrev.";

      try {
        const doc = parser.parseFromString(f.xml, "application/xml");

        // (A) <score-part> is the anchor
        const scorePart = doc.querySelector("score-part");
        if (!scorePart) {
          // If somehow absent, just serialize back unchanged
          f.xml = serializer.serializeToString(doc);
          continue;
        }

        // 1) Part name
        const partNameNode = scorePart.querySelector(":scope > part-name");
        if (partNameNode) partNameNode.textContent = instLabel;

        // 1a) Display name (optional)
        const nameDisplay = scorePart.querySelector(":scope > part-name-display");
        if (nameDisplay) nameDisplay.textContent = instLabel;

        // 1b) score-instrument/instrument-name (optional but common)
        const instrNameNode = scorePart.querySelector(":scope > score-instrument > instrument-name");
        if (instrNameNode) instrNameNode.textContent = instLabel;

        // 2) Abbreviation(s)
        let abbrevNode = scorePart.querySelector(":scope > part-abbreviation");
        if (!abbrevNode) {
          // create and insert after <part-name> if we can find it
          abbrevNode = doc.createElement("part-abbreviation");
          if (partNameNode && partNameNode.nextSibling) {
            scorePart.insertBefore(abbrevNode, partNameNode.nextSibling);
          } else {
            scorePart.appendChild(abbrevNode);
          }
        }
        abbrevNode.textContent = partAbbrev;

        const abbrevDisplay = scorePart.querySelector(":scope > part-abbreviation-display");
        if (abbrevDisplay) abbrevDisplay.textContent = partAbbrev;

        // Done → serialize
        f.xml = serializer.serializeToString(doc);
      } catch (e) {
        console.error(`[renamePartsToInstrumentNames] failed for ${f.instrumentName}`, e);
      }
    }

    // Persist without re-triggering lifecycle emits
    AA.suspendEvents(() => {
      state.arrangedFiles = files;
      state.renameDone = true;
      sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
    });

    if (AA.DEBUG) console.log("[AA] renameDone:", true);
  }
})();


/* =====================================================================
   Module: reassignPartIdsByScoreOrder (append-only, backend-only)
   - Orders arranged single-part XMLs by scoreOrder (with decimals for duplicates)
   - Assigns P1..Pn in that order by replacing all occurrences of old id
   ===================================================================== */
(function(){
  if (!window.AA) return;
  const STATE_KEY = "autoArranger_extractedParts";

  // Fallback base order (used if instrumentSelections lacks scoreOrder)
  const FALLBACK_ORDER = {
    "Piccolo": 1,
    "Flute": 2,
    "Oboe": 3,
    "Bb Clarinet": 4,
    "Bassoon": 5,
    "Violin": 6,
    "Viola": 7,
    "Cello": 8,
    "Double Bass": 9
  };

  // Run after the pipeline kicks off (arrange/rename modules also listen here)
  AA.on("instruments:saved", () => AA.safe("reassignPartIdsByScoreOrder", run));

  function run() {
    const raw = sessionStorage.getItem(STATE_KEY);
    if (!raw) return;

    let state;
    try { state = JSON.parse(raw); } catch (e) { console.error("[reassignPartIdsByScoreOrder] bad JSON", e); return; }

    const arranged = Array.isArray(state.arrangedFiles) ? state.arrangedFiles : [];
    if (!arranged.length) return;

    // Build base score order map from selections (preferred)
    const baseOrder = new Map();
    if (Array.isArray(state.instrumentSelections)) {
      for (const s of state.instrumentSelections) {
        if (s?.name) {
          const v = Number(s.scoreOrder);
          if (Number.isFinite(v)) baseOrder.set(String(s.name), v);
        }
      }
    }
    // Fill any gaps from fallback
    for (const [k,v] of Object.entries(FALLBACK_ORDER)) {
      if (!baseOrder.has(k)) baseOrder.set(k, v);
    }

    // Compute effective scoreOrder for each arranged file:
    // baseScore + (instance # / 10), e.g., Violin 2 => 6 + 0.2 = 6.2
    const rows = arranged.map((f, idx) => {
      const base = (f.baseName || String(f.instrumentName).replace(/\s+\d+$/, "")).trim();
      const baseVal = baseOrder.get(base);
      const m = String(f.instrumentName).match(/\s+(\d+)$/);   // trailing number
      const instIdx = m ? parseInt(m[1], 10) : 0;
      const eff = (Number.isFinite(baseVal) ? baseVal : Number.POSITIVE_INFINITY) + (instIdx > 0 ? instIdx/10 : 0);
      return { idx, f, effOrder: eff, name: f.instrumentName };
    });

    rows.sort((a,b) => (a.effOrder - b.effOrder) || String(a.name).localeCompare(String(b.name)));

    const partIdMap = [];
    for (let i = 0; i < rows.length; i++) {
      const file = rows[i].f;
      const newId = `P${i+1}`;
      const m = String(file.xml).match(/<score-part\s+id="([^"]+)"/i);
      if (!m) {
        console.warn("[reassignPartIdsByScoreOrder] Missing <score-part id> for", file.instrumentName);
        continue;
      }
      const oldId = m[1];

      // Replace ALL occurrences of oldId (covers <score-part id>, <part id>, and any references)
      file.xml = file.xml.split(oldId).join(newId);
      file.newPartId = newId;

      partIdMap.push({
        instrumentName: file.instrumentName,
        baseName: file.baseName,
        scoreOrder: rows[i].effOrder,
        newPartId: newId
      });
    }

    AA.suspendEvents(() => {
      state.arrangedFiles = arranged;
      state.partIdMap = partIdMap;
      state.reassignByScoreDone = true;
      sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
    });

    if (AA.DEBUG) console.log("[AA] reassignByScoreDone:", true, partIdMap);
  }
})();

/* =====================================================================
   Module: combineArrangedParts (append-only, backend-only)
   - Input (sessionStorage):
       state.arrangedFiles[] -> [{ xml, newPartId?, instrumentName, ... }]
         (IDs already reassigned to P1..Pn by scoreOrder module)
   - Behavior:
       * Sort parts by P-number (extract from newPartId or from XML).
       * Use first part as base document; splice in additional
         <score-part> nodes (inside <part-list>) and <part> nodes.
   - Output:
       state.combinedScoreXml : string (the full multi-part score)
       state.combineDone      : true
     (Per-part files remain intact in state.arrangedFiles for future steps.)
   ===================================================================== */
(function(){
  if (!window.AA) return;
  const STATE_KEY = "autoArranger_extractedParts";

  AA.on("instruments:saved", () => AA.safe("combineArrangedParts", run));

  function run() {
    const raw = sessionStorage.getItem(STATE_KEY);
    if (!raw) return;

    let state;
    try { state = JSON.parse(raw); } catch (e) { console.error("[combineArrangedParts] bad JSON", e); return; }

    const files = Array.isArray(state.arrangedFiles) ? state.arrangedFiles : [];
    if (!files.length) return;

    // Build sortable list: ensure we have a P-number for each file
    const rows = [];
    for (const f of files) {
      const pid = getPartId(f);
      if (!pid) {
        console.warn("[combineArrangedParts] skipping file without <score-part id>", f.instrumentName);
        continue;
      }
      const num = parseInt(String(pid).replace(/^P/i, ""), 10);
      rows.push({ f, partId: pid, partNum: Number.isFinite(num) ? num : Number.POSITIVE_INFINITY });
    }

    if (!rows.length) return;

    // Sort by part number ascending: P1, P2, ...
    rows.sort((a,b) => (a.partNum - b.partNum) || (String(a.partId).localeCompare(String(b.partId))));

    // Start with the first XML as the base document
    let combined = rows[0].f.xml;
    if (!combined) return;

    // Ensure base ends without the closing root so we can append safely
    combined = combined.replace(/<\/score-partwise>\s*$/i, "");

    // Append remaining parts (both score-part + part)
    for (let i = 1; i < rows.length; i++) {
      const { f, partId } = rows[i];
      const text = f.xml || "";
      const scorePartBlock = extractScorePartBlock(text, partId);
      if (scorePartBlock) {
        const insertAt = combined.lastIndexOf("</score-part>");
        if (insertAt !== -1) {
          combined = combined.slice(0, insertAt + "</score-part>".length) + "\n" + scorePartBlock + combined.slice(insertAt + "</score-part>".length);
        } else {
          // Fallback: inject just before </part-list>
          const plEnd = combined.lastIndexOf("</part-list>");
          if (plEnd !== -1) {
            combined = combined.slice(0, plEnd) + "\n" + scorePartBlock + combined.slice(plEnd);
          } else {
            console.warn("[combineArrangedParts] could not locate part-list insertion point.");
          }
        }
      }

      const partBlock = extractPartBlock(text, partId);
      if (partBlock) {
        const insertAt = combined.lastIndexOf("</part>");
        if (insertAt !== -1) {
          combined = combined.slice(0, insertAt + "</part>".length) + "\n" + partBlock + combined.slice(insertAt + "</part>".length);
        } else {
          // Fallback: inject before </score-partwise>
          const rootEnd = combined.lastIndexOf("</score-partwise>");
          if (rootEnd !== -1) {
            combined = combined.slice(0, rootEnd) + "\n" + partBlock + combined.slice(rootEnd);
          } else {
            console.warn("[combineArrangedParts] could not locate score root insertion point.");
          }
        }
      }
    }

    // Close the root
    if (!/<\/score-partwise>\s*$/i.test(combined)) {
      combined += "\n</score-partwise>";
    }

    // Persist final combined score; keep per-part files intact
    AA.suspendEvents(() => {
      state.combinedScoreXml = combined;
      state.combineDone = true;
      sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
    });

    if (AA.DEBUG) console.log("[AA] combineDone:", true);
  }

  // ---- helpers ----
  function getPartId(file) {
    if (file.newPartId) return file.newPartId;
    // fallback: extract from XML
    const m = String(file.xml || "").match(/<score-part\s+id="([^"]+)"/i);
    return m ? m[1] : null;
  }

  function extractScorePartBlock(xml, partId) {
    // <score-part id="P#"> ... </score-part>
    const re = new RegExp(`<score-part\\s+id="${escapeReg(partId)}">[\\s\\S]*?<\\/score-part>`, "i");
    const m = String(xml).match(re);
    return m ? m[0] : null;
  }

  function extractPartBlock(xml, partId) {
    // <part id="P#"> ... </part>
    const re = new RegExp(`<part\\s+id="${escapeReg(partId)}">[\\s\\S]*?<\\/part>`, "i");
    const m = String(xml).match(re);
    return m ? m[0] : null;
  }

  function escapeReg(s){ return String(s).replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&"); }
})();



/* =====================================================================
   Module: finalViewer (append-only)
   - Centered UI; Back clears processing & returns to instrument selection
   - Dropdown sorted by P-order; Score pinned on top
   - Shrink-to-fit vertically for OSMD rendering (no vertical scroll)
   ===================================================================== */
(function () {
  if (!window.AA) return;
  const STATE_KEY = "autoArranger_extractedParts";

  AA.on("instruments:saved", () => AA.safe("finalViewer", bootWhenReady));

  async function bootWhenReady() {
    const ok = await waitForState(s => s.arrangeDone && s.renameDone && s.reassignByScoreDone && s.combineDone);
    if (!ok) return;

    // Guard: if a viewer already exists, don't create another
    if (document.getElementById('aa-viewer')) return;

    // libs in repo root
    await ensureLib("opensheetmusicdisplay", "./opensheetmusicdisplay.min.js");
    await ensureLib("html2canvas", "./html2canvas.min.js");
    await ensureLib("jspdf", "./jspdf.umd.min.js");

    buildViewerUI();
  }

  function getState() {
    try { return JSON.parse(sessionStorage.getItem(STATE_KEY) || "{}"); }
    catch { return {}; }
  }
  function setState(next) { AA.suspendEvents(() => sessionStorage.setItem(STATE_KEY, JSON.stringify(next))); }

  function waitForState(predicate, timeoutMs = 120000) {
    return new Promise(resolve => {
      const start = Date.now();
      const iv = setInterval(() => {
        const s = getState();
        if (predicate(s)) { clearInterval(iv); resolve(true); }
        else if (Date.now() - start > timeoutMs) { clearInterval(iv); resolve(false); }
      }, 150);
    });
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

  // ---------- UI ----------
  function buildViewerUI() {
    // de-dupe: ensure only one overlay exists
    document.querySelectorAll('#aa-viewer').forEach(n => n.remove());

    const state = getState();
    const songName = state?.selectedSong?.name || state?.song || "Auto Arranger Result";
    const partsRaw = Array.isArray(state.arrangedFiles) ? state.arrangedFiles : [];
    const hasScore = typeof state.combinedScoreXml === "string" && state.combinedScoreXml.length > 0;

    // Sort parts by P-number (P1, P2, …)
    const parts = sortPartsByPid(partsRaw);

    // Fullscreen overlay (no vertical scroll)
    const wrap = document.createElement("div");
    wrap.id = "aa-viewer";
    wrap.style.cssText = `
      position: fixed; inset: 0; z-index: 99999;
      display: flex; flex-direction: column;
      height: 100vh;
      background: rgba(0,0,0,0.08);
      padding: 28px;
      box-sizing: border-box;
      overflow-y: hidden;
      overflow-x: hidden;
    `;

    // Back button — clears processing and returns to instrument selection
    const backBtn = document.createElement("button");
    backBtn.textContent = "← Back";
    backBtn.title = "Back to instrument selection";
    backBtn.style.cssText = `
      position: absolute; top: 16px; left: 16px;
      padding: 8px 12px; border-radius: 8px; border: none;
      background: #e5e7eb; color: #111; font: 600 13px system-ui; cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,.06);
    `;
    backBtn.addEventListener("click", () => backToInstrumentSelection(state));
    wrap.appendChild(backBtn);

    // Card
    const card = document.createElement("div");
    card.style.cssText = `
      margin: auto; width: min(1200px, 100%);
      height: calc(100vh - 56px);
      background: #ffffff; border-radius: 14px;
      box-shadow: 0 12px 36px rgba(0,0,0,0.18);
      padding: 20px 20px 18px;
      box-sizing: border-box;
      display: flex; flex-direction: column; gap: 10px;
      overflow: hidden;
    `;
    wrap.appendChild(card);

    // Title (top-center, black)
    const title = document.createElement("h2");
    title.textContent = songName;
    title.style.cssText = `
      margin: 0; text-align: center; color: #000;
      font: 700 20px/1.2 system-ui, Arial, sans-serif;
    `;
    card.appendChild(title);

    // Controls container centered
    const controls = document.createElement("div");
    controls.style.cssText = `display:flex; flex-direction:column; align-items:center; gap:8px; margin-top:2px;`;
    card.appendChild(controls);

    // Label (centered, black)
    const label = document.createElement("div");
    label.textContent = "Select Score or Part";
    label.style.cssText = `color:#000; font:600 13px/1 system-ui;`;
    controls.appendChild(label);

    // Dropdown centered (Score first, then P-order)
    const select = document.createElement("select");
    select.id = "aa-viewer-select";
    select.style.cssText = `padding:8px 10px; font:14px system-ui;`;
    if (hasScore) {
      const opt = document.createElement("option");
      opt.value = "__SCORE__";
      opt.textContent = "Score";
      select.appendChild(opt);
    }
    for (const p of parts) {
      const opt = document.createElement("option");
      opt.value = p.instrumentName;
      opt.textContent = p.instrumentName;
      select.appendChild(opt);
    }
    controls.appendChild(select);

    // Buttons row (centered)
    const btnRow = document.createElement("div");
    btnRow.style.cssText = `display:flex; gap:8px; flex-wrap:nowrap; justify-content:center; align-items:center;`;
    btnRow.innerHTML = `
      <button id="aa-btn-visualize" class="aa-btn">Visualize</button>
      <button id="aa-btn-pdf" class="aa-btn" disabled>Download PDF</button>
      <button id="aa-btn-xml" class="aa-btn" disabled>Download XML</button>
      <button id="aa-btn-pdf-all" class="aa-btn">Download PDF All Parts</button>
      <button id="aa-btn-xml-all" class="aa-btn">Download XML ALL Parts</button>
    `;
    controls.appendChild(btnRow);

    // Button styles
    const styleBtn = document.createElement("style");
    styleBtn.textContent = `
      .aa-btn { padding:8px 12px; border-radius:8px; background:#0f62fe; color:white; border:none; cursor:pointer; font:600 13px system-ui; }
      .aa-btn[disabled] { opacity:0.5; cursor:not-allowed; }
      .aa-btn:hover:not([disabled]) { filter:brightness(0.92); }
    `;
    card.appendChild(styleBtn);

    // OSMD host (fills remaining height; horizontal scroll allowed)
    const osmdBox = document.createElement("div");
    osmdBox.id = "aa-osmd-box";
    osmdBox.style.cssText = `
      margin-top:8px; border:1px solid #e5e5e5; border-radius:10px;
      background:#ffffff; padding:14px;
      flex: 1 1 auto; min-height: 0;
      overflow-y: hidden; overflow-x: auto;
      white-space: nowrap;
    `;
    card.appendChild(osmdBox);

    document.body.appendChild(wrap);

    // OSMD init
    const OSMD = lookupGlobal("opensheetmusicdisplay");
    const osmd = new OSMD.OpenSheetMusicDisplay(osmdBox, {
      autoResize: true, backend: "svg", drawingParameters: "default"
    });

    // Re-fit on window resize
    window.addEventListener("resize", () => fitScoreToHeight(osmd, osmdBox));

    // Controls references
    const btnVis = btnRow.querySelector("#aa-btn-visualize");
    const btnPDF = btnRow.querySelector("#aa-btn-pdf");
    const btnXML = btnRow.querySelector("#aa-btn-xml");
    const btnPDFAll = btnRow.querySelector("#aa-btn-pdf-all");
    const btnXMLAll = btnRow.querySelector("#aa-btn-xml-all");

    let lastXml = "";

    // Visualize with shrink-to-fit vertically
    btnVis.addEventListener("click", async () => {
      const choice = select.value;
      const { xml } = pickXml(choice);
      if (!xml) { alert("No XML found to visualize."); return; }

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
        osmdBox.style.background = "#ffffff";
      } catch (e) {
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
          if (!doc) {
            doc = new (jspdfNS.jsPDF)({
              orientation: w >= h ? "landscape" : "portrait",
              unit: "pt",
              format: [w, h]
            });
          } else {
            doc.addPage([w, h], w >= h ? "landscape" : "portrait");
          }
          doc.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, w, h);
        } catch (e) {
          console.error("[finalViewer] PDF all parts failed on", p.instrumentName, e);
        }
      }
      if (doc) doc.save(docName);
    });

    btnXMLAll.addEventListener("click", async () => {
      if (!parts.length) return alert("No parts found.");
      for (const p of parts) {
        downloadText(p.xml, `${safe(p.instrumentName)}.musicxml`, "application/xml");
        await new Promise(r => setTimeout(r, 60));
      }
    });

    function pickXml(choice) {
      const s = getState();
      if (choice === "__SCORE__") return { xml: s.combinedScoreXml || "" };
      const hit = (Array.isArray(s.arrangedFiles) ? s.arrangedFiles : []).find(f => f.instrumentName === choice);
      return { xml: hit?.xml || "" };
    }
  }

  // ---- helpers ----
  function sortPartsByPid(files) {
    const out = [];
    for (const f of files) {
      const pid = f.newPartId || extractPidFromXml(f.xml);
      if (!pid) continue;
      const n = parseInt(String(pid).replace(/^P/i, ""), 10);
      out.push({ ...f, _pid: pid, _pnum: Number.isFinite(n) ? n : Number.POSITIVE_INFINITY });
    }
    out.sort((a,b) => (a._pnum - b._pnum) || String(a.instrumentName).localeCompare(String(b.instrumentName)));
    return out;
  }
  function extractPidFromXml(xml) {
    const m = String(xml || "").match(/<score-part\s+id="([^"]+)"/i);
    return m ? m[1] : null;
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }
  function safe(s){ return String(s||"").replace(/[\/\\:?*"<>|]+/g,"-"); }

  async function exportCurrentViewToPdf(container, baseName) {
    if (typeof html2canvas === "undefined") { alert("html2canvas is not loaded."); return; }
    const { canvas, w, h } = await snapshotCanvas(container);
    const jspdfNS = window.jspdf || window.jspdf?.jsPDF ? window.jspdf : window;
    const jsPDF = jspdfNS.jsPDF || jspdfNS.JSPDF || jspdfNS.jsPDFConstructor;
    if (!jsPDF) { alert("jsPDF is not loaded."); return; }
    const pdf = new (jspdfNS.jsPDF)({
      orientation: w >= h ? "landscape" : "portrait",
      unit: "pt",
      format: [w, h]
    });
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, w, h);
    pdf.save(`${safe(baseName)}.pdf`);
  }

  function snapshotCanvas(container) {
    return html2canvas(container, { scale: 2, backgroundColor: "#ffffff" })
      .then(canvas => ({ canvas, w: canvas.width, h: canvas.height }));
  }

  function downloadText(str, filename, mime) {
    const blob = new Blob([str], { type: mime || "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename || "file.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2500);
  }

  // Back button behavior: clear processing + navigate back to Step 3 with same Library/Song selected
  async function backToInstrumentSelection(prevState) {
    try {
      const packName = prevState?.pack || prevState?.selectedPack?.name || "";
      const songName = prevState?.song || prevState?.selectedSong?.name || "";

      // Clear processing, keep only minimal context (pack & song optional)
      setState({ pack: packName, song: songName, timestamp: Date.now() });

      // remove any and all viewer overlays that might exist
      document.querySelectorAll('#aa-viewer').forEach(n => n.remove());

      // Hide loading overlay if any
      if (typeof window.hideArrangingLoading === "function") window.hideArrangingLoading();

      // Show step 1 initially (to reuse existing UI flow)
      const step1 = document.getElementById("step1");
      const step2 = document.getElementById("step2");
      const step3 = document.getElementById("step3");
      step1?.classList.remove("hidden");
      step2?.classList.add("hidden");
      step3?.classList.add("hidden");

      // Auto-reselect Library and Song (dispatches real change events)
      await reselectLibraryAndSong(packName, songName);

      // Land on Step 3 (instrument selection)
      document.getElementById("step3")?.classList.remove("hidden");
      const dots = document.querySelectorAll(".stepper .dot");
      if (dots && dots.length) dots.forEach((d,i)=>d.classList.toggle("active", i<=2));
    } catch (e) {
      console.error("[finalViewer] back error:", e);
    }
  }

  async function reselectLibraryAndSong(packName, songName) {
    const libSel = document.getElementById("librarySelect");
    if (libSel && packName) {
      for (let i=0; i<libSel.options.length; i++) {
        if (libSel.options[i].textContent === packName) { libSel.selectedIndex = i; break; }
      }
      libSel.dispatchEvent(new Event("change", { bubbles: true }));
    }

    // Wait until songSelect is populated
    await waitFor(() => {
      const el = document.getElementById("songSelect");
      return el && el.options && el.options.length > 1;
    }, 4000);

    const songSel = document.getElementById("songSelect");
    if (songSel && songName) {
      for (let i=0; i<songSel.options.length; i++) {
        if (songSel.options[i].textContent === songName) { songSel.selectedIndex = i; break; }
      }
      songSel.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function waitFor(cond, timeoutMs=3000, interval=100) {
    return new Promise(resolve => {
      const start = Date.now();
      const iv = setInterval(() => {
        if (cond()) { clearInterval(iv); resolve(true); }
        else if (Date.now() - start > timeoutMs) { clearInterval(iv); resolve(false); }
      }, interval);
    });
  }

  // Shrink-to-fit vertically
  function fitScoreToHeight(osmd, host) {
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

    if (Math.abs(target - current) > 0.01) {
      osmd.zoom = target;
      osmd.render();
    }
  }

  // Slash-note transform (safe no-op for most files)
  function transformXmlForSlashes(xmlString) {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlString, "application/xml");
      const parts = xmlDoc.getElementsByTagName("part");
      for (const part of parts) {
        const measures = part.getElementsByTagName("measure");
        let insideSlash = false;
        let currentClef = "treble";
        for (const measure of measures) {
          const attributes = measure.getElementsByTagName("attributes");
          for (const attr of attributes) {
            const clef = attr.getElementsByTagName("clef")[0];
            if (clef) {
              const sign = clef.getElementsByTagName("sign")[0]?.textContent?.toLowerCase();
              if (sign) currentClef = sign;
            }
          }
          const directions = measure.getElementsByTagName("direction");
          for (const dir of directions) {
            const slash = dir.getElementsByTagName("slash")[0];
            if (slash) {
              const type = slash.getAttribute("type");
              if (type === "start") insideSlash = true;
              if (type === "stop") insideSlash = false;
            }
          }
          const styles = measure.getElementsByTagName("measure-style");
          for (const style of styles) {
            const slash = style.getElementsByTagName("slash")[0];
            if (slash) {
              const type = slash.getAttribute("type");
              if (type === "start") insideSlash = true;
              if (type === "stop") insideSlash = false;
            }
          }
          if (insideSlash) {
            const noteList = Array.from(measure.getElementsByTagName("note"));
            for (const note of noteList) {
              const pitch = note.getElementsByTagName("pitch")[0];
              const unpitched = note.getElementsByTagName("unpitched")[0];
              if (pitch || unpitched) {
                const newNote = xmlDoc.createElement("note");
                if (currentClef === "percussion") {
                  const unp = xmlDoc.createElement("unpitched");
                  const ds = xmlDoc.createElement("display-step"); ds.textContent = "E";
                  const dox = xmlDoc.createElement("display-octave"); dox.textContent = "4";
                  unp.appendChild(ds); unp.appendChild(dox);
                  newNote.appendChild(unp);
                } else {
                  const p = xmlDoc.createElement("pitch");
                  const step = xmlDoc.createElement("step");
                  const octave = xmlDoc.createElement("octave");
                  if (currentClef === "bass") { step.textContent = "D"; octave.textContent = "2"; }
                  else { step.textContent = "B"; octave.textContent = "4"; }
                  p.appendChild(step); p.appendChild(octave);
                  newNote.appendChild(p);
                }
                const duration = note.getElementsByTagName("duration")[0];
                const voice = note.getElementsByTagName("voice")[0];
                const type = note.getElementsByTagName("type")[0];
                if (duration) newNote.appendChild(duration.cloneNode(true));
                if (voice) newNote.appendChild(voice.cloneNode(true));
                if (type) newNote.appendChild(type.cloneNode(true));
                const notehead = xmlDoc.createElement("notehead");
                notehead.textContent = "slash";
                newNote.appendChild(notehead);
                note.parentNode.replaceChild(newNote, note);
              }
            }
          }
        }
      }
      return new XMLSerializer().serializeToString(xmlDoc);
    } catch { return xmlString; }
  }
})();

