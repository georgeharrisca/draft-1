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
  // AA.on("instruments:saved", (state) => {
  //   AA.safe("assignParts", () => {
  //     const s = JSON.parse(sessionStorage.getItem(STATE_KEY));
  //     // ...compute new fields here...
  //     sessionStorage.setItem(STATE_KEY, JSON.stringify(s));
  //   });
  // });

})();
