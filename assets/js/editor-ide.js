/* editor-ide.js
   Monaco editor bootstrapping + starter code per game mode.
   Keeps a hidden <textarea id="codeBox"> in sync for engine.js.
*/

(function () {
    // IMPORTANT: use /min (not /min/vs) to avoid worker loading "/vs/vs/..."
    const MONACO_CDN = "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min";

    const codeBox = document.getElementById("codeBox");
    const editorEl = document.getElementById("editor");

    if (!codeBox || !editorEl) return;

    const STARTER = {
        map1:
            `// Map 1: Reach the dock (⚓).
let safety = 0;

while (!vacuum.isInDocking() && safety++ < 200) {
  if (vacuum.isBarrierAhead()) vacuum.turnRight();
  else vacuum.forward();
}
`,
        // Hidden for this event (keep for future use)
        map2:
            `// Map 2: Clean the whole room.
let safety = 0;

while (!vacuum.isAllCleaned() && safety++ < 800) {
  if (vacuum.isBarrierAhead()) vacuum.turnRight();
  else vacuum.forward();
}
`,
        map3:
            `// Map 3: Follow the line to the dock.
let safety = 0;

while (!vacuum.isInDocking() && safety++ < 200) {
  if (vacuum.isLineAhead() && !vacuum.isVisitedAhead()) {
    vacuum.forward();
  } else {
    vacuum.turnRight();
  }
}
`
    };

    function currentMode() {
        return (window.VACUUM_GAME_MODE || "map1").toLowerCase();
    }

    function storageKeyForMode(mode) {
        return `vacuum_code_${mode}`;
    }

    function getStarterForMode(mode) {
        return STARTER[mode] || STARTER.map1;
    }

    function loadInitialCode() {
        const mode = currentMode();
        const saved = localStorage.getItem(storageKeyForMode(mode));
        return saved ?? getStarterForMode(mode);
    }

    codeBox.value = loadInitialCode();

    function boot() {
        if (typeof window.require === "undefined") {
            const s = document.createElement("script");
            s.src = "https://cdnjs.cloudflare.com/ajax/libs/require.js/2.3.6/require.min.js";
            s.onload = initMonaco;
            document.head.appendChild(s);
        } else {
            initMonaco();
        }
    }

    function initMonaco() {
        // Monaco loader expects "vs" path here
        window.require.config({ paths: { vs: MONACO_CDN + "/vs" } });

        // Monaco workers for CDN
        window.MonacoEnvironment = {
            getWorkerUrl: function () {
                const proxy = `
self.MonacoEnvironment = { baseUrl: '${MONACO_CDN}/' };
importScripts('${MONACO_CDN}/vs/base/worker/workerMain.js');
`;
                return "data:text/javascript;charset=utf-8," + encodeURIComponent(proxy);
            }
        };

        window.require(["vs/editor/editor.main"], function () {
            monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
                target: monaco.languages.typescript.ScriptTarget.ES2020,
                allowNonTsExtensions: true,
                noLib: false
            });

            monaco.languages.typescript.javascriptDefaults.addExtraLib(
                `declare const vacuum: {
  forward(): void;
  turnLeft(): void;
  turnRight(): void;
  isBarrierAhead(): boolean;
  isInDocking(): boolean;

  // Map 2 helpers (hidden for event)
  cleanedCount(): number;
  totalReachable(): number;
  coveragePercent(): number;
  isAllCleaned(): boolean;

  // Map 3 helpers
  isLineAhead(): boolean;
  isOnLine(): boolean;
  isVisitedAhead(): boolean;
};`,
                "ts:vacuum-api.d.ts"
            );

            const editor = monaco.editor.create(editorEl, {
                value: codeBox.value || "",
                language: "javascript",
                theme: "vs-dark",
                automaticLayout: true,
                minimap: { enabled: false },
                fontSize: 14,
                tabSize: 2,
                insertSpaces: true,
                scrollBeyondLastLine: false,
                wordWrap: "on",
                roundedSelection: true
            });

            editor.onDidChangeModelContent(() => {
                const mode = currentMode();
                const v = editor.getValue();
                codeBox.value = v;
                localStorage.setItem(storageKeyForMode(mode), v);
            });

            // Support both names used in your app
            window.__vacuumEditor = editor;
            window.__VACUUM_EDITOR__ = editor;
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})();