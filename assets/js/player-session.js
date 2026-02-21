/* player-session.js
   - Player name entry overlay
   - Starts timer on Start
   - Stops timer ONLY on successful completion (engine emits "vacuum:finish")
   - Logs results (localStorage) + Download CSV
   - Optional: append to a chosen file (Chrome/Edge File System Access API)
*/

(function () {
    const overlay = document.getElementById("sessionOverlay");
    const nameInput = document.getElementById("playerNameInput");
    const startBtn = document.getElementById("startSessionBtn");

    const playerLabel = document.getElementById("playerLabel");
    const timerLabel = document.getElementById("timerLabel");
    const modeLabel = document.getElementById("modeLabel");

    const chooseFileBtn = document.getElementById("chooseFileBtn");
    const downloadCsvBtn = document.getElementById("downloadCsvBtn");
    const newPlayerBtn = document.getElementById("newPlayerBtn");

    let selectedMode = null;

    // Timer
    let startTime = null;
    let timerInterval = null;

    // File System Access (optional)
    let fileHandle = null;

    // Storage
    const STORAGE_KEY = "vacuum_results_v1";

    function loadResults() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    }

    function saveResults(results) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(results));
    }

    function formatTime(ms) {
        const totalSec = ms / 1000;
        const min = Math.floor(totalSec / 60);
        const sec = totalSec - min * 60;
        const secStr = sec.toFixed(1).padStart(4, "0"); // "00.0"
        return `${String(min).padStart(2, "0")}:${secStr}`;
    }

    function nowIso() {
        return new Date().toISOString();
    }

    function setStartEnabled() {
        const hasName = (nameInput.value || "").trim().length > 0;
        startBtn.disabled = !(hasName && selectedMode);
    }

    function setSelectedButton(mode) {
        const buttons = overlay.querySelectorAll("[data-mode]");
        buttons.forEach(btn => {
            btn.style.borderColor = "rgba(148,163,184,0.25)";
            btn.style.outline = "none";
            if (btn.getAttribute("data-mode") === mode) {
                btn.style.borderColor = "rgba(34,197,94,0.7)";
                btn.style.outline = "2px solid rgba(34,197,94,0.25)";
            }
        });
    }

    function resetSessionUI() {
        selectedMode = null;
        window.VACUUM_GAME_MODE = "map1";
        window.VACUUM_PLAYER_NAME = "";

        playerLabel.textContent = "—";
        modeLabel.textContent = "—";
        timerLabel.textContent = "00:00.0";

        nameInput.value = "";
        setSelectedButton(null);
        setStartEnabled();

        overlay.style.display = "grid";
    }

    function startTimer() {
        startTime = performance.now();
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            timerLabel.textContent = formatTime(performance.now() - startTime);
        }, 100);
    }

    function stopTimer() {
        if (!startTime) return 0;
        const elapsed = performance.now() - startTime;
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = null;
        return elapsed;
    }

    // Hidden textarea + Monaco helpers
    function getCodeBox() {
        return document.getElementById("codeBox");
    }

    function getEditorHandle() {
        if (window.__VACUUM_EDITOR__ && typeof window.__VACUUM_EDITOR__.setValue === "function") return window.__VACUUM_EDITOR__;
        if (window.editor && typeof window.editor.setValue === "function") return window.editor;
        return null;
    }

    function setEditorText(text) {
        const codeBox = getCodeBox();
        if (codeBox) codeBox.value = text;

        const ed = getEditorHandle();
        if (ed && typeof ed.setValue === "function") {
            ed.setValue(text);
            return;
        }

        // Fallback Monaco model
        if (window.monaco && window.monaco.editor && typeof window.monaco.editor.getModels === "function") {
            const models = window.monaco.editor.getModels();
            if (models && models[0] && typeof models[0].setValue === "function") {
                models[0].setValue(text);
            }
        }
    }

    function clearStudentCode() {
        setEditorText("");
    }

    function getStarterCodeForMode(mode) {
        if (mode === "map2") {
            return `// Map 2: Clean the whole room (all reachable tiles).
let safety = 0;

while (!vacuum.isAllCleaned() && safety++ < 200) {
  if (vacuum.isBarrierAhead()) vacuum.turnRight();
  else vacuum.forward();
}`;
        }

        if (mode === "map3") {
            return `// Map 3: Follow the line back to the dock.
// Rule: forward() must stay on the yellow line (or dock).
let safety = 0;

while (!vacuum.isInDocking() && safety++ < 200) {
  if (vacuum.isLineAhead() && !vacuum.isVisitedAhead()) {
    vacuum.forward();
  } else {
    vacuum.turnRight();
  }
}`;
        }

        // map1
        return `// Map 1: Reach the dock (⚓).
let safety = 0;

while (!vacuum.isInDocking() && safety++ < 200) {
  if (vacuum.isBarrierAhead()) vacuum.turnRight();
  else vacuum.forward();
}`;
    }

    function getCurrentEditorText() {
        const ed = getEditorHandle();
        if (ed && typeof ed.getValue === "function") {
            return ed.getValue();
        }
        const codeBox = getCodeBox();
        return codeBox ? (codeBox.value || "") : "";
    }

    // Ensures empty editor gets a fresh starter template after "New player"
    function ensureStarterCodeIfEmpty(mode) {
        const current = (getCurrentEditorText() || "").trim();
        if (current.length > 0) return;
        setEditorText(getStarterCodeForMode(mode));
    }

    // CSV helpers
    function csvEscape(s) {
        const str = String(s ?? "");
        if (/[",\n]/.test(str)) return `"${str.replaceAll('"', '""')}"`;
        return str;
    }

    function resultsToCsv(results) {
        const header = ["timestamp", "player", "game", "seconds"].join(",");
        const lines = results.map(r => [
            csvEscape(r.timestamp),
            csvEscape(r.player),
            csvEscape(r.game),
            csvEscape(r.seconds.toFixed(2))
        ].join(","));
        return [header, ...lines].join("\n");
    }

    function downloadCsv() {
        const results = loadResults();
        const csv = resultsToCsv(results);
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = "vacuum-results.csv";
        document.body.appendChild(a);
        a.click();
        a.remove();

        URL.revokeObjectURL(url);
    }

    // File System Access: append one line to chosen file (Chrome/Edge)
    async function chooseFile() {
        if (!window.showSaveFilePicker) {
            alert("Choosing a results file is supported in Chrome/Edge. Use Download CSV instead.");
            return;
        }

        fileHandle = await window.showSaveFilePicker({
            suggestedName: "vacuum-results.csv",
            types: [{
                description: "CSV",
                accept: { "text/csv": [".csv"] }
            }]
        });

        // If file is new/empty, write header once
        const file = await fileHandle.getFile();
        if (file.size === 0) {
            const writable = await fileHandle.createWritable();
            await writable.write("timestamp,player,game,seconds\n");
            await writable.close();
        }

        alert("Results file selected. Successful runs will be appended to it.");
    }

    async function appendToFile(entry) {
        if (!fileHandle) return;
        try {
            const file = await fileHandle.getFile();
            const writable = await fileHandle.createWritable({ keepExistingData: true });
            await writable.seek(file.size);

            const line = [
                entry.timestamp,
                entry.player,
                entry.game,
                entry.seconds.toFixed(2)
            ].map(csvEscape).join(",") + "\n";

            await writable.write(line);
            await writable.close();
        } catch (e) {
            console.warn("Append failed:", e);
            // If permissions change, we just fall back to localStorage + download
        }
    }

    // Hook up mode buttons
    overlay.querySelectorAll("[data-mode]").forEach(btn => {
        btn.addEventListener("click", () => {
            selectedMode = btn.getAttribute("data-mode");
            window.VACUUM_GAME_MODE = selectedMode;
            setSelectedButton(selectedMode);
            setStartEnabled();
        });
    });

    nameInput.addEventListener("input", setStartEnabled);

    startBtn.addEventListener("click", () => {
        const name = (nameInput.value || "").trim();
        if (!name || !selectedMode) return;

        window.VACUUM_PLAYER_NAME = name;
        window.VACUUM_GAME_MODE = selectedMode;

        // IMPORTANT FIX:
        // If previous player's code was cleared, restore starter code for selected mode.
        ensureStarterCodeIfEmpty(selectedMode);

        playerLabel.textContent = name;
        modeLabel.textContent = selectedMode;

        overlay.style.display = "none";
        startTimer();
    });

    // Buttons
    downloadCsvBtn?.addEventListener("click", downloadCsv);
    chooseFileBtn?.addEventListener("click", () => chooseFile().catch(console.error));

    newPlayerBtn?.addEventListener("click", () => {
        // 1) Stop any replay that might be running
        const stopBtn = document.getElementById("stopBtn");
        if (stopBtn && !stopBtn.disabled) stopBtn.click();

        // 2) Reset the game board/state back to start (current mode)
        const resetBtn = document.getElementById("resetBtn");
        if (resetBtn && !resetBtn.disabled) resetBtn.click();

        // 3) Clear previous student's solution/code
        clearStudentCode();

        // 4) Stop timer + clear session info
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = null;
        startTime = null;

        window.VACUUM_PLAYER_NAME = "";

        // Reset labels
        playerLabel.textContent = "—";
        timerLabel.textContent = "00:00.0";
        // modeLabel.textContent = "—"; // keep mode label as-is if preferred

        // 5) Show player overlay again
        overlay.style.display = "grid";
        nameInput.value = "";
        nameInput.focus();

        // Keep previously selected mode (students don't need to re-select)
        // If you want re-select each time, uncomment:
        // selectedMode = null;
        // modeLabel.textContent = "—";
        // setSelectedButton(null);

        setStartEnabled();
    });

    // Listen for engine completion
    // Engine must dispatch: window.dispatchEvent(new CustomEvent("vacuum:finish", {detail:{success, game, ticks, message}}))
    window.addEventListener("vacuum:finish", async (ev) => {
        const detail = ev.detail || {};
        if (!detail.success) return; // timer ends ONLY on success

        const elapsedMs = stopTimer();
        const seconds = elapsedMs / 1000;

        const entry = {
            timestamp: nowIso(),
            player: window.VACUUM_PLAYER_NAME || "Unknown",
            game: detail.game || window.VACUUM_GAME_MODE || "map1",
            seconds
        };

        const results = loadResults();
        results.push(entry);
        saveResults(results);

        await appendToFile(entry);

        const statusEl = document.getElementById("status");
        if (statusEl) {
            statusEl.textContent = `✅ Completed! ${entry.player} finished ${entry.game} in ${seconds.toFixed(2)}s`;
        }
    });

    // Initial state
    setStartEnabled();
})();