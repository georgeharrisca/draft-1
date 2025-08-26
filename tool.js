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

    // Hide assignments panel if visible
    const p = document.getElementById("aa-assignments-panel");
    if (p) p.style.display = "none";
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

    // Hide assignments panel if visible
    const p = document.getElementById("aa-assignments-panel");
    if (p) p.style.display = "none";
  });

  // Save instrument selections
  saveInstruments.addEventListener("click", () => {
    const selections = [];
    instrumentData.forEach(inst => {
      const qty = parseInt(document.getElementById(`qty_${cssId(inst.name)}`).value || "0", 10);
      if (qty > 0) {
        selections.push({
          name: inst.name,
          quantity: qty,
          instrumentPart: inst.instrumentPart,
          Octave: inst.Octave,
          clef: inst.clef ?? null,
          transpose: inst.transpose ?? null,
          assignedPart: "" // placeholder
        });
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
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
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


/* =====================================================================
   Auto Arranger — Draft 1 Guard / Module Layer (append-only)
   - Event bus + checkpoints
   - Emits:
       "parts:extracted"      when parts payload first appears in sessionStorage
       "instruments:saved"    when instrumentSelections first appear
   ===================================================================== */
(function () {
  const AA = (window.AA = window.AA || {});
  AA.VERSION = "draft-1";
  AA.DEBUG = false;

  // --- event bus ---
  const listeners = {};
  AA.on = function (evt, fn) { (listeners[evt] ||= []).push(fn); return () => AA.off(evt, fn); };
  AA.off = function (evt, fn) { const a = listeners[evt]; if (!a) return; const i = a.indexOf(fn); if (i>-1) a.splice(i,1); };
  AA.emit = function (evt, payload) {
    (listeners[evt] || []).forEach(fn => { try { fn(payload); } catch (e) { console.error("[AA] listener error:", evt, e); } });
  };

  // --- patch sessionStorage.setItem to emit lifecycle events ---
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
      if (!prevObj.parts && nextObj.parts) AA.emit("parts:extracted", nextObj);
      if (!prevObj.instrumentSelections && nextObj.instrumentSelections) AA.emit("instruments:saved", nextObj);
    } catch { /* no-op */ }
  };

  // --- checkpoints (JSON only) ---
  AA.saveCheckpoint = function (name) {
    const raw = sessionStorage.getItem(STATE_KEY);
    if (!raw) return false;
    const all = JSON.parse(sessionStorage.getItem(CP_KEY) || "{}");
    all[name] = raw;
    _setItem(CP_KEY, JSON.stringify(all));
    if (AA.DEBUG) console.log("[AA] checkpoint saved:", name);
    return true;
  };
  AA.restoreCheckpoint = function (name) {
    const all = JSON.parse(sessionStorage.getItem(CP_KEY) || "{}");
    if (!all[name]) return false;
    sessionStorage.setItem(STATE_KEY, all[name]);
    if (AA.DEBUG) console.log("[AA] checkpoint restored:", name);
    return true;
  };

  // auto-save "draft-1" once instruments are saved (safe revert point)
  AA.on("instruments:saved", () => AA.saveCheckpoint("draft-1"));

  // safe wrapper for future modules
  AA.safe = function (moduleName, fn) {
    try { return fn(); }
    catch (err) {
      console.error(`[AA] Module "${moduleName}" failed:`, err);
      AA.restoreCheckpoint("draft-1");
      alert(`"${moduleName}" hit an error. Restored to Draft 1 state.`);
    }
  };

  // quick keyboard restore: Ctrl + Shift + D
  document.addEventListener("keydown", (e) => {
    const key = (e.key || "").toLowerCase();
    if (e.ctrlKey && e.shiftKey && key === "d") {
      AA.restoreCheckpoint("draft-1");
    }
  });
})();

/* =====================================================================
   Module: assignParts (append-only)
   - Expands quantities into numbered instruments
   - Computes sortNumber (base 1..6, then minus Octave) with tie-break decimals
   - Assigns assignedPart per rules:
       * Fixed parts 7..15 => assignedPart = instrumentPart
       * Lowest numeric => 1 Melody
       * (if ≥2) Highest numeric => 6 Bass
       * Next four lowest => 2,4,3,5
       * Remaining (low→high) => cycle {1,6,2,4,3,5}
   - Renders a results table in a new panel
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

  const NAME_TO_NUM = {
    "Melody": 1,
    "Harmony I": 2,
    "Harmony II": 3,
    "Counter Melody": 4,
    "Counter Melody Harmony": 5,
    "Bass": 6,
    "Groove": 7,
    "Chords": 8,
    "Drum Kit": 9,
    "Melody & Bass": 10,
    "Melody & Chords": 11,
    "Chords & Bass": 12,
    "Melody & Chords & Bass": 13,
    "Timpani": 14,
    "Triangle": 15
  };

  const INITIAL_FOUR = [2,4,3,5];             // after low & high
  const CYCLE = [1,6,2,4,3,5];                 // repeated for the remainder

  const STATE_KEY = "autoArranger_extractedParts";

  // Run when instruments are saved
  AA.on("instruments:saved", () => AA.safe("assignParts", runAssignParts));

  // also expose for manual re-run if needed
  window.runAssignParts = runAssignParts;

  // Hide panel when navigating back
  document.getElementById("backToSong")?.addEventListener("click", hidePanel);
  document.getElementById("backButton")?.addEventListener("click", hidePanel);

  function runAssignParts() {
    const raw = sessionStorage.getItem(STATE_KEY);
    if (!raw) return;
    const state = JSON.parse(raw);
    const selections = state.instrumentSelections || [];
    if (!selections.length) { hidePanel(); return; }

    const expanded = expandSelections(selections); // [{name, instrumentPart, Octave, clef, transpose}]
    // partition into fixed (7..15) and numeric (1..6)
    const fixed = [];
    const numeric = [];
    for (const it of expanded) {
      const partNum = NAME_TO_NUM[it.instrumentPart] || 99;
      if (partNum >= 7) {
        fixed.push({
          ...it,
          sortRaw: null,
          sortDisplay: "—",
          assignedPart: it.instrumentPart
        });
      } else {
        const base = partNum;                 // 1..6
        const octave = parseInt(it.Octave || 0, 10) || 0;
        const sortRaw = base - octave;        // subtract positive, add abs(negative)
        numeric.push({
          ...it,
          sortRaw, // number (can be negative / >6)
          sortDisplay: "", // to fill after tie-break
          assignedPart: ""
        });
      }
    }

    // sort numeric by sortRaw, then name A→Z
    numeric.sort((a,b) => (a.sortRaw - b.sortRaw) || a.name.localeCompare(b.name));

    // assign tie-break decimals: for same integer sortRaw, order A→Z →  .1, .2,… ; singleton gets .0
    applyTieBreakDecimals(numeric);

    // assignment
    const assignedNumeric = assignNumericParts(numeric);

    // final list for rendering: numeric (by sortRaw asc then decimals), then fixed (alphabetical)
    assignedNumeric.sort((a,b) => (a.sortRaw - b.sortRaw) || compareSortDisplay(a.sortDisplay,b.sortDisplay));
    fixed.sort((a,b) => a.name.localeCompare(b.name));

    const finalList = [...assignedNumeric, ...fixed];

    // persist results alongside state
    state.assignedResults = finalList.map(({ name, instrumentPart, Octave, sortDisplay, assignedPart }) => ({
      name, instrumentPart, Octave, sortNumber: sortDisplay, assignedPart
    }));
    sessionStorage.setItem(STATE_KEY, JSON.stringify(state));

    // render
    renderAssignmentsPanel(finalList);
  }

  function expandSelections(selections) {
    const out = [];
    for (const s of selections) {
      const qty = Math.max(0, parseInt(s.quantity || 0,10));
      for (let i=1; i<=qty; i++){
        out.push({
          name: qty > 1 ? `${s.name} ${i}` : s.name,
          instrumentPart: s.instrumentPart,
          Octave: parseInt(s.Octave || 0,10) || 0,
          clef: s.clef ?? null,
          transpose: s.transpose ?? null
        });
      }
    }
    // alphabetize for stable tie-breaks downstream
    out.sort((a,b)=> a.name.localeCompare(b.name));
    return out;
  }

  function applyTieBreakDecimals(arr) {
    if (!arr.length) return;
    // group by sortRaw (exact number)
    let i = 0;
    while (i < arr.length) {
      const base = arr[i].sortRaw;
      let j = i;
      const group = [];
      while (j < arr.length && arr[j].sortRaw === base) { group.push(arr[j]); j++; }
      if (group.length === 1) {
        group[0].sortDisplay = `${base.toFixed(1)}`.replace(/\.0+$/,".0"); // always .0
      } else {
        // alphabetical already ensured by prior sort; assign .1, .2, …
        group.forEach((g,idx) => g.sortDisplay = `${base}.${idx+1}`);
      }
      i = j;
    }
  }

  function assignNumericParts(numeric) {
    // copy to avoid mutating input order unexpectedly
    const list = numeric.map(x => ({...x}));
    if (list.length === 0) return list;

    // mark finalized by stacking assignments
    const taken = new Set();

    // 1) lowest -> 1 Melody
    const lowIdx = 0;
    list[lowIdx].assignedPart = NUM_LABEL[1];
    taken.add(list[lowIdx].name);

    // 2) (if ≥2) highest -> 6 Bass
    if (list.length >= 2) {
      const highIdx = list.length - 1;
      if (!taken.has(list[highIdx].name])) {
        list[highIdx].assignedPart = NUM_LABEL[6];
        taken.add(list[highIdx].name);
      }
    }

    // remaining, from low→high
    const remaining = list.filter(x => !taken.has(x.name));

    // 3) next four: 2,4,3,5
    const firstFour = remaining.slice(0, 4);
    for (let i=0; i<firstFour.length; i++){
      const labelNum = INITIAL_FOUR[i];
      firstFour[i].assignedPart = NUM_LABEL[labelNum];
      taken.add(firstFour[i].name);
    }

    // 4) the rest: cycle 1,6,2,4,3,5
    const rest = list.filter(x => !taken.has(x.name));
    for (let i=0; i<rest.length; i++){
      const labelNum = CYCLE[i % CYCLE.length];
      rest[i].assignedPart = NUM_LABEL[labelNum];
      taken.add(rest[i].name);
    }

    return list;
  }

  function compareSortDisplay(a, b) {
    // a and b are strings like "2.1", "2.3", "2.0"
    const na = parseFloat(a), nb = parseFloat(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return String(a).localeCompare(String(b));
  }

  function renderAssignmentsPanel(list) {
    // ensure root
    const root = document.getElementById("aa-modules-root") || document.body;

    // panel scaffold
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
      // place panel after the main card if aa-modules-root missing; else inside root
      if (root.id === "aa-modules-root") {
        root.removeAttribute("hidden");
        root.setAttribute("aria-hidden","false");
        root.appendChild(panel);
      } else {
        document.body.appendChild(panel);
      }
    }

    // fill table
    const tbody = panel.querySelector("tbody");
    tbody.innerHTML = "";
    for (const row of list) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="padding:8px; border-bottom:1px solid var(--line);">${escape(row.name)}</td>
        <td style="padding:8px; border-bottom:1px solid var(--line); color:var(--muted);">${escape(row.sortDisplay || "—")}</td>
        <td style="padding:8px; border-bottom:1px solid var(--line);"><strong>${escape(row.assignedPart || "")}</strong></td>
      `;
      tbody.appendChild(tr);
    }
    panel.style.display = "block";
    // scroll into view the first time
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function hidePanel(){
    const p = document.getElementById("aa-assignments-panel");
    if (p) p.style.display = "none";
  }

  function escape(s){ return String(s ?? "").replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
})();
