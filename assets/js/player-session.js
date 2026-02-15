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

            // Optional: if you want editor-ide.js to reload template per mode,
            // you can refresh page after choosing mode. Most people avoid that.
            // location.reload();
        });
    });

    nameInput.addEventListener("input", setStartEnabled);

    startBtn.addEventListener("click", () => {
        const name = (nameInput.value || "").trim();
        if (!name || !selectedMode) return;

        window.VACUUM_PLAYER_NAME = name;
        window.VACUUM_GAME_MODE = selectedMode;

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

        // 3) Stop timer + clear session info
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = null;
        startTime = null;

        window.VACUUM_PLAYER_NAME = "";

        // Reset labels
        playerLabel.textContent = "—";
        timerLabel.textContent = "00:00.0";
        // Keep the game mode label as-is (or set to "—" if you prefer)
        // modeLabel.textContent = "—";

        // 4) Show player overlay again
        overlay.style.display = "grid";
        nameInput.value = "";
        nameInput.focus();

        // Keep the previously selected mode (so they don’t have to choose again)
        // If you want them to re-choose mode each time, uncomment the next 3 lines:
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

        // Optional: show a friendly completion message in the status bar if present
        const statusEl = document.getElementById("status");
        if (statusEl) {
            statusEl.textContent = `✅ Completed! ${entry.player} finished ${entry.game} in ${seconds.toFixed(2)}s`;
        }
    });

    // Initial state
    setStartEnabled();
})();
