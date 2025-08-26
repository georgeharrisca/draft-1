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
  const extractButton = document.getElementById("extractButton");
  const statusEl = document.getElementById("status");

  // ---- Step 3 elements ----
  const instrumentGrid = document.getElementById("instrumentGrid");
  const backToSong = document.getElementById("backToSong");
  const saveInstruments = document.getElementById("saveInstruments");
  const instStatus = document.getElementById("instStatus");

  // ---- Stepper dots (visual only) ----
  const dots = document.querySelectorAll(".stepper .dot");
  const setStep = (n) => dots.forEach((d,i)=>d.classList.toggle("active", i<=n));

  // ---- Data holders ----
  let libraryData = {};
  let instrumentData = [];

  // JSON endpoints (kept relative; place these files alongside index.html)
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

    // Load library packs
    await loadLibraryData();

    // Load instruments (for Step 3)
    await loadInstrumentData();
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
        opt.value = packName;
        opt.textContent = packName;
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

    // Populate songs for selected pack
    songSelect.innerHTML = '<option value="">-- Choose a Song --</option>';
    (libraryData[pack] || []).forEach(song => {
      const opt = document.createElement("option");
      opt.value = song.url;
      opt.textContent = song.name;
      songSelect.appendChild(opt);
    });

    // Transition to Step 2
    extractButton.disabled = true;
    statusEl.textContent = "";
    step1.classList.add("hidden");
    step2.classList.remove("hidden");
    step3.classList.add("hidden");
    setStep(1);
  });

  // Enable Extract when a song is chosen
  songSelect.addEventListener("change", () => {
    extractButton.disabled = !songSelect.value;
    statusEl.textContent = "";
  });

  // Back Step 2 → Step 1
  backButton.addEventListener("click", () => {
    step2.classList.add("hidden");
    step1.classList.remove("hidden");
    step3.classList.add("hidden");
    librarySelect.value = "";
    songSelect.innerHTML = "";
    extractButton.disabled = true;
    statusEl.textContent = "";
    setStep(0);
  });

  // ====== Extract Parts Data then go to Instruments (Step 3) ======
  extractButton.addEventListener("click", async () => {
    const songUrl = songSelect.value;
    if (!songUrl) {
      alert("Please select a song.");
      return;
    }

    extractButton.disabled = true;
    statusEl.textContent = "Extracting parts…";

    try {
      const xmlText = await (await fetch(songUrl)).text();
      const partsPayload = extractParts(xmlText);

      const packName = librarySelect.value;
      const songName = songSelect.options[songSelect.selectedIndex].textContent;

      const state = {
        timestamp: Date.now(),
        pack: packName,
        song: songName,
        parts: partsPayload.parts,        // [{ id, partName, xml }]
        scoreMeta: partsPayload.scoreMeta // { movementTitle, composer, workTitle }
      };
      sessionStorage.setItem("autoArranger_extractedParts", JSON.stringify(state));

      statusEl.textContent = "Parts data ready. Proceed to instrument selection.";
      statusEl.classList.remove("err");
      statusEl.classList.add("ok");

      // Transition to Step 3
      renderInstrumentSelectors();
      step2.classList.add("hidden");
      step3.classList.remove("hidden");
      setStep(2);
    } catch (err) {
      console.error(err);
      statusEl.textContent = "Failed to extract parts.";
      statusEl.classList.remove("ok");
      statusEl.classList.add("err");
    } finally {
      extractButton.disabled = false;
    }
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
        <h4>${sanitize(inst.name)}</h4>
        <div class="note">
          Part: ${sanitize(inst.instrumentPart)} • Octave: ${inst.Octave >= 0 ? "+"+inst.Octave : inst.Octave}<br>
          Clef: ${sanitize(inst.clef || "—")} • Transpose: ${chromDisplay}
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
  function sanitize(s){ return String(s ?? "").replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }

  // Back Step 3 → Step 2
  backToSong.addEventListener("click", () => {
    step3.classList.add("hidden");
    step2.classList.remove("hidden");
    setStep(1);
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
          assignedPart: "" // placeholder for next step
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
    setStep(3); // visually mark last dot
  });

  // ====== Helpers for MusicXML extraction ======
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
    } catch {
      return null;
    }
  }
});
