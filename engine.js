"use strict";

/**
 * Vacuum Grid Game Engine
 * - Runs user program in "record mode" (builds a command list)
 * - Then replays commands at 0.1s per tick
 */

(function () {
    const TICK_MS = 100;          // 0.1 seconds per tick
    const MAX_STEPS = 1000;       // guard against infinite loops

    // ====== Level definition (room-like: 8 x 12) ======
    const LEVEL = {
        rows: 10,
        cols: 10,

        obstacles: new Set([
            // Vertical wall at col 6, rows 2..7, with a door at row 4
            "2,6", "3,6",        "5,6", "6,6", "7,6",

            // Horizontal wall at row 5, cols 3..10, with a door at col 8
            "5,3", "5,4", "5,5",        "5,7", "5,9",

            // Small "closet" block top-right (mostly blocked), with a door at (3,10)
            "2,9", "2,11",
            "3,9",         "3,11",

            // Some extra clutter near the bottom-left
            "6,4",
            "7,4", "7,5"
        ]),

        dock: { r: 10, c: 10 },
        vacuumStart: { r: 2, c: 2, dir: "E" } // N/E/S/W
    };

    // ====== Utilities ======
    const DIRS = ["N", "E", "S", "W"];
    const ARROW = { N: "▲", E: "▶", S: "▼", W: "◀" };

    function dirLeft(d) {
        return DIRS[(DIRS.indexOf(d) + 3) % 4];
    }
    function dirRight(d) {
        return DIRS[(DIRS.indexOf(d) + 1) % 4];
    }
    function forwardDelta(d) {
        if (d === "N") return { dr: -1, dc: 0 };
        if (d === "E") return { dr: 0, dc: 1 };
        if (d === "S") return { dr: 1, dc: 0 };
        return { dr: 0, dc: -1 }; // W
    }

    function key(r, c) {
        return `${r},${c}`;
    }

    function inBounds(r, c) {
        return r >= 1 && r <= LEVEL.rows && c >= 1 && c <= LEVEL.cols;
    }

    function isDock(r, c) {
        return r === LEVEL.dock.r && c === LEVEL.dock.c;
    }

    function isObstacle(r, c) {
        return LEVEL.obstacles.has(key(r, c));
    }

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

    // ====== DOM ======
    const gridEl = document.getElementById("grid");
    const statusEl = document.getElementById("status");
    const runBtn = document.getElementById("runBtn");
    const resetBtn = document.getElementById("resetBtn");
    const stopBtn = document.getElementById("stopBtn");
    const codeBox = document.getElementById("codeBox");

    // ====== Runtime state ======
    const initialState = {
        r: LEVEL.vacuumStart.r,
        c: LEVEL.vacuumStart.c,
        dir: LEVEL.vacuumStart.dir
    };

    let liveState = cloneState(initialState);
    let timer = null;
    let replayQueue = [];
    let replayIndex = 0;
    let isRunning = false;

    function cloneState(s) {
        return { r: s.r, c: s.c, dir: s.dir };
    }

    function setStatus(msg) {
        statusEl.textContent = msg;
    }

    function setButtons(running) {
        isRunning = running;
        runBtn.disabled = running;
        resetBtn.disabled = running;
        stopBtn.disabled = !running;
    }

    // ====== Rendering ======
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

            cell.className = "cell";
            cell.textContent = "";

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

    // ====== Editor default ======
    function setDefaultCodeIfEmpty() {
        if (!codeBox) return;
        if (codeBox.value.trim().length > 0) return;

        codeBox.value =
            `// Try this basic strategy first.
// Move forward when possible; otherwise turn right.
// Stop when docked.
let safety = 0;

while (!vacuum.isInDocking() && safety++ < 300) {
  if (vacuum.isBarrierAhead()) vacuum.turnRight();
  else vacuum.forward();
}`;
    }

    // ====== Recording mode (user program) ======
    function recordUserProgram() {
        if (!codeBox) {
            throw new Error("Missing code box in HTML (textarea#codeBox).");
        }

        const simulated = cloneState(initialState);
        const commands = [];

        function push(cmd) {
            if (commands.length >= MAX_STEPS) {
                throw new Error(`Program exceeded MAX_STEPS (${MAX_STEPS}). Possible infinite loop.`);
            }
            commands.push(cmd);
        }

        const vacuum = {
            forward() {
                moveForwardOrThrow(simulated);
                push("forward");
            },
            turnLeft() {
                simulated.dir = dirLeft(simulated.dir);
                push("turnLeft");
            },
            turnRight() {
                simulated.dir = dirRight(simulated.dir);
                push("turnRight");
            },
            isBarrierAhead() {
                return isBarrierAhead(simulated);
            },
            isInDocking() {
                return isDock(simulated.r, simulated.c);
            }
        };

        const userCode = codeBox.value;

        // Compile textarea content as: function(vacuum) { ...userCode... }
        let userSolutionFn;
        try {
            userSolutionFn = new Function("vacuum", userCode);
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

    // ====== Replay mode (animation) ======
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
            return;
        }
        throw new Error(`Unknown command: ${cmd}`);
    }

    function stopReplay(reason) {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
        setButtons(false);
        if (reason) setStatus(reason);
    }

    function startReplay(commands) {
        replayQueue = commands.slice();
        replayIndex = 0;

        liveState = cloneState(initialState);
        render(liveState);

        setButtons(true);

        timer = setInterval(() => {
            try {
                if (replayIndex >= replayQueue.length) {
                    if (isDock(liveState.r, liveState.c)) {
                        stopReplay("Finished. Docked ✅");
                    } else {
                        stopReplay("Finished (no more commands). Not docked yet.");
                    }
                    return;
                }

                const cmd = replayQueue[replayIndex++];
                applyCommand(liveState, cmd);
                render(liveState);

                if (isDock(liveState.r, liveState.c)) {
                    stopReplay(`Docked ✅ in ${replayIndex} tick(s).`);
                } else {
                    setStatus(`Replaying... step ${replayIndex}/${replayQueue.length}`);
                }
            } catch (err) {
                stopReplay(`Stopped: ${err.message}`);
            }
        }, TICK_MS);
    }

    // ====== Controls ======
    function reset() {
        stopReplay();
        liveState = cloneState(initialState);
        render(liveState);
        setStatus("Ready.");
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
    buildGrid();
    setDefaultCodeIfEmpty();
    reset();

    runBtn.addEventListener("click", run);
    resetBtn.addEventListener("click", reset);
    stopBtn.addEventListener("click", () => stopReplay("Stopped by user."));
})();
