document.getElementById("processButton").addEventListener("click", processFiles);

function processFiles() {
  // Example data for testing – will later come from XML
  let instruments = [
    { name: "Violin", octave: 5 },
    { name: "Cello", octave: 3 },
    { name: "Flute", octave: 6 },
    { name: "Trumpet", octave: 4 },
    { name: "Tuba", octave: 2 },
    { name: "Clarinet", octave: 4 },
    { name: "Oboe", octave: 5 }
  ];

  // 🔑 Step 1: Convert octave → sortNumber
  instruments.forEach(inst => {
    inst.sortNumber = inst.octave * 10 + Math.random(); // add slight decimal offset
  });

  // 🔑 Step 2: Sort by sortNumber
  instruments.sort((a, b) => a.sortNumber - b.sortNumber);

  let assignments = [];

  // 🔑 Step 3: Assign parts
  // 1. Lowest → Part 1 (Melody)
  if (instruments.length > 0) {
    let melody = instruments.shift();
    melody.assignedPart = 1;
    assignments.push(melody);
  }

  // 2. Highest → Part 6 (Bass)
  if (instruments.length > 0) {
    let bass = instruments.pop();
    bass.assignedPart = 6;
    assignments.push(bass);
  }

  // 3. Next lowest four → Parts 2, 4, 3, 5
  const middleParts = [2, 4, 3, 5];
  for (let i = 0; i < 4 && instruments.length > 0; i++) {
    let inst = instruments.shift();
    inst.assignedPart = middleParts[i];
    assignments.push(inst);
  }

  // 4. Remaining instruments cycle {1, 6, 2, 4, 3, 5}
  const cycle = [1, 6, 2, 4, 3, 5];
  let cycleIndex = 0;
  while (instruments.length > 0) {
    let inst = instruments.shift();
    inst.assignedPart = cycle[cycleIndex];
    assignments.push(inst);
    cycleIndex = (cycleIndex + 1) % cycle.length;
  }

  // 🔑 Step 4: Update table
  const tbody = document.querySelector("#outputTable tbody");
  tbody.innerHTML = "";

  assignments.forEach(inst => {
    let row = document.createElement("tr");
    row.innerHTML = `
      <td>${inst.name}</td>
      <td>${inst.octave}</td>
      <td>${inst.sortNumber.toFixed(2)}</td>
      <td>${inst.assignedPart}</td>
    `;
    tbody.appendChild(row);
  });
}
