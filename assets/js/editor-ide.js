/* editor-ide.js
   Monaco-based IDE-like editor for the Vacuum Grid Game.

   What it does:
   - Renders Monaco in #editor
   - Keeps hidden textarea #codeBox in sync (engine.js reads #codeBox)
   - Saves/restores code via localStorage (per map)
   - Provides vacuum-only autocomplete when typing `vacuum.`
   - Adds hover docs via type definitions
   - Shortcuts:
       Ctrl/Cmd + Enter => Run
       Ctrl/Cmd + R     => Reset
*/

(function () {
    // ---------- Config ----------
    const MONACO_VS_PATH = "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs";
    const REQUIRE_JS_URL = "https://cdnjs.cloudflare.com/ajax/libs/require.js/2.3.6/require.min.js";

    // Use mode to store separate code per assignment
    function getMode() {
        const m = (window.VACUUM_GAME_MODE || "map1").toLowerCase();
        if (m === "map2") return "map2";
        if (m === "map3") return "map3";
        return "map1";
    }

    // Default templates (optional; engine.js will also set one if codeBox empty,
    // but doing it here gives a better IDE feel)
    const DEFAULT_CODE = {
        map1:
            `// Map 1: Reach the dock (⚓).

`,
        map2:
            `// Map 2: Clean the whole room (visit all reachable tiles).
let safety = 0;

while (!vacuum.isAllCleaned() && safety++ < 800) {
  if (vacuum.isBarrierAhead()) vacuum.turnRight();
  else vacuum.forward();
}
`,
        map3:
            `// Map 3: Follow the line to the dock.

}
`
    };

    // Vacuum API for docs/autocomplete
    const VACUUM_METHODS = [
        ["forward", "Move 1 square forward (error if blocked)."],
        ["turnLeft", "Rotate 90° left."],
        ["turnRight", "Rotate 90° right."],
        ["isBarrierAhead", "True if the square in front is a wall or obstacle."],
        ["isInDocking", "True if the vacuum is on the docking station (⚓)."],

        // Map 2 helpers (hidden for this event — keep for future use)
        // ["cleanedCount", "How many reachable squares have been visited."],
        // ["totalReachable", "How many squares are reachable in this level."],
        // ["coveragePercent", "Visited percent (0–100)."],
        // ["isAllCleaned", "True if all reachable squares have been visited."],

        // Map 3 sensors
        ["isLineAhead", "True if the square ahead has the line (or is the dock)."],
        ["isOnLine", "True if currently on the line (or on the dock)."],
        ["isVisitedAhead", "True if the square ahead was already visited."]
    ];

    // ---------- Helpers ----------
    function $(id) { return document.getElementById(id); }

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = src;
            s.async = true;
            s.onload = resolve;
            s.onerror = () => reject(new Error("Failed to load script: " + src));
            document.head.appendChild(s);
        });
    }

    function ensureHiddenCodeBox() {
        // engine.js expects textarea#codeBox; if you already have it, great.
        // Otherwise create it and hide it.
        let codeBox = $("codeBox");
        if (!codeBox) {
            codeBox = document.createElement("textarea");
            codeBox.id = "codeBox";
            codeBox.spellcheck = false;
            codeBox.style.display = "none";
            document.body.appendChild(codeBox);
        } else {
            codeBox.style.display = "none";
        }
        return codeBox;
    }

    function storageKeyForMode(mode) {
        return `vacuum_code_${mode}`;
    }

    function getInitialCode(mode) {
        const saved = localStorage.getItem(storageKeyForMode(mode));
        if (saved && saved.trim().length > 0) return saved;
        return DEFAULT_CODE[mode] || "// Write your solution here!\n";
    }

    function injectEditorFrameIfMissing() {
        // Monaco needs a container div. If you already have <div id="editor">, fine.
        let editorEl = $("editor");
        if (!editorEl) {
            editorEl = document.createElement("div");
            editorEl.id = "editor";
            editorEl.style.height = "420px";
            editorEl.style.borderRadius = "12px";
            editorEl.style.border = "1px solid rgba(148,163,184,0.2)";
            editorEl.style.overflow = "hidden";
            // Try to place it near the textarea if present, else append
            const rightPanel = document.querySelector(".rightPanel") || document.body;
            rightPanel.appendChild(editorEl);
        }
        return editorEl;
    }

    function configureMonaco(monaco) {
        // Keep normal JS language features but reduce noise in suggestions.
        monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
            allowNonTsExtensions: true,
            checkJs: true,
            target: monaco.languages.typescript.ScriptTarget.ES2020
        });

        // Provide vacuum typing info (hover docs + better inference)
        const dts = `
      declare const vacuum: {
        forward(): void;
        turnLeft(): void;
        turnRight(): void;
        isBarrierAhead(): boolean;
        isInDocking(): boolean;

        cleanedCount(): number;
        totalReachable(): number;
        coveragePercent(): number;
        isAllCleaned(): boolean;

        isLineAhead(): boolean;
        isOnLine(): boolean;
      };
    `;
        monaco.languages.typescript.javascriptDefaults.addExtraLib(dts, "ts:vacuum-api.d.ts");

        // Vacuum-only autocomplete when typing `vacuum.`
        monaco.languages.registerCompletionItemProvider("javascript", {
            triggerCharacters: ["."],
            provideCompletionItems(model, position) {
                const line = model.getLineContent(position.lineNumber);
                const beforeCursor = line.slice(0, position.column - 1);

                // Only trigger on vacuum.
                if (!/vacuum\.\s*$/.test(beforeCursor)) return { suggestions: [] };

                const suggestions = VACUUM_METHODS.map(([name, desc]) => ({
                    label: name,
                    kind: monaco.languages.CompletionItemKind.Method,
                    insertText: name + "()",
                    documentation: desc,
                    range: new monaco.Range(
                        position.lineNumber,
                        position.column,
                        position.lineNumber,
                        position.column
                    )
                }));

                return { suggestions };
            }
        });
    }

    function addShortcuts(editor) {
        // Ctrl/Cmd + Enter => Run
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
            const btn = $("runBtn");
            if (btn && !btn.disabled) btn.click();
        });

        // Ctrl/Cmd + R => Reset (we override browser refresh inside editor only)
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyR, () => {
            const btn = $("resetBtn");
            if (btn && !btn.disabled) btn.click();
        });
    }

    function addEditorOptions(editor) {
        editor.updateOptions({
            fontSize: 13,
            tabSize: 2,
            insertSpaces: true,
            wordWrap: "on",
            smoothScrolling: true,
            cursorSmoothCaretAnimation: "on",

            // Reduce random suggestion spam; still get vacuum. suggestions
            quickSuggestions: false,
            wordBasedSuggestions: "off",
            suggestOnTriggerCharacters: true,
            acceptSuggestionOnEnter: "on",

            minimap: { enabled: false }
        });
    }

    // ---------- Main boot ----------
    async function boot() {
        const mode = getMode();

        const codeBox = ensureHiddenCodeBox();
        const editorHost = injectEditorFrameIfMissing();

        // Seed codeBox (engine reads this)
        codeBox.value = getInitialCode(mode);

        // Load require.js if missing
        if (!window.require) {
            await loadScript(REQUIRE_JS_URL);
        }

        // Configure Monaco loader
        window.require.config({ paths: { vs: MONACO_VS_PATH } });

        // Load Monaco
        window.require(["vs/editor/editor.main"], function () {
            // Monaco global exists as `monaco`
            if (!window.monaco) {
                console.error("Monaco did not load correctly.");
                return;
            }

            configureMonaco(window.monaco);

            const editor = window.monaco.editor.create(editorHost, {
                value: codeBox.value,
                language: "javascript",
                theme: "vs-dark",
                automaticLayout: true,
                lineNumbers: "on"
            });

            addEditorOptions(editor);
            addShortcuts(editor);

            // Sync Monaco -> codeBox + localStorage
            editor.onDidChangeModelContent(() => {
                const v = editor.getValue();
                codeBox.value = v;
                localStorage.setItem(storageKeyForMode(mode), v);
            });

            // Expose editor if you ever want to set markers / change value
            window.__vacuumEditor = editor;
        });
    }

    // Wait until DOM is ready
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})();
