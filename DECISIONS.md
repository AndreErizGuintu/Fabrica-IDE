# Fabrica — Flags & Deferred Notes

Running log of things worth remembering: flagged risks, decisions made, and stuff deferred on purpose. Add a line whenever something's worth not forgetting — doesn't need to be resolved right away.

---

## Open flags (not yet acted on)

- **[2026-07-25]** JSON stats writes aren't atomic — crash mid-write could corrupt a session file. Low risk for defense demo. Fix later: write `.tmp` then rename. — deferred, low priority
- **[2026-07-08]** `EditorLayout.tsx` state sprawl is a maintainability smell, not a demo-day risk — except token-streaming re-renders in the chat UI. Scope that specific risk to the message-list component only, don't let it justify a bigger refactor before defense. **Update [2026-07-21]:** confirmed the AI panel's streaming state (`response` in `AIPanel.tsx`) is already scoped to the component itself, not touching `EditorLayout`'s shared state — the specific streaming re-render risk does not apply to the current AI panel. General state-sprawl smell still stands.
- **[ongoing]** `extraResources` wiring into electron-builder config intentionally deferred to last, after all four bundled runtimes (PHP/Node/.NET/Dart) are individually placed and tested. Don't wire early — easy to mask a missing-runtime bug with a working system-PATH fallback. **Update [2026-07-27]:** precondition now met — all four runtimes confirmed individually working (see Resolved). `extraResources` wiring can be picked up whenever, no longer blocked on testing.
- **[ongoing]** Multi-week trend graphs explicitly scoped OUT — insufficient real usage data before defense. Don't let this creep back into the Adaptive Assistance Engine build. **Reconfirmed [2026-07-19]** after being reconsidered — this is a data-availability constraint (no multi-week window exists before defense), not a dev-time constraint, so more time doesn't fix it.
- **[2026-07-19]** ~~React/Flutter panel mention — current build doesn't include them. Position as future work unless adviser/panel explicitly mandates otherwise.~~ **Updated:** Flutter mobile preview is confirmed required by adviser (since title defense) — no longer positioned as optional future work. Approach decided: Flutter Windows desktop build (native compile, no virtualization) as default preview, physical Android device via USB/ADB for Android-specific validation only. Android emulator/AVD/WHPX bundling explicitly descoped as of this date. **React support remains unconfirmed — still future work unless mandated.**
- **[2026-07-19]** Innovation feature working split (Andre's draft plan, not yet a confirmed adviser verdict): Adaptive Assistance Engine + Stats layer (idle timer, call counter, error type log, session comparison, session summary) = committed scope. Intent-aware behavioral verification = deferred / pending adviser, not built concurrently. The standing rule below (gated on adviser verdict) still formally applies — treat this as the working assumption, not a signed-off decision.
- **[2026-07-19]** Adviser feedback mentioned "complicated forms may cause trouble" — exact meaning not yet clarified (could mean: complex UI/settings screens, complex feature/methodology like Adaptive Engine mode-switching, or complex defense Q&A explanations). Affects how much UI/config surface to expose for the Adaptive Engine. Revisit before building mode-switching UI.
- **[2026-07-21]** GGUF tokenizer warning on `TheBloke/deepseek-coder-6.7B-instruct-GGUF` Q4_K_M: logs "GENERATION QUALITY WILL BE DEGRADED — CONSIDER REGENERATING THE MODEL" (missing pre-tokenizer metadata, FIM control tokens overridden). Output has looked coherent in testing so far — not blocking, but revisit (try `QuantFactory` or `godolike` re-converted GGUFs) if quality issues surface during real use.
- **[2026-07-24]** Flutter offline landmine (not yet confirmed executed): first `flutter run`/build typically triggers a network `precache` for engine artifacts. Must run `flutter precache --windows` once with internet before bundling `flutter/bin/cache/` into the USB installer, or the first offline run will fail. **Note [2026-07-27]:** Flutter Windows toolchain got fully set up and smoke-tested this session (see Resolved), but whether `precache --windows` was explicitly run beforehand vs. happened implicitly during `flutter run` is unconfirmed — verify before trusting the offline story, don't assume it's covered.
- **[2026-07-24]** .NET/C# offline landmine (untested): NuGet restore may require network even for a simple console app build, depending on project template/implicit references. Needs an explicit offline test (disconnect Wi-Fi, build the sample) before trusting `.NET` bundling is actually offline-safe. If it fails offline, fix is a local NuGet source pre-populated with needed packages.
- **[2026-07-24]** Frontend AI Assistant panel (floating window) has unstable resize and buggy drag — confirmed no drag/resize library (`react-rnd`, `re-resizable`, etc.) in `package.json`, likely a hand-rolled mouse-event implementation. Recommended swapping to `react-rnd` rather than debugging the custom version. Frontend teammate's lane (`components/`) — relay, don't fix directly.
- **[2026-07-24]** AI speed/quality follow-up, deliberately deferred to a later date: CPU thread count tuning, `Q3_K_M` quant speed/quality tradeoff test, re-benchmark after streaming lands (perceived vs. raw speed are now different things worth measuring separately).
- **[2026-07-27]** Runtime → run-command mapping (extension → `cmd`/`args`) is duplicated across at least 3 spots in `main.ts` (`getRunConfig()`, the inline Run-button switch, and `run:checkSDK`'s `cmds` record). Caused a real bug today: fixing C#'s invocation (`'script'` → `'run'`) in one spot didn't fix it everywhere, cost an extra debug round. Not urgent, but the next time any runtime's invocation needs a change, all 3 places need touching unless consolidated — `getRunConfig()` should become the single source of truth, other call sites should call it instead of re-declaring their own switch.
- **[2026-07-28]** ( FIXED )AI conversation-bleed bug found and being fixed: `llm.ts` was caching one `LlamaChatSession` for the whole app lifetime instead of per-request — confirmed via a Dart→JS translate response that leaked content from an earlier, unrelated PHP test still sitting in the model's live history. Also explains growing slowness over a session (reprocessing accumulated history each call). Fix in progress: keep model loading cached, make context/session fresh per `generate()` call (same pattern already used correctly in `scripts/benchmark.mjs`).
- **[2026-07-28]** Stretch idea, explicitly **not committed** — only if genuine spare time exists after Adaptive Engine + Stats + core AI Assist modes are done and tested, and only before defense if it doesn't threaten the "one defensible innovation" story: AI agentic file/folder creation (AI directly creates/modifies files in a student's project, not just returns text) + RAG. Needs its own constrained skill/instruction definition so a 6.7B local model doesn't take unsafe or unintended file-system actions — this is a meaningfully bigger trust boundary than text-only responses. Hard dependency: the request-scoped caching fix above needs to be solid first — no point building agentic tool-use on top of a context-bleed bug.
- **[2026-07-29]** Adviser gave Aug 12 as Ch3 checkpoint deadline (requires survey data) — forced a resequencing of the Aug 1-31 plan. Adaptive Engine split into two phases: **MVP** (idle timer + call counter, one trigger→suggestion path only, Aug 3-6) to unblock survey/testing by Aug 7-11, then **full scope** (error-pattern classification, session comparison, session summary) moved to Aug 13-29, after Ch3 checkpoint. Nothing permanently cut — sequencing fix, not scope cut. Full feature set still required by defense.
- **[2026-07-29]** New standing rule for mid-sprint feature ideas (prompted by scaffolding UI idea surfacing during Flutter week): any new idea gets one of three fates on the spot — (1) logged as deferred flag, zero code touched [default], (2) swapped in only if something else drops out [never additive], (3) genuinely blocking [rare, still checked against gate first]. Prevents good ideas from silently eating zero-buffer weeks.
- **[2026-07-29]** Project scaffolding wizard idea (per-language "Create New Project" flow, mockup made) — confirmed doesn't affect survey/Ch3, deferred to Aug 13-29 full-build window per the rule above. Flutter option in scaffold = Windows-preview flavor only, NOT mobile (mobile stays descoped per 07-19 decision) — don't let a "Flutter" scaffold option reopen that door.
- **[2026-07-29]** GitHub connect button in scaffolding UI is currently a placeholder (not wired). Git integration is confirmed to already exist somewhere in the system but needs to be located and surfaced/wired properly — scoped into Aug 13-29 alongside scaffolding.
- **[2026-07-29]** Defense date still unconfirmed — "probably first week of September," not locked by panel. Sept 1 vs Sept 7 materially changes how much slack exists in the Aug 13-29 full-build window and Aug 30-Sep 1 defense-prep block. Push adviser for exact date; don't plan the back half as if it's settled.
- **[2026-07-29]** Claude Pro (not higher-tier API/Code access) is what's powering daily coding sessions — daily usage limits are a real throughput constraint on the Aug 13-29 window, not just a calendar-days question. Worth tracking actual session output vs. planned scope as that window starts, and flagging early if the limit is consistently bottlenecking rather than assuming 17 calendar days = 17 dev-days.
- **[2026-07-29]** Bundling a full offline-compilable Android APK build (Android SDK/NDK/Gradle toolchain in the installer) surfaced as an idea — explicitly NOT committed, not this sprint. Current Flutter scope stays Windows desktop preview + physical device ADB fallback only (per 07-19 decision). Revisit post-Aug-12 only if genuinely spare time exists and it doesn't threaten the "one defensible innovation" story — same gate as the agentic-file-creation stretch idea.
- **[2026-07-30]** Multi-tab terminal (VS Code-style "+" for multiple terminal sessions) — explicitly deferred, not built this session. Backend already supports multiple concurrent pty sessions (ptySessions Map keyed by sessionId), so the harder infra piece exists; what's missing is renderer-side tab UI (tab bar, per-tab xterm instance, active-tab switching, "+" spawns a blank shell with no command queued). Natural fit for Aug 13-29 full-build window, not urgent for defense demo (one working terminal is sufficient to prove the point).

- **[2026-07-30]** Hot reload/hot restart via terminal keystrokes — flagged as "should work for free" but not yet explicitly tested and confirmed working (see Resolved entry above). Verify next session; if it doesn't work as expected, investigate whether pty input mode/buffering is interfering rather than assuming a new feature needs to be built.

- **[2026-07-21]** GGUF tokenizer warning on `TheBloke/deepseek-coder-6.7B-instruct-GGUF` Q4_K_M: logs "GENERATION QUALITY WILL BE DEGRADED — CONSIDER REGENERATING THE MODEL" (missing pre-tokenizer metadata, FIM control tokens overridden). **Update [2026-07-30]:** confirmed surfaced, not just theoretical — Ask mode response fabricated Text widget properties (color/fontSize/fontWeight) that didn't exist in the actual pasted code snippet, plausible symptom of degraded generation. Also newly noted: `special_eos_id is not in special_eog_ids` (stop-token config issue) — could independently cause rambling/non-stopping generation. Status bumped from "revisit later" to "investigate before relying on AI Assist for panel demo" — on buffer, deliberately not acted on yet. Fix path already identified: try re-converted GGUF from `QuantFactory` or `godolike` instead of `TheBloke`'s.

## Resolved / decided

- **[2026-07-20]** Backend swapped Ollama → node-llama-cpp. No longer bundling Ollama binary in the installer.
- **[2026-07-20/21]** Offline installer runtime resolution: `main.ts` checks `resources/runtimes/<lang>/<exe>` and `resources/models/<gguf>`, branching on `app.isPackaged` (packaged → `process.resourcesPath`, dev → `app.getAppPath()`). Falls back to system PATH with a `console.warn` if bundled binary's missing.
- **[2026-07-25]** CPU-only inference confirmed viable (llama.cpp/node-llama-cpp doesn't require GPU) — good line for the offline-first thesis: no discrete GPU hard requirement, broadens hardware compatibility for school lab PCs / budget laptops. Pending: real tok/s benchmark numbers from Andre's test script.
- **[2026-07-25]** Stats storage decided: `%APPDATA%/Fabrica/stats/projects/<project-hash>/session-*.json` per project, plus a root `aggregate.json` updated on each session write. Not project-folder-local — avoids any collision with the file explorer's dotfile-hiding logic entirely.
- **[2026-07-20/21]** ESM/CJS interop for `node-llama-cpp` resolved via a runtime dynamic import in `llm.ts` (`new Function('m','return import(m)')`), avoiding the `require()` crash caused by `ts-node`/webpack's CJS transpilation of the main process.
- **[2026-07-20/21]** Model file location: `resources/models/deepseek-coder-6.7b-instruct.Q4_K_M.gguf` — moved out of Hugging Face's global cache into the project structure (mirrors the `resources/runtimes/` pattern). Gitignored per the standing rule below.
- **[2026-07-21]** llama.cpp go/no-go checkpoint resolved early (ahead of the originally scheduled 2026-07-22 date) — swap confirmed viable end-to-end, staying on node-llama-cpp.
- **[2026-07-21]** `GPU_LAYERS` empirically tuned via a standalone sweep script (`scripts/test-gpu-layers.mjs`, layers 11–20 tested against the Q4_K_M model): clean (no VRAM fallback) up to **15**; 16+ triggers node-llama-cpp's automatic graceful degradation (KV cache/compute buffers spill to system RAM instead of crashing — a real resilience property, not a bug, worth citing in Ch3). Shipped default set to **`GPU_LAYERS=13`** (2-layer safety margin below the measured ceiling), overridable via env var for further tuning.
- **[2026-07-21]** AI Assist panel: Translate mode wired to the node-llama-cpp backend with streaming (`onTextChunk` → existing `ai:token` IPC channel, reusing the same channel the old Ollama path used — no renderer changes needed). Ollama's `ai:complete` handler kept intact but unused. Explain/Correct modes intentionally **not** built yet — stays scoped to 2026-07-27–31 per calendar, not pulled forward early.
- **[2026-07-24]** Bundled-runtime resolver verified working with a real bundled binary, not just fallback: tested via PHP — extracted the **full** portable zip (not just `php.exe`; DLLs and `ext/` folder are required alongside it) into `resources/runtimes/php/`. Confirmed via version mismatch (bundled `8.5.8 NTS/VC++2022` vs. system `8.2.12 ZTS/VC++2019`) and absence of the fallback `console.warn`.
- **[2026-07-27]** All four bundled runtimes confirmed working end-to-end (PHP, Node, .NET, Dart) — task closed. Node and PHP confirmed via version mismatch against system installs; Dart and .NET confirmed via clean execution with no system fallback available to confuse the result. Two real bugs found and fixed along the way, not just placement issues:
  - **Dart's SDK isn't flat** — `dart.exe` lives at `bin/dart.exe` within the SDK folder, not at the root like PHP/Node. `getBundledRuntimeBinary()` needed a Dart-specific `subDir` case to look one level deeper.
  - **C# execution was invoking the wrong `dotnet` subcommand** — code passed `args: ['script', filePath]`, but `dotnet-script` isn't a real built-in; correct invocation for .NET 10's single-file C# support is `args: ['run', filePath]`. Fixed in all call sites.
  - Also confirmed `.ts` files run correctly through plain `node script.ts` — no `ts-node`/transpiler step needed, since the bundled Node version (26.5.0) has native TypeScript type-stripping support built in.
- **[2026-07-24]** Dart/Flutter bundling split decided: `resources/runtimes/dart/` = standalone plain Dart SDK (small, root-level `dart.exe`, matches the existing resolver as-is, covers basic `.dart` file execution — this week's scope). `resources/runtimes/flutter/` = full Flutter SDK (bundles its own Dart internally; needed specifically for the Windows desktop preview) — kept as a **separate** folder rather than nesting one inside the other, to avoid resolver complexity. Scoped to next week's Flutter Windows preview work, not conflated with this week's language-runtime task.
- **[2026-07-27]** VS Build Tools setup for the Flutter Windows target — two real gotchas hit and fixed:
  - `--layout` only stages an offline copy of the installer; it does **not** install anything. The actual install is a separate `--noweb --add ...` command run from inside the layout folder. Easy to think it's done after `--layout` finishes — it isn't.
  - Initial component set (`Workload.VCTools` + `VC.Tools.x86.x64`) wasn't sufficient — `flutter doctor` flagged missing CMake tools and a Windows SDK. Needed a second `--layout` pass (re-run, can't `--noweb`-install something not already in the layout) adding `Microsoft.VisualStudio.Component.VC.CMake.Project` and `Microsoft.VisualStudio.Component.Windows11SDK.26100`. Note: `Windows10SDK.19041` (an older component ID) is **not recognized** in the current 2026 Build Tools catalog — `Windows11SDK.26100` is the confirmed-valid current one.
- **[2026-07-27]** Flutter SDK zip extraction hit Windows' "path too long" error (`0x80010135`) via File Explorer — caused by Flutter's own deeply-nested test/golden-image files combined with the already-long `resources/runtimes/flutter/` project path. Fixed via: enabling `LongPathsEnabled` in the registry (`HKLM\SYSTEM\CurrentControlSet\Control\FileSystem`, requires reboot) + extracting with 7-Zip instead of File Explorer's built-in extractor.
- **[2026-07-27]** Flutter Windows desktop toolchain fully confirmed working, standalone (outside Fabrica/outside the project folder): `flutter doctor` shows a clean checkmark on Visual Studio, and a real `flutter create` + `flutter run -d windows` smoke test produced an actual native Windows app window (default counter demo). Confirms Flutter SDK + VS Build Tools + Windows SDK are correctly wired together. **Fabrica integration itself is separate and not yet started** — see open flag on why it doesn't fit the existing runtime pattern.

- **[2026-07-30]** Integrated terminal + Run consolidation fully verified end-to-end: PHP, C#, Dart, Node, and Flutter all confirmed running through the new node-pty-backed terminal with real persistent shell prompts (cmd.exe spawned as pty root, resolved command written in as input rather than spawned directly — matches VS Code's terminal behavior). Stop button confirmed killing running processes correctly. getRunConfig() consolidation (07-29) is now the single verified path for all 5 languages.

- **[2026-07-30]** Terminal copy/paste added: Ctrl+C copies selected text (falls back to process interrupt only when nothing is selected — standard terminal convention), Ctrl+V pastes clipboard into the active pty session via the existing terminal:input channel.

- **[2026-07-30]** Fixed: NODE_OPTIONS env leak into spawned runtime processes. Root cause: dev-mode's launch chain (cross-env NODE_OPTIONS="-r ts-node/register ..." in start:renderer/start:main scripts) sets NODE_OPTIONS on the Electron main process itself; terminal:run's original `env: {...process.env}` spread passed it down to every spawned child, causing Dart (and potentially PHP/C#) runs to throw "Cannot find module 'ts-node/register'" — a Node-specific error on non-Node runtimes. Fixed by explicitly destructuring NODE_OPTIONS out of process.env before constructing spawn env. Confirmed no other Electron/dev-specific vars (e.g. ELECTRON_RUN_AS_NODE) are actually leaking, so nothing else was stripped.

- **[2026-07-30]** Terminal now spawns a persistent shell (cmd.exe) as the pty root process, then writes the resolved run command into it via pty.write(), instead of spawning the target command directly as the pty root. This is what enables a real "C:\path>" prompt before and after a run, and the ability to type further commands afterward (matches VS Code integrated terminal behavior) — this was the actual point of building an "integrated terminal" in the first place, not just a live-output panel.

- **[2026-07-30]** Discovered (not yet separately verified): Flutter's hot reload (press 'r') / hot restart (press 'R') should work for free through the new terminal, since flutter run already listens for these keypresses on its own stdin, and the terminal now provides a genuine interactive pty session capable of forwarding keystrokes to the running process. No additional code needed if confirmed working — verify by typing 'r' into the terminal while flutter run is active and checking whether the Windows app window updates without a full restart ()).

- **[2026-07-30]** Stats layer built and verified end-to-end (session tracking, idle timer, aggregate rollup). Storage matches 07-25 decision: `%APPDATA%/Fabrica/stats/projects/<hash>/session-*.json` + root `aggregate.json`, atomic `.tmp`→rename writes on both. Idle timer is reset-based (not a stopwatch): resets on Monaco's `onDidChangeModelContent` (same event driving the tab dirty-dot), AI call completion, or run command — accrues once 15s of true inactivity passes. No mouse/raw-keyboard tracking, scoped strictly to in-app events. AI call counter hooked into `ai:complete`/`ai:translate` completion (Ask/Translate covered; Explain not yet built, needs same hook when it lands — flag for later). Run counter hooked at top of `terminal:run`, covers all 5 languages + Flutter. Reactive layer (idle→suggestion trigger) intentionally NOT built — that's Adaptive Engine, starts Aug 3. Verified via new debug UI (see below) showing live session + aggregate + session history all populating correctly.

- **[2026-07-30]** Bug found + fixed: `app.getPath('userData')` was resolving to `%APPDATA%\electron-react-boilerplate\` instead of `%APPDATA%\Fabrica\`, because root `package.json` has no top-level `name`/`productName` — only `build.productName: "ElectronReact"` inside electron-builder config, which Electron's runtime doesn't read. Fixed by adding `app.setName('Fabrica')` in `main.ts` before any `app.getPath()` call. Same root cause was also silently affecting `recent-projects.json` (pre-existing, unrelated to Stats layer — just surfaced today because Stats was the first feature to depend on `userData` path). One-time side effect to expect: recent-projects list will appear empty after this fix since old data lives under the old folder name.

- **[2026-07-30]** Temporary Stats Debug UI added (`StatsDebugPanel.tsx` or similar, isolated new file + one button) — shows current in-memory session, aggregate.json totals, and session history for the active project. Explicitly throwaway/ugly-by-design, not product UI — remove or hide before defense if it doesn't fit the final build. Kept isolated from teammate's in-progress `screens/`/`components/` work by design.

- **[2026-07-30]** Workflow correction (should've been logged earlier): agent-assisted coding fully moved from GitHub Copilot agent mode to Claude Code (terminal/VS Code/desktop) — this was a standing-rule change, not a one-off, and DECISIONS.md wasn't updated at the time it happened. Also discovered this file itself wasn't actually present in the repo yet (`c:\Users\Andre\Documents\Capstone\Fabrica-IDE\DECISIONS.md` didn't exist on disk — only existed as an upload in the Claude Project). Added it to the repo today so `CLAUDE.md`'s "read DECISIONS.md before non-trivial work" rule actually has a file to find.

- **[2026-07-30]** Flutter Fabrica integration confirmed working end-to-end via the "Flutter Preview" button — launches `resources/runtimes/flutter/bin/flutter.bat run -d windows` through the integrated terminal, real Windows app window opens and runs correctly. Hot reload/restart confirmed working exactly as flagged earlier today — `flutter run` listens for `r`/`R` on its own stdin, terminal forwards keystrokes correctly, no extra code needed. "Lost connection to device" message on exit is Flutter's normal shutdown message when the app window is closed manually, not an error. Current UX: manual keypress into terminal required (click into terminal, type `r`) — no save-triggered auto-reload yet. Decision: manual-keypress reload is sufficient for defense demo; save-triggered hot reload (Ctrl+S → auto-send `r`) is a UX polish item, not required functionality — revisit only if spare time exists post-Ch3-checkpoint, same gate as other stretch ideas.

- **[2026-07-30]** GPU device isolation for hybrid-graphics laptops (RTX 3050 6GB + Intel 
  UHD 770) — root-caused and fixed end-to-end. 

  **Problem:** Vulkan's VRAM reporting pools BOTH devices (dedicated + iGPU shared 
  system RAM) into one combined figure (~13.7-14.7GB) instead of isolating the real 
  per-device VRAM (~6GB on the RTX 3050). This caused gpuLayers: "auto" to badly 
  overestimate available VRAM (resolved to all 33 layers), triggering repeated 
  ggml_vulkan ErrorOutOfDeviceMemory failures on context creation. Confirmed via 
  multiple failed approaches before landing on the real fix: gpuLayers: "auto" alone — 
  fails; gpuLayers: { fitContext: {...} } — fails (still resolves 33 layers off the 
  same bad estimate); GGML_VK_VISIBLE_DEVICES set via mid-process `process.env` 
  mutation inside Electron's main process — silently doesn't take effect (see below).

  **Real root cause (two layers deep):** (1) Vulkan enumeration pools hybrid GPU+iGPU 
  VRAM — a documented upstream issue class, not specific to this codebase (see 
  ollama/ollama#16667, withcatai/node-llama-cpp#413, ggml-org/llama.cpp#18946 for the 
  same failure pattern on other hybrid-GPU laptops). (2) Separately, and specific to 
  Electron: mutating `process.env.GGML_VK_VISIBLE_DEVICES` mid-process, even very early 
  in Electron's main-process lifetime, does NOT propagate to the native ggml-vulkan 
  addon's view of the environment before/during its Vulkan init. Confirmed via a 
  decisive test: setting the var via `cross-env`/shell BEFORE launching Electron (i.e. 
  present in the OS process environment block from process creation) works perfectly 
  on the first attempt — `getVramState()` correctly reports ~6GB, `"auto"` resolves 
  cleanly, zero retries needed. The exact same JS mutation technique worked fine under 
  plain `node.exe` in isolated test scripts — this limitation is specific to mutating 
  env vars inside an already-running Electron process, not general Node/Electron 
  behavior.

  **Fix implemented:** relaunch approach, in `src/main/gpuIsolation.ts`. At app 
  startup (before `createWindow()`), probe GPU devices fresh (via a throwaway child 
  process, to avoid prematurely locking in Vulkan device visibility in the main 
  process), classify dedicated vs. integrated by NAME PATTERN (not index — see 
  verified logic below), and if isolation is needed and `GGML_VK_VISIBLE_DEVICES` 
  isn't already set: set it, then `app.relaunch()` + `app.exit()`. The relaunched OS 
  process inherits the var from creation, so native Vulkan init sees it correctly from 
  the start. Single-GPU/no-GPU machines never trigger a relaunch (probe detects only 
  one device, no-op). Loop-guard: the "already set" check is the natural break — 
  confirmed logged explicitly so a failed guard would be visible, not silent.

  **Classification confirmed robust to enumeration-order instability:** Vulkan's 
  device enumeration ORDER is not guaranteed stable across runs/reboots (observed 
  directly: device index 0 was the RTX 3050 in one manual test, the Intel UHD 770 in 
  another). Verified the real classification logic (not the manual test scripts, which 
  DO blindly trust a hardcoded index and are NOT reliable for this reason) selects by 
  NAME only: `IGPU_NAME_PATTERN = /intel|uhd|iris|graphics/i` combined with 
  `DEDICATED_VENDOR_PATTERN = /nvidia|geforce|rtx|gtx|quadro|amd|radeon/i` — a device 
  is "integrated" only if it matches the iGPU pattern AND does NOT match the dedicated 
  vendor pattern. Walked through both possible enumeration orders explicitly: same GPU 
  selected by name either way, with the index written into the env var changing to 
  match wherever that name actually landed that run. No fixed/assumed index anywhere.

  **Safety net kept:** the step-down retry ladder (gpuLayers "auto" → stepped fixed 
  values → 0/CPU-only on repeated VRAM-pattern errors, with proper model/context 
  dispose() between attempts) stays in llm.ts as a fallback for any machine where even 
  an isolated device's real VRAM estimate still doesn't fit — now a true rarely-used 
  safety net rather than the thing silently doing all the work every launch.

  **Known classification edge cases (not yet hit, flagged for awareness, already 
  commented in code):** AMD iGPU+dGPU laptops — "AMD Radeon(TM) Graphics" (integrated) 
  contains a vendor word, so it isn't excluded by the current pattern, making 
  detection ambiguous (2 candidates) → isolation is correctly skipped rather than 
  guessing wrong, falls through to the retry ladder instead — safe, just not optimal. 
  Intel Arc DEDICATED GPUs would be wrongly excluded as an iGPU by the current "Intel" 
  substring match — unlikely on budget/mid-range student laptops, low priority.

  **Real-world result:** confirmed via actual AI panel use (Ask mode) — generation 
  felt noticeably faster post-fix, consistent with more layers now correctly landing 
  on real GPU memory instead of the retry ladder settling for a lower, scraped-by 
  layer count under the old pooled-VRAM misestimate.

  **Consolidation side-effect (built as a prerequisite for testing this cleanly):** 
  MODEL_FILE is now a single shared source of truth (src/main/modelConfig.json), read 
  by llm.ts, scripts/benchmark.mjs, and scripts/test-gpu-layers.mjs — fixes a 
  duplication pattern that would've silently undermined any future model swap 
  otherwise (same duplication class as the 07-27 runtime-mapping bug).

- **[2026-07-30]** GGUF tokenizer quality fix — swapped model source, confirmed via 
  metadata inspection AND a real practical test (supersedes/closes the 07-21/07-30 
  open flag on this topic).

  **What changed:** replaced TheBloke's deepseek-coder-6.7b-instruct.Q4_K_M.gguf with 
  QuantFactory's conversion of the same model/quant level (via modelConfig.json — the 
  MODEL_FILE consolidation from earlier tonight made this a one-line + one-file-drop 
  swap, as intended). Also test-downloaded the same quant via `ollama pull 
  deepseek-coder:6.7b-instruct-q4_K_M` and extracted its blob for comparison — 
  confirmed Ollama's version shares the SAME missing pre-tokenizer metadata as 
  TheBloke's (identical warnings at load), so Ollama isn't a shortcut around this 
  issue.

  **Proof, not just vibes:** ran `npx node-llama-cpp inspect gguf <file>` on both 
  TheBloke's and QuantFactory's files and diffed the actual metadata (not just console 
  warnings): TheBloke's file has NO `tokenizer.ggml.pre` field at all (confirms why 
  llama.cpp fell back to a generic default pre-tokenizer) and no `chat_template`. 
  QuantFactory's file has `tokenizer.ggml.pre: "deepseek-coder"` (the correct 
  model-specific value) plus a full `chat_template` (the official 
  `### Instruction:`/`### Response:`/`<|EOT|>` format) and explicit 
  `add_bos_token`/`add_eos_token` flags — none of which TheBloke's file had.

  **Load-time result:** the "GENERATION QUALITY WILL BE DEGRADED" banner and "missing 
  pre-tokenizer type" warning are GONE with QuantFactory's file — direct result of the 
  now-present `tokenizer.ggml.pre` field.

  **Real practical test (the one that actually matters):** pasted a Dart/Flutter 
  snippet with plain, unstyled `Text` widgets into Ask mode and asked it to describe 
  the code's properties exactly as-is (not "how do I change X", which the model had 
  previously and correctly treated as a request for example code, not description — 
  worth remembering as a prompt-phrasing distinction for future testing). Result: 
  correctly reported no additional properties were set on either Text widget, and 
  additionally caught that `itemCount` was referenced but never defined in the 
  snippet — no fabricated color/fontSize/fontWeight this time, a clean contrast to the 
  original bug report (fabricated Text widget styling that didn't exist in the pasted 
  code). One clean test isn't a lifetime guarantee — worth staying alert during normal 
  use over the coming days, not treating this as zero-risk forever.

  **STILL OPEN, not fixed by this swap — two of the three original warnings persist 
  in BOTH TheBloke's and QuantFactory's files:**
  - The three FIM control-token override warnings 
    (`<|fim▁hole|>`/`<|fim▁end|>`/`<|fim▁begin|>` "was not control-type") — neither 
    file's `token_type` metadata properly flags these as control tokens; llama.cpp 
    auto-corrects at load time rather than crashing, but the underlying metadata gap 
    is not resolved.
  - `special_eos_id is not in special_eog_ids` — neither file defines an explicit 
    end-of-generation token list separate from the single `eos_token_id` (32021); 
    llama.cpp's auto-built default eog list doesn't include it. Root cause and 
    severity impact still not fully understood — worth continued light monitoring 
    (e.g. if Explain mode or longer generations show rambling/non-terminating output 
    later, revisit this specifically as a suspect) rather than assumed harmless.

  This appears to be a limitation shared across the public conversions checked 
  (TheBloke, Ollama's library, QuantFactory) rather than something a re-conversion 
  alone fixes — may require a from-scratch re-conversion with corrected FIM/EOG 
  handling to fully resolve, which is out of scope for now given the practical symptom 
  is confirmed fixed.
  
## Standing rules (not flags, just don't forget)

- Never instruct Copilot agent to launch/run/build/self-test the app — burns credits. Agent writes code + reports changes; Andre runs/tests locally and pastes back real terminal output/screenshots.
- `resources/runtimes/` and `resources/models/` are gitignored — repopulate locally before any electron-builder packaging run.
- Innovation feature direction (Adaptive Assistance Engine vs. alternatives) is gated on adviser verdict — no building ahead of that call.
- Verify agent claims of success against real output (actual terminal text/generated output), not just a clean build or `get_errors` — caught multiple false positives this way this week (dev-mode `resourcesPath` bug, missing fallback logic, a UI status badge showing "completed" for a run that needs closer reading to interpret correctly).
- For isolated backend/library testing (GPU layer tuning, model benchmarking), prefer standalone Node scripts in `scripts/` over full Electron `npm start` cycles — much faster iteration, no rebuild/watch overhead. Do one final confirmation run inside the real app before trusting a number, since Electron's own process also competes for VRAM.
- Write multi-line files from PowerShell via here-string (`@'...'@ | Set-Content -Encoding utf8`) rather than editor copy-paste — copy-paste-into-Notepad-and-save has silently produced an empty file before.
- Native module rebuilds on this machine require: VS2022 Build Tools installed side-by-side with VS2026 (node-gyp doesn't recognize VS2026/"version 18" — confirmed upstream bug), with Windows 11 SDK + "MSVC v143 Spectre-mitigated libs (Latest)" added as individual components; a root package.json override `"node-abi": "^4.31.0"`; and `npm run rebuild` run under Node 22 LTS via nvm-windows rather than the machine's default Node 26.1.0. This entire chain needs to be repeated on any other machine (teammate's, or a fresh install) that needs to build node-pty or any future native module — consider documenting as a setup script or README section before defense, not just this log entry.
- Agent-assisted coding uses Claude Code (terminal/VS Code/desktop), not GitHub Copilot agent mode. Never instruct the agent to launch/run/build/self-test the app — burns credits/time. Agent prompts end at "write code + report what changed"; Andre runs/tests locally and pastes back real terminal output/screenshots.