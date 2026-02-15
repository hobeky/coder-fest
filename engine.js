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
    const MAX_STEPS = 1000;

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
    const MODE = getMode();

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
    const initialState = initialStateForMode(MODE);

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
    // A simple line path from (1,1) -> (1,10) -> (15,10) -> (15,12 dock)
    // (avoids the bookcase at row 1 col 11-12).
    const LINE = new Set();
    (function buildLine() {
        // Row 1 from col 1..10
        for (let c = 1; c <= 10; c++) LINE.add(key(1, c));
        // Col 10 from row 1..15
        for (let r = 1; r <= 15; r++) LINE.add(key(r, 10));
        // Row 15 from col 10..12
        for (let c = 10; c <= 12; c++) LINE.add(key(15, c));
    })();

    function isLineTile(r, c) {
        return LINE.has(key(r, c));
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
        if (MODE !== "map3") return;
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
    const reachableTiles = computeReachableFrom(initialState.r, initialState.c);

    function coverageInfo(visitedSet) {
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

    let liveState = cloneState(initialState);
    let visitedLive = new Set([key(liveState.r, liveState.c)]);

    let timer = null;
    let replayQueue = [];
    let replayIndex = 0;

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
            if (MODE === "map3" && !isObstacle(r, c) && isLineTile(r, c) && !isDock(r, c)) {
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

        if (MODE === "map2") {
            codeBox.value =
                `// Map 2: Clean the whole room (all reachable tiles).
let safety = 0;

while (!vacuum.isAllCleaned() && safety++ < 800) {
  if (vacuum.isBarrierAhead()) vacuum.turnRight();
  else vacuum.forward();
}`;
            return;
        }

        if (MODE === "map3") {
            codeBox.value =
                `// Map 3: Follow the line back to the dock.
// Rule: forward() must stay on the yellow line (or dock).
let safety = 0;

while (!vacuum.isInDocking() && safety++ < 500) {
  if (vacuum.isLineAhead()) {
    vacuum.forward();
  } else {
    vacuum.turnRight(); // rotate until the line is ahead
  }
}`;
            return;
        }

        // map1
        codeBox.value =
            `// Map 1: Reach the dock (⚓).
let safety = 0;

while (!vacuum.isInDocking() && safety++ < 300) {
  if (vacuum.isBarrierAhead()) vacuum.turnRight();
  else vacuum.forward();
}`;
    }

    // ====== Recording mode ======
    function recordUserProgram() {
        if (!codeBox) throw new Error("Missing code box in HTML (textarea#codeBox).");

        const simulated = cloneState(initialState);
        const visitedSim = new Set([key(simulated.r, simulated.c)]);
        const commands = [];

        function push(cmd) {
            if (commands.length >= MAX_STEPS) {
                throw new Error(`Program exceeded MAX_STEPS (${MAX_STEPS}). Possible infinite loop.`);
            }
            commands.push(cmd);
        }

        function simCoverage() {
            const total = reachableTiles.size || 1;
            const cleaned = visitedSim.size;
            const percent = Math.round((cleaned / total) * 100);
            return { cleaned, total, percent };
        }

        const vacuum = {
            forward() {
                moveForwardOrThrow(simulated);
                enforceMap3LineRuleAfterMove(simulated);
                visitedSim.add(key(simulated.r, simulated.c));
                push("forward");
            },
            turnLeft() { simulated.dir = dirLeft(simulated.dir); push("turnLeft"); },
            turnRight() { simulated.dir = dirRight(simulated.dir); push("turnRight"); },
            isBarrierAhead() { return isBarrierAhead(simulated); },
            isInDocking() { return isDock(simulated.r, simulated.c); },

            // ---- Map 3 sensors ----
            isOnLine() { return isLineTile(simulated.r, simulated.c) || isDock(simulated.r, simulated.c); },
            isLineAhead() {
                const { dr, dc } = forwardDelta(simulated.dir);
                const nr = simulated.r + dr, nc = simulated.c + dc;
                if (!inBounds(nr, nc) || isObstacle(nr, nc)) return false;
                return isDock(nr, nc) || isLineTile(nr, nc);
            },

            // ---- Optional helpers (safe in all modes) ----
            cleanedCount() { return visitedSim.size; },
            totalReachable() { return reachableTiles.size; },
            coveragePercent() { return simCoverage().percent; },
            isAllCleaned() {
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
            throw new Error("Runtime error: " + e.message);
        }

        return commands;
    }

    // ====== Replay mode ======
    function applyCommand(state, cmd) {
        if (cmd === "turnLeft") { state.dir = dirLeft(state.dir); return; }
        if (cmd === "turnRight") { state.dir = dirRight(state.dir); return; }
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

    function runningStatus() {
        if (MODE === "map2") {
            const cov = coverageInfo(visitedLive);
            return `Replaying... step ${replayIndex}/${replayQueue.length} • Cleaned ${cov.cleaned}/${cov.total} (${cov.percent}%)`;
        }
        if (MODE === "map3") {
            return `Replaying... step ${replayIndex}/${replayQueue.length} • Follow the line to the dock`;
        }
        return `Replaying... step ${replayIndex}/${replayQueue.length}`;
    }

    function startReplay(commands) {
        replayQueue = commands.slice();
        replayIndex = 0;

        liveState = cloneState(initialState);
        visitedLive = new Set([key(liveState.r, liveState.c)]);
        render(liveState);
        setButtons(true);

        timer = setInterval(() => {
            try {
                if (replayIndex >= replayQueue.length) {
                    if (MODE === "map1") {
                        stopReplay(isDock(liveState.r, liveState.c) ? "Finished. Docked ✅" : "Finished (no more commands). Not docked yet.");
                        return;
                    }
                    if (MODE === "map2") {
                        const cov = coverageInfo(visitedLive);
                        stopReplay(
                            visitedLive.size >= reachableTiles.size && reachableTiles.size > 0
                                ? `Finished. Cleaned all reachable tiles ✅ (${cov.cleaned}/${cov.total})`
                                : `Finished (no more commands). Not fully cleaned. • ${cov.cleaned}/${cov.total} (${cov.percent}%)`
                        );
                        return;
                    }
                    // map3
                    stopReplay(isDock(liveState.r, liveState.c) ? "Finished. Docked via line ✅" : "Finished (no more commands). Not docked yet.");
                    return;
                }

                const cmd = replayQueue[replayIndex++];
                applyCommand(liveState, cmd);
                render(liveState);

                // Win checks
                if (MODE === "map1" || MODE === "map3") {
                    if (isDock(liveState.r, liveState.c)) {
                        stopReplay(`Docked ✅ in ${replayIndex} tick(s).`);
                        return;
                    }
                } else if (MODE === "map2") {
                    if (visitedLive.size >= reachableTiles.size && reachableTiles.size > 0) {
                        const cov = coverageInfo(visitedLive);
                        stopReplay(`Cleaned all reachable tiles ✅ in ${replayIndex} tick(s). • ${cov.cleaned}/${cov.total} (${cov.percent}%)`);
                        return;
                    }
                }

                setStatus(runningStatus());
            } catch (err) {
                stopReplay(`Stopped: ${err.message}`);
            }
        }, TICK_MS);
    }

    // ====== Controls ======
    function reset() {
        stopReplay();
        liveState = cloneState(initialState);
        visitedLive = new Set([key(liveState.r, liveState.c)]);
        render(liveState);

        if (MODE === "map1") setStatus("Ready. Map 1: Reach the dock (⚓).");
        else if (MODE === "map2") {
            const cov = coverageInfo(visitedLive);
            setStatus(`Ready. Map 2: Clean the whole room • ${cov.cleaned}/${cov.total} (${cov.percent}%)`);
        } else setStatus("Ready. Map 3: Follow the line to the dock.");
    }

    function run() {
        stopReplay();
        try {
            setStatus("Recording program...");
            const commands = recordUserProgram();
            setStatus(`Recorded ${commands.length} command(s). Replaying...`);
            startReplay(commands);
        } catch (err) {
            setButtons(false);
            setStatus(`Error: ${err.message}`);
            render(liveState);
        }
    }

    // ====== Boot ======
    injectStyles();
    buildGrid();
    setDefaultCodeIfEmpty();
    reset();

    runBtn.addEventListener("click", run);
    resetBtn.addEventListener("click", reset);
    stopBtn.addEventListener("click", () => stopReplay("Stopped by user."));
})();
