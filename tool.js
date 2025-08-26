document.addEventListener("DOMContentLoaded", () => {
  const step1 = document.getElementById("step1");
  const step2 = document.getElementById("step2");
  const librarySelect = document.getElementById("librarySelect");
  const songSelect = document.getElementById("songSelect");
  const backButton = document.getElementById("backButton");
  const extractButton = document.getElementById("extractButton");
  const statusEl = document.getElementById("status");
  const packsStatus = document.getElementById("packsStatus");

  // stepper dots (purely visual)
  const dots = document.querySelectorAll(".stepper .dot");
  const setStep = (n) => {
    dots.forEach((d, i) => d.classList.toggle("active", i <= n));
  };

  let libraryData = {};
  const INDEX_URL = "./libraryData.json";

  init();

  async function init() {
    packsStatus.textContent = "Loading packs…";
    try {
      const res = await fetch(INDEX_URL, { cache: "no-store" });
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
      setStep(0);
    } catch (err) {
      console.error("Failed to load libraryData.json:", err);
      librarySelect.innerHTML = '<option value="">(Failed to load packs)</option>';
      packsStatus.textContent = "Could not load library packs. Ensure libraryData.json is deployed.";
      packsStatus.classList.add("err");
    }
  }

  librarySelect.addEventListener("change", () => {
    const pack = librarySelect.value;
    if (!pack) return;

    songSelect.innerHTML = '<option value="">-- Choose a Song --</option>';
    (libraryData[pack] || []).forEach(song => {
      const opt = document.createElement("option");
      opt.value = song.url;
      opt.textContent = song.name;
      songSelect.appendChild(opt);
    });

    extractButton.disabled = true;
    statusEl.textContent = "";
    step1.classList.add("hidden");
    step2.classList.remove("hidden");
    setStep(1);
  });

  songSelect.addEventListener("change", () => {
    extractButton.disabled = !songSelect.value;
    statusEl.textContent = "";
  });

  backButton.addEventListener("click", () => {
    step2.classList.add("hidden");
    step1.classList.remove("hidden");
    librarySelect.value = "";
    songSelect.innerHTML = "";
    extractButton.disabled = true;
    statusEl.textContent = "";
    setStep(0);
  });

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
        parts: partsPayload.parts,
        scoreMeta: partsPayload.scoreMeta
      };

      sessionStorage.setItem("autoArranger_extractedParts", JSON.stringify(state));
      statusEl.textContent = "Parts data ready for the next step.";
      statusEl.classList.remove("err");
      statusEl.classList.add("ok");
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

  // ---- Helpers ----
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

    return {
      scoreMeta: { movementTitle, workTitle, composer },
      parts
    };
  }

  function textOrNull(node) {
    return node ? (node.textContent || "").trim() : null;
  }

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
});
