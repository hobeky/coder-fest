"use strict";

/**
 * Vacuum Grid Game Engine
 * - Runs user program in "record mode" (builds a command list)
 * - Then replays commands at 0.1s per tick
 *
 * Assignments (same map):
 *  - map1: start at vacuumStart, win when reaching dock
 *  - map2: start at dock, win when all reachable tiles are visited ("cleaned")
 *  - map3: start at vacuumStart, must follow a line to dock (forward steps must land on line or dock)
 *
 * Trail/visited visualization is enabled for all.
 */

(function () {
    const TICK_MS = 100;
    const MAX_STEPS = 200; // Max recorded vacuum commands (replay safety)

    // ====== Level definition ======
    const LEVEL = {
        rows: 15,
        cols: 12,

        obstacles: new Set([
            // BOOKCASE
            "1,12", "1,11",
            "2,12", "2,11",

            // COUCH
            "5,1", "5,2",
            "6,1", "6,2",
            "7,1", "7,2",
            "8,1", "8,2",
            "9,1", "9,2",
            "10,1", "10,2",

            // COFFEE TABLE
            "6,4", "6,5",
            "7,4", "7,5",
            "8,4", "8,5",

            // TV TABLE
            "5,12",
            "6,12",
            "7,12",
            "8,12",
            "9,12",

            // TOP MIDDLE OBSTACLE
            "2,7", "2,8",
            "3,7", "3,8",

            // BOTTOM MIDDLE OBSTACLE
            "12,5", "12,6", "12,7",
            "13,5", "13,6", "13,7",
            "14,5", "14,6", "14,7",
            "15,5", "15,6", "15,7"
        ]),

        vacuumStart: { r: 1, c: 1, dir: "E" },
        dock: { r: 15, c: 12 }
    };

    // ====== Mode / assignment ======
    function getMode() {
        const m = (window.VACUUM_GAME_MODE || "map1").toLowerCase();
        if (m === "map2") return "map2";
        if (m === "map3") return "map3";
        return "map1";
    }
    // NOTE: mode can change between players without reloading engine.js
    function currentMode() { return getMode(); }

    function emitFinish(success, message) {
        window.dispatchEvent(new CustomEvent("vacuum:finish", {
            detail: {
                success,
                game: (window.VACUUM_GAME_MODE || "map1"),
                message,
                ticks: typeof replayIndex === "number" ? replayIndex : 0,
                metrics: getReplayMetricsSnapshot()
            }
        }));
    }

    function key(r, c) { return `${r},${c}`; }

    function inBounds(r, c) {
        return r >= 1 && r <= LEVEL.rows && c >= 1 && c <= LEVEL.cols;
    }

    function isDock(r, c) {
        return r === LEVEL.dock.r && c === LEVEL.dock.c;
    }

    function isObstacle(r, c) {
        return LEVEL.obstacles.has(key(r, c));
    }

    function initialStateForMode(mode) {
        if (mode === "map2") {
            // Start at the dock for cleaning assignment
            return { r: LEVEL.dock.r, c: LEVEL.dock.c, dir: "E" };
        }
        // map1 + map3 start at normal start
        return { r: LEVEL.vacuumStart.r, c: LEVEL.vacuumStart.c, dir: LEVEL.vacuumStart.dir };
    }
    function getInitialState() { return initialStateForMode(currentMode()); }

    // ====== Directions ======
    const DIRS = ["N", "E", "S", "W"];
    const ARROW = { N: "▲", E: "▶", S: "▼", W: "◀" };

    function dirLeft(d) { return DIRS[(DIRS.indexOf(d) + 3) % 4]; }
    function dirRight(d) { return DIRS[(DIRS.indexOf(d) + 1) % 4]; }

    function forwardDelta(d) {
        if (d === "N") return { dr: -1, dc: 0 };
        if (d === "E") return { dr: 0, dc: 1 };
        if (d === "S") return { dr: 1, dc: 0 };
        return { dr: 0, dc: -1 };
    }

    // ====== Line for map3 ======
    const LINE = new Set([
        // Top run
        key(1, 1), key(1, 2), key(1, 3), key(1, 4), key(1, 5),
        key(1, 6), key(1, 7), key(1, 8), key(1, 9), key(1, 10),

        // Down on the right side
        key(2, 10), key(3, 10), key(4, 10), key(5, 10), key(6, 10),

        // Detour left
        key(6, 9), key(6, 8),

        // Down a bit
        key(7, 8), key(8, 8),

        // Back right
        key(8, 9), key(8, 10),

        // Continue down
        key(9, 10), key(10, 10), key(11, 10),

        // Another detour left
        key(11, 9), key(11, 8), key(12, 8),

        // Down
        key(12, 7), key(13, 7),

        // Move right toward dock lane
        key(13, 8), key(13, 9), key(13, 10),

        // Final descent
        key(14, 10), key(15, 10),

        // Into dock
        key(15, 11), key(15, 12)
    ]);

    function isLineTile(r, c) {
        return LINE.has(key(r, c));
    }

    function isLineOrDock(r, c) {
        return isDock(r, c) || isLineTile(r, c);
    }

    // ====== Barrier / movement ======
    function isBarrierAhead(state) {
        const { dr, dc } = forwardDelta(state.dir);
        const nr = state.r + dr;
        const nc = state.c + dc;
        if (!inBounds(nr, nc)) return true;
        if (isObstacle(nr, nc)) return true;
        return false;
    }

    function moveForwardOrThrow(state) {
        if (isBarrierAhead(state)) {
            throw new Error("Barrier ahead: forward() would hit a wall or obstacle.");
        }
        const { dr, dc } = forwardDelta(state.dir);
        state.r += dr;
        state.c += dc;
    }

    // In map3, forward moves must land on line or dock
    function enforceMap3LineRuleAfterMove(state) {
        if (currentMode() !== "map3") return;
        if (isDock(state.r, state.c)) return;
        if (!isLineTile(state.r, state.c)) {
            throw new Error("Left the line: in Map 3, forward() must stay on the line to reach the dock.");
        }
    }

    // ====== Reachable tiles for map2 ======
    function computeReachableFrom(startR, startC) {
        const reachable = new Set();
        if (!inBounds(startR, startC) || isObstacle(startR, startC)) return reachable;

        const q = [{ r: startR, c: startC }];
        reachable.add(key(startR, startC));

        while (q.length) {
            const cur = q.shift();
            const neighbors = [
                { r: cur.r - 1, c: cur.c },
                { r: cur.r + 1, c: cur.c },
                { r: cur.r, c: cur.c - 1 },
                { r: cur.r, c: cur.c + 1 },
            ];

            for (const n of neighbors) {
                if (!inBounds(n.r, n.c)) continue;
                if (isObstacle(n.r, n.c)) continue;
                const k = key(n.r, n.c);
                if (reachable.has(k)) continue;
                reachable.add(k);
                q.push(n);
            }
        }
        return reachable;
    }
    function getReachableTiles() {
        const st = getInitialState();
        return computeReachableFrom(st.r, st.c);
    }

    function coverageInfo(visitedSet) {
        const reachableTiles = getReachableTiles();
        const total = reachableTiles.size || 1;
        const cleaned = visitedSet.size;
        const percent = Math.round((cleaned / total) * 100);
        return { cleaned, total, percent };
    }

    // ====== DOM ======
    const gridEl = document.getElementById("grid");
    const statusEl = document.getElementById("status");
    const runBtn = document.getElementById("runBtn");
    const resetBtn = document.getElementById("resetBtn");
    const stopBtn = document.getElementById("stopBtn");
    const codeBox = document.getElementById("codeBox");

    // ====== Runtime state ======
    function cloneState(s) { return { r: s.r, c: s.c, dir: s.dir }; }

    let liveState = cloneState(getInitialState());
    let visitedLive = new Set([key(liveState.r, liveState.c)]);

    let timer = null;
    let replayQueue = [];
    let replayIndex = 0;
    let pendingReplayErrorMessage = null; // error captured during recording, shown at failure point in replay

    // Replay metrics (especially useful for map3 line-following verification)
    let replayMetrics = null;

    function freshReplayMetrics() {
        const st = getInitialState();
        const mode = currentMode();
        const startsOnLine = isLineOrDock(st.r, st.c);

        return {
            mode,
            plannedCommands: 0,   // commands recorded before replay starts
            executedCommands: 0,  // commands actually executed during replay
            forwardCommands: 0,
            turnLeftCommands: 0,
            turnRightCommands: 0,

            // Map 3 line integrity metrics
            lineSteps: 0,       // forward moves that landed on line or dock
            offLineSteps: 0,    // forward moves that landed outside line (should be 0)
            everOnLine: startsOnLine,
            startedOnLine: startsOnLine,
            endedOnLine: startsOnLine,
            lineIntegrityOk: true
        };
    }

    function resetReplayMetrics() {
        replayMetrics = freshReplayMetrics();
    }

    function updateMetricsAfterCommand(cmd, stateAfter) {
        if (!replayMetrics) resetReplayMetrics();

        replayMetrics.executedCommands += 1;

        if (cmd === "turnLeft") {
            replayMetrics.turnLeftCommands += 1;
            return;
        }
        if (cmd === "turnRight") {
            replayMetrics.turnRightCommands += 1;
            return;
        }
        if (cmd !== "forward") return;

        replayMetrics.forwardCommands += 1;

        if (currentMode() === "map3") {
            const onLineNow = isLineOrDock(stateAfter.r, stateAfter.c);
            if (onLineNow) {
                replayMetrics.lineSteps += 1;
                replayMetrics.everOnLine = true;
            } else {
                replayMetrics.offLineSteps += 1;
                replayMetrics.lineIntegrityOk = false;
            }
            replayMetrics.endedOnLine = onLineNow;
        }
    }

    function getReplayMetricsSnapshot() {
        if (!replayMetrics) return null;
        return { ...replayMetrics };
    }

    function setStatus(msg) { statusEl.textContent = msg; }

    function setButtons(running) {
        runBtn.disabled = running;
        resetBtn.disabled = running;
        stopBtn.disabled = !running;
    }

    // ====== Rendering ======
    function injectStyles() {
        const id = "vacuum-extra-style";
        if (document.getElementById(id)) return;

        const style = document.createElement("style");
        style.id = id;
        style.textContent = `
      .cell.visited {
        background: rgba(34, 197, 94, 0.12);
        border-color: rgba(34, 197, 94, 0.22);
      }
      .cell.visited.dock {
        background: rgba(29, 78, 216, 0.28);
        border-color: rgba(59, 130, 246, 0.55);
      }
      .cell.line {
        background: rgba(245, 158, 11, 0.10);
        border-color: rgba(245, 158, 11, 0.25);
      }
      .cell.line::after{
        content: "";
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: rgba(245, 158, 11, 0.55);
        display: block;
      }
      .cell.obstacle::after{
        content: none;
      }
    `;
        document.head.appendChild(style);
    }

    function buildGrid() {
        gridEl.style.gridTemplateColumns = `repeat(${LEVEL.cols}, var(--cell))`;
        gridEl.style.gridTemplateRows = `repeat(${LEVEL.rows}, var(--cell))`;

        gridEl.innerHTML = "";
        for (let r = 1; r <= LEVEL.rows; r++) {
            for (let c = 1; c <= LEVEL.cols; c++) {
                const cell = document.createElement("div");
                cell.className = "cell";
                cell.dataset.r = String(r);
                cell.dataset.c = String(c);
                gridEl.appendChild(cell);
            }
        }
    }

    function render(state) {
        const cells = gridEl.querySelectorAll(".cell");

        for (const cell of cells) {
            const r = Number(cell.dataset.r);
            const c = Number(cell.dataset.c);
            const k = key(r, c);

            cell.className = "cell";
            cell.textContent = "";

            // Line tiles (Map 3 only)
            if (currentMode() === "map3" && !isObstacle(r, c) && isLineTile(r, c) && !isDock(r, c)) {
                cell.classList.add("line");
            }

            // Visited trail (all modes; not on obstacles)
            if (!isObstacle(r, c) && visitedLive.has(k)) {
                cell.classList.add("visited");
            }

            if (isObstacle(r, c)) {
                cell.classList.add("obstacle");
                cell.textContent = "■";
            }

            if (isDock(r, c)) {
                cell.classList.add("dock");
                if (!(state.r === r && state.c === c)) cell.textContent = "⚓";
            }

            if (state.r === r && state.c === c) {
                cell.innerHTML = "";
                const badge = document.createElement("span");
                badge.className = "vacBadge";
                badge.textContent = ARROW[state.dir];
                cell.appendChild(badge);
            }
        }
    }

    // ====== Default code per mode ======
    function setDefaultCodeIfEmpty() {
        if (!codeBox) return;
        if (codeBox.value.trim().length > 0) return;

        if (currentMode() === "map2") {
            codeBox.value =
                `// Map 2: Clean the whole room (all reachable tiles).
let safety = 0;

while (!vacuum.isAllCleaned() && safety++ < 200) {
  if (vacuum.isBarrierAhead()) vacuum.turnRight();
  else vacuum.forward();
}`;
            return;
        }

        if (currentMode() === "map3") {
            codeBox.value =
                `// Map 3: Follow the line back to the dock.
// Rule: forward() must stay on the yellow line (or dock).
let safety = 0;

while (!vacuum.isInDocking() && safety++ < 200) {
  if (vacuum.isLineAhead() && !vacuum.isVisitedAhead()) {
    vacuum.forward();
  } else {
    vacuum.turnRight();
  }
}`;
            return;
        }

        // map1
        codeBox.value =
            `// Map 1: Reach the dock (⚓).
let safety = 0;

while (!vacuum.isInDocking() && safety++ < 200) {
  if (vacuum.isBarrierAhead()) vacuum.turnRight();
  else vacuum.forward();
}`;
    }

    // ====== Recording mode ======
    function recordUserProgram() {
        if (!codeBox) throw new Error("Missing code box in HTML (textarea#codeBox).");

        const simulated = cloneState(getInitialState());
        const visitedSim = new Set([key(simulated.r, simulated.c)]);
        const commands = [];

        function push(cmd) {
            if (commands.length >= MAX_STEPS) {
                const err = new Error(`Program exceeded MAX_STEPS (${MAX_STEPS}). Possible infinite loop.`);
                err.recordedCommands = commands.slice();
                throw err;
            }
            commands.push(cmd);
        }

        function simCoverage() {
            const reachableTiles = getReachableTiles();
            const total = reachableTiles.size || 1;
            const cleaned = visitedSim.size;
            const percent = Math.round((cleaned / total) * 100);
            return { cleaned, total, percent };
        }

        const vacuum = {
            forward() {
                // Record FIRST so replay can show the exact failing step
                push("forward");

                moveForwardOrThrow(simulated);
                enforceMap3LineRuleAfterMove(simulated);
                visitedSim.add(key(simulated.r, simulated.c));
            },
            turnLeft() { simulated.dir = dirLeft(simulated.dir); push("turnLeft"); },
            turnRight() { simulated.dir = dirRight(simulated.dir); push("turnRight"); },
            isBarrierAhead() { return isBarrierAhead(simulated); },
            isInDocking() { return isDock(simulated.r, simulated.c); },

            // ---- Map 3 sensors (available only in map3) ----
            isOnLine() {
                if (currentMode() !== "map3") {
                    throw new Error("isOnLine() is only available in Game 3.");
                }
                return isLineOrDock(simulated.r, simulated.c);
            },
            isLineAhead() {
                if (currentMode() !== "map3") {
                    throw new Error("isLineAhead() is only available in Game 3.");
                }
                const { dr, dc } = forwardDelta(simulated.dir);
                const nr = simulated.r + dr, nc = simulated.c + dc;
                if (!inBounds(nr, nc) || isObstacle(nr, nc)) return false;
                return isLineOrDock(nr, nc);
            },
            isVisitedAhead() {
                if (currentMode() !== "map3") {
                    throw new Error("isVisitedAhead() is only available in Game 3.");
                }
                const { dr, dc } = forwardDelta(simulated.dir);
                const nr = simulated.r + dr, nc = simulated.c + dc;
                if (!inBounds(nr, nc) || isObstacle(nr, nc)) return false;
                return visitedSim.has(key(nr, nc));
            },

            // ---- Optional helpers (safe in all modes) ----
            cleanedCount() { return visitedSim.size; },
            totalReachable() { return getReachableTiles().size; },
            coveragePercent() { return simCoverage().percent; },
            isAllCleaned() {
                const reachableTiles = getReachableTiles();
                return visitedSim.size >= reachableTiles.size && reachableTiles.size > 0;
            }
        };

        let userSolutionFn;
        try {
            userSolutionFn = new Function("vacuum", codeBox.value);
        } catch (e) {
            throw new Error("Code syntax error: " + e.message);
        }

        try {
            userSolutionFn(vacuum);
        } catch (e) {
            const err = new Error("Runtime error: " + e.message);
            err.recordedCommands = commands.slice();
            throw err;
        }

        return { commands, recordingError: null };
    }

    // ====== Replay mode ======
    function applyCommand(state, cmd) {
        if (cmd === "turnLeft") {
            state.dir = dirLeft(state.dir);
            return;
        }
        if (cmd === "turnRight") {
            state.dir = dirRight(state.dir);
            return;
        }
        if (cmd === "forward") {
            moveForwardOrThrow(state);
            enforceMap3LineRuleAfterMove(state);
            visitedLive.add(key(state.r, state.c));
            return;
        }
        throw new Error(`Unknown command: ${cmd}`);
    }

    function stopReplay(reason) {
        if (timer) { clearInterval(timer); timer = null; }
        setButtons(false);
        if (reason) setStatus(reason);
    }

    function game3MetricsText() {
        if (!replayMetrics || currentMode() !== "map3") return "";
        return ` • Line steps: ${replayMetrics.lineSteps}, Off-line: ${replayMetrics.offLineSteps}`;
    }

    function runningStatus() {
        if (currentMode() === "map2") {
            const cov = coverageInfo(visitedLive);
            return `Replaying... step ${replayIndex}/${replayQueue.length} • Cleaned ${cov.cleaned}/${cov.total} (${cov.percent}%)`;
        }
        if (currentMode() === "map3") {
            return `Replaying... step ${replayIndex}/${replayQueue.length} • Follow the line to the dock${game3MetricsText()}`;
        }
        return `Replaying... step ${replayIndex}/${replayQueue.length}`;
    }

    function startReplay(commands, options = {}) {
        replayQueue = commands.slice();
        replayIndex = 0;
        pendingReplayErrorMessage = options.pendingErrorMessage || null;

        liveState = cloneState(getInitialState());
        visitedLive = new Set([key(liveState.r, liveState.c)]);
        resetReplayMetrics();
        replayMetrics.plannedCommands = replayQueue.length;

        render(liveState);
        setButtons(true);

        timer = setInterval(() => {
            try {
                if (replayIndex >= replayQueue.length) {
                    // If recording already captured an error, show it now (after replaying to the failing point)
                    if (pendingReplayErrorMessage) {
                        const msg = pendingReplayErrorMessage;
                        pendingReplayErrorMessage = null;
                        if (currentMode() === "map3" && replayMetrics) {
                            replayMetrics.lineIntegrityOk = replayMetrics.offLineSteps === 0;
                        }
                        stopReplay(`Stopped: ${msg}${currentMode() === "map3" && replayMetrics ? ` • Line ${replayMetrics.lineSteps}, Off-line ${replayMetrics.offLineSteps}` : ""}`);
                        return;
                    }

                    if (currentMode() === "map1") {
                        stopReplay(isDock(liveState.r, liveState.c) ? "Finished. Docked ✅" : "Finished (no more commands). Not docked yet.");
                        return;
                    }
                    if (currentMode() === "map2") {
                        const cov = coverageInfo(visitedLive);
                        stopReplay(
                            (() => { const reachableTiles = getReachableTiles(); return visitedLive.size >= reachableTiles.size && reachableTiles.size > 0; })()
                                ? `Finished. Cleaned all reachable tiles ✅ (${cov.cleaned}/${cov.total})`
                                : `Finished (no more commands). Not fully cleaned. • ${cov.cleaned}/${cov.total} (${cov.percent}%)`
                        );
                        return;
                    }
                    // map3
                    const suffix = replayMetrics
                        ? ` • Line integrity: ${replayMetrics.lineIntegrityOk ? "OK" : "FAILED"} (line ${replayMetrics.lineSteps}, off-line ${replayMetrics.offLineSteps})`
                        : "";
                    stopReplay(
                        (isDock(liveState.r, liveState.c) ? "Finished. Docked via line ✅" : "Finished (no more commands). Not docked yet.") + suffix
                    );
                    return;
                }

                const cmd = replayQueue[replayIndex++];
                applyCommand(liveState, cmd);
                updateMetricsAfterCommand(cmd, liveState);
                render(liveState);

                // Win checks
                if (currentMode() === "map1" || currentMode() === "map3") {
                    if (isDock(liveState.r, liveState.c)) {
                        if (currentMode() === "map3" && replayMetrics) {
                            replayMetrics.endedOnLine = isLineOrDock(liveState.r, liveState.c);
                            replayMetrics.lineIntegrityOk = replayMetrics.offLineSteps === 0;
                        }
                        emitFinish(true, "Docked");
                        if (currentMode() === "map3" && replayMetrics) {
                            stopReplay(`Docked ✅ in ${replayIndex} tick(s). • Line integrity: ${replayMetrics.lineIntegrityOk ? "OK" : "FAILED"} (line ${replayMetrics.lineSteps}, off-line ${replayMetrics.offLineSteps})`);
                        } else {
                            stopReplay(`Docked ✅ in ${replayIndex} tick(s).`);
                        }
                        return;
                    }
                } else if (currentMode() === "map2") {
                    if ((() => { const reachableTiles = getReachableTiles(); return visitedLive.size >= reachableTiles.size && reachableTiles.size > 0; })()) {
                        const cov = coverageInfo(visitedLive);
                        emitFinish(true, "Docked");
                        stopReplay(`Cleaned all reachable tiles ✅ in ${replayIndex} tick(s). • ${cov.cleaned}/${cov.total} (${cov.percent}%)`);
                        return;
                    }
                }

                setStatus(runningStatus());
            } catch (err) {
                // Show final position even when command fails after movement (e.g., map3 left line)
                render(liveState);

                if (currentMode() === "map3" && replayMetrics) {
                    // If state moved off line before throw, count that bad step now
                    const onLineNow = isLineOrDock(liveState.r, liveState.c);
                    if (!onLineNow) {
                        replayMetrics.offLineSteps += 1;
                        replayMetrics.lineIntegrityOk = false;
                        replayMetrics.endedOnLine = false;
                    }
                }

                stopReplay(`Stopped: ${err.message}${currentMode() === "map3" && replayMetrics ? ` • Line ${replayMetrics.lineSteps}, Off-line ${replayMetrics.offLineSteps}` : ""}`);
            }
        }, TICK_MS);
    }

    // ====== Controls ======
    function reset() {
        stopReplay();
        pendingReplayErrorMessage = null;
        liveState = cloneState(getInitialState());
        visitedLive = new Set([key(liveState.r, liveState.c)]);
        resetReplayMetrics();
        render(liveState);

        if (currentMode() === "map1") setStatus("Ready. Map 1: Reach the dock (⚓).");
        else if (currentMode() === "map2") {
            const cov = coverageInfo(visitedLive);
            setStatus(`Ready. Map 2: Clean the whole room • ${cov.cleaned}/${cov.total} (${cov.percent}%)`);
        } else setStatus("Ready. Map 3: Follow the line to the dock. • Line integrity will be checked.");

        setDefaultCodeIfEmpty();
    }

    function run() {
        stopReplay();
        pendingReplayErrorMessage = null;

        try {
            setStatus("Recording program...");
            const result = recordUserProgram(); // { commands, recordingError:null }
            setStatus(`Recorded ${result.commands.length} command(s). Replaying...`);
            startReplay(result.commands);
        } catch (err) {
            const recorded = Array.isArray(err.recordedCommands) ? err.recordedCommands : [];

            if (recorded.length > 0) {
                setStatus(`Recorded ${recorded.length} command(s) before error. Replaying to error point...`);
                startReplay(recorded, { pendingErrorMessage: err.message });
                return;
            }

            setButtons(false);
            setStatus(`Error: ${err.message}`);
            render(liveState);
        }
    }

    // ====== Boot ======
    injectStyles();
    buildGrid();
    reset();

    runBtn.addEventListener("click", run);
    resetBtn.addEventListener("click", reset);
    stopBtn.addEventListener("click", () => stopReplay("Stopped by user."));
})();