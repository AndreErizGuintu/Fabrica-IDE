# Fabrica — Flags & Deferred Notes

Running log of things worth remembering: flagged risks, decisions made, and stuff deferred on purpose. Add a line whenever something's worth not forgetting — doesn't need to be resolved right away.

---

## Open flags (not yet acted on)

- **[2026-08-05]** Scenario 3 hint quality investigated after a real manual test: Andre triggered the accept-to-hint flow end-to-end (Scenario 3 fired correctly, accepted, real AI call fired, `aiCallCount` incremented correctly) on a trivial 3-line Dart Hello World file with no errors and no run output. The response came back generic ("You can use the `dart` command in your terminal...") rather than a targeted nudge.

  **Investigated `requestHint()` (`src/main/adaptiveEngine.ts:353-359`) to understand why — two findings, neither fixed yet:**
  1. **Prompt/code mismatch:** the prompt text claims "Here is the code around their cursor" but actually sends the ENTIRE active tab's buffer content verbatim — traced the real call chain (`AdaptiveToast.tsx` → `EditorLayout.tsx`'s `currentCode={activeTab?.content ?? ''}` → `adaptive:hint` IPC → `requestHint()`, no transformation anywhere in between). Not broken/crashing, just the wording doesn't match reality.
  2. **No error/run-output signal is ever passed into the hint call** — only full file content + detected language (`getLanguage(activeTab.filename)`). Since Scenario 3 fires specifically on SILENT struggle (no calls, no runs), there's often genuinely no error output to draw on yet by the time it fires — this may be a structural limitation of this specific signal, not simply a wiring gap. Flagging both possibilities rather than assuming it's cheaply fixable by wiring in more context sources.

  **Explicitly NOT fixed this session**, per the 2026-07-29 standing rule (new idea → logged-deferred by default, not additive mid-sprint). Candidate fixes for the Aug 13-29 full-build window: (a) correct the prompt wording to match actual behavior (whole-file, not cursor-scoped), (b) actually scope sent code to cursor-adjacent lines instead of whole file, to match the prompt's own claim, (c) consider whether cheap syntax/lint-check output could be included as a context signal even without a full run, given Scenario 3's silent-struggle trigger often has no run/error output available.

- **[2026-07-25]** JSON stats writes aren't atomic — crash mid-write could corrupt a session file. Low risk for defense demo. Fix later: write `.tmp` then rename. — deferred, low priority
- **[2026-07-08]** `EditorLayout.tsx` state sprawl is a maintainability smell, not a demo-day risk — except token-streaming re-renders in the chat UI. Scope that specific risk to the message-list component only, don't let it justify a bigger refactor before defense. **Update [2026-07-21]:** confirmed the AI panel's streaming state (`response` in `AIPanel.tsx`) is already scoped to the component itself, not touching `EditorLayout`'s shared state — the specific streaming re-render risk does not apply to the current AI panel. General state-sprawl smell still stands.
- **[ongoing]** `extraResources` wiring into electron-builder config intentionally deferred to last, after all four bundled runtimes (PHP/Node/.NET/Dart) are individually placed and tested. Don't wire early — easy to mask a missing-runtime bug with a working system-PATH fallback. **Update [2026-07-27]:** precondition now met — all four runtimes confirmed individually working (see Resolved). `extraResources` wiring can be picked up whenever, no longer blocked on testing.
- **[ongoing]** Multi-week trend graphs explicitly scoped OUT — insufficient real usage data before defense. Don't let this creep back into the Adaptive Assistance Engine build. **Reconfirmed [2026-07-19]** after being reconsidered — this is a data-availability constraint (no multi-week window exists before defense), not a dev-time constraint, so more time doesn't fix it.
- **[2026-07-19]** ~~React/Flutter panel mention — current build doesn't include them. Position as future work unless adviser/panel explicitly mandates otherwise.~~ **Updated:** Flutter mobile preview is confirmed required by adviser (since title defense) — no longer positioned as optional future work. Approach decided: Flutter Windows desktop build (native compile, no virtualization) as default preview, physical Android device via USB/ADB for Android-specific validation only. Android emulator/AVD/WHPX bundling explicitly descoped as of this date. **React support remains unconfirmed — still future work unless mandated.**
- **[2026-07-19]** Innovation feature working split (Andre's draft plan, not yet a confirmed adviser verdict): Adaptive Assistance Engine + Stats layer (idle timer, call counter, error type log, session comparison, session summary) = committed scope. Intent-aware behavioral verification = deferred / pending adviser, not built concurrently. The standing rule below (gated on adviser verdict) still formally applies — treat this as the working assumption, not a signed-off decision.
- **[2026-07-19]** Adviser feedback mentioned "complicated forms may cause trouble" — exact meaning not yet clarified (could mean: complex UI/settings screens, complex feature/methodology like Adaptive Engine mode-switching, or complex defense Q&A explanations). Affects how much UI/config surface to expose for the Adaptive Engine. Revisit before building mode-switching UI.
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

- **[2026-08-03]** Android run-target detection (new "Flutter Preview" → run-target selector work, untested by Andre) has a two-layer dependency chain, not just "adb.exe on PATH":
  (a) Flutter has no Android-detection logic of its own — `flutter devices --machine` shells out to `adb`, so it requires Android SDK + `adb.exe` reachable on PATH/`ANDROID_HOME`.
  (b) Separately, the physical device needs the correct OEM/Google USB driver installed at the Windows level — this is independent of `adb.exe` itself being present.
  Per the 07-19 descoping of Android SDK/emulator bundling from the installer, this means the ADB target realistically only activates on dev machines that already have Android Studio's SDK set up — **not guaranteed on a defense-panel laptop.** Windows desktop target has no such dependency and stays the safe default selection.

- **[2026-08-03]** USB-connection secondary signal implemented via polling `Get-PnpDevice` (PowerShell, through `child_process.execFile`) every ~3s in `main.ts`, diffed against the previous device-id set — **not** a native module. Chosen specifically to avoid the node-gyp/VS2022 rebuild-pain class documented in the standing rule below (same issue that hit `node-pty`); `usb-detection` (native) was considered and rejected on that basis. Tradeoffs, not yet validated by Andre: ~3s detection latency, Windows-only (no-ops on other platforms), and it's a raw USB-device diff (not filtered to Android/ADB-class devices specifically) — a non-Android USB device plugging in will also flip the "device connected, not debug-ready" UI state until the next `flutter devices` refresh confirms/denies it. Best-effort by design per the task spec; not blocking if it proves too fragile in real use.

- **[2026-08-04]** First confirmed real-world instance of the `special_eos_id is not in special_eog_ids` gap (previously logged 2026-07-30 as a theoretical risk to monitor, not yet observed). Explain mode on a simple HTML file entered a non-terminating loop, repeating near-identical paragraphs verbatim instead of stopping cleanly — consistent with the model's actual end-of-generation signal not being caught by llama.cpp's auto-built default EOG list, per the known metadata gap in both TheBloke's and QuantFactory's GGUF conversions. Explain mode's long single-shot generation (no turn-taking to naturally bound length, unlike Ask/Plan's chat format) is the most likely mode to expose this first, matching the original 07-30 prediction. Not yet fixed — options on the table, undecided: (a) UI-level max-token cap or hard-stop control on Explain generations specifically (cheap, sidesteps root cause), (b) explicit `stopStrings`/EOG override in the node-llama-cpp generation call in `llm.ts` matching DeepSeek Coder's real chat-template EOT token (`<|EOT|>`) rather than relying on incomplete GGUF metadata (real fix, touches generation code), (c) defer entirely, since this was already a known-monitored risk, not a new regression. Decision on which path pending — depends on whether Explain mode is in scope for Aug 7-11 user testing.

- **[2026-08-04]** Benign-looking `sandboxed_renderer.bundle.js` `TypeError` (`"object null is not iterable (cannot read property Symbol(Symbol.iterator))"`) appears in the console on every dev-mode app start, including cold start — confirmed unrelated to the GPU-isolation fix (see Resolved), since it predates that fix and appears identically before and after. App confirmed working normally despite it. Alongside recurring benign `Autofill.enable`/`Autofill.setAddresses` DevTools-protocol warnings (known Electron/DevTools noise, not app-specific). Not investigated further — deferred, not blocking, revisit only if it starts correlating with an actual functional break.

## Resolved / decided

- **[2026-08-04]** Extended the existing throwaway Stats Debug panel (`StatsDebugPanel.tsx`) with a new "Adaptive Engine" section, purely observational — no trigger logic, thresholds, or firing behavior touched. Added `getDebugState()` to `adaptiveEngine.ts`: a read-only snapshot (per-scenario raw condition booleans computed independently of priority/suppression, window/cooldown countdowns, last-fired suggestion, priority winner) that does not mutate engine state — deliberately avoids calling the existing `pruneOlderThan()`/`evaluate()` mutating helpers, using a local non-mutating filter instead, so pulling debug info can never itself change what fires. New additive-only `lastFiredSuggestion` field on engine state (set in `tryFire()`, read-only elsewhere) tracks the last suggestion across dismiss, since `suggestionActive` alone gets cleared on dismiss and would otherwise lose that history. Wired end-to-end: `adaptive:getDebugState` IPC handler in `main.ts`, `getDebugState()` on the `window.adaptive` bridge in `preload.ts`/`preload.d.ts`, new panel section polls it on the same 1s interval the panel already uses for session/aggregate data.

- **[2026-08-04]** Bug found during Andre's first manual test pass of the Adaptive Engine: fired 3 AI calls roughly 30 seconds apart, with idle gaps (above the 15s threshold) before/between each — Scenario 3's ("silent struggle") toast fired despite the intervening calls, which should have broken its condition.

  **Investigated in `adaptiveEngine.ts` before fixing, since the initial hypothesis (that `onAiCall()`/`onRun()` weren't clearing the `consecutiveIdleResets` counter) turned out to be wrong on inspection** — both already zero the counter unconditionally (`onAiCall()` line ~141, `onRun()` line ~151), so that specific code was already correct and wasn't the bug.

  **Real gap found:** `evaluate()`'s Scenario 3 branch checked `consecutiveIdleResets >= threshold` and called `tryFire(3)`, but never reset the counter back to 0 at the moment it actually fires. A call/run resets the streak to 0 correctly, but if crossed once earlier in a session (e.g. natural idle/resume cycling while exploring the UI, well before Andre's deliberate 3-call test), the counter stays parked at/above the threshold. From there, a single post-call idle→resume cycle re-crosses the threshold immediately — not a fresh streak of 5 — making it look like "the calls didn't matter" when really the streak was never cleared at the point it last fired.

  **Fix:** `evaluate()` now zeroes `state.consecutiveIdleResets` right before `tryFire(3)`, so each firing requires a genuinely fresh streak of idle-resumes with no call/run in between, same as intended. Added explanatory comments at all three reset points (`onAiCall()`, `onRun()`, and the new fire-time reset). Scenario 1, 2, and 4 logic untouched.

- **[2026-07-20]** Backend swapped Ollama → node-llama-cpp. No longer bundling Ollama binary in the installer.
- **[2026-07-20/21]** Offline installer runtime resolution: `main.ts` checks `resources/runtimes/<lang>/<exe>` and `resources/models/<gguf>`, branching on `app.isPackaged` (packaged → `process.resourcesPath`, dev → `app.getAppPath()`). Falls back to system PATH with a `console.warn` if bundled binary's missing.
- **[2026-07-25]** CPU-only inference confirmed viable (llama.cpp/node-llama-cpp doesn't require GPU) — good line for the offline-first thesis: no discrete GPU hard requirement, broadens hardware compatibility for school lab PCs / budget laptops. Pending: real tok/s benchmark numbers from Andre's test script.
- **[2026-07-25]** Stats storage decided: `%APPDATA%/Fabrica/stats/projects/<project-hash>/session-*.json` per project, plus a root `aggregate.json` updated on each session write. Not project-folder-local — avoids any collision with the file explorer's dotfile-hiding logic entirely.
- **[2026-07-20/21]** ESM/CJS interop for `node-llama-cpp` resolved via a runtime dynamic import in `llm.ts` (`new Function('m','return import(m)')`), avoiding the `require()` crash caused by `ts-node`/webpack's CJS transpilation of the main process.
- **[2026-07-20/21]** Model file location: `resources/models/deepseek-coder-6.7b-instruct.Q4_K_M.gguf` — moved out of Hugging Face's global cache into the project structure (mirrors the `resources/runtimes/` pattern). Gitignored per the standing rule below.
- **[2026-07-21]** llama.cpp go/no-go checkpoint resolved early (ahead of the originally scheduled 2026-07-22 date) — swap confirmed viable end-to-end, staying on node-llama-cpp.
- **[2026-07-21]** `GPU_LAYERS` empirically tuned via a standalone sweep script (`scripts/test-gpu-layers.mjs`, layers 11–20 tested against the Q4_K_M model): clean (no VRAM fallback) up to **15**; 16+ triggers node-llama-cpp's automatic graceful degradation (KV cache/compute buffers spill to system RAM instead of crashing — a real resilience property, not a bug, worth citing in Ch3). Shipped default set to **`GPU_LAYERS=13`** (2-layer safety margin below the measured ceiling), overridable via env var for further tuning. **Superseded [2026-08-03]:** stale — `llm.ts:13-15` now defaults `GPU_LAYERS` to `'auto'` (only takes a fixed value if the `GPU_LAYERS` env var is explicitly set, which nothing in `package.json`/the repo currently does). This is a deliberate consequence of the 07-30 GPU-isolation fix: once `GGML_VK_VISIBLE_DEVICES` correctly scopes Vulkan to the single dedicated GPU, `"auto"`'s VRAM estimate is accurate, so hardcoding 13 stopped being necessary/desirable. The `[20, 13, 8, 4, 0]` step-down ladder (`llm.ts:20`) is confirmed still present and is now genuinely fallback-only: `buildLayerAttempts()` (`llm.ts:72-77`) starts from `GPU_LAYERS` (`'auto'` in the shipped default case) and only tries ladder values below it if loading or context-creation throws a VRAM-pattern error (`llm.ts:79-113`) — matches the 07-30 entry's description of it as "a true rarely-used safety net," not the primary path.
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

- **[2026-07-30]** Discovered (not yet separately verified): Flutter's hot reload (press 'r') / hot restart (press 'R') should work for free through the new terminal, since flutter run already listens for these keypresses on its own stdin, and the terminal now provides a genuine interactive pty session capable of forwarding keystrokes to the running process. No additional code needed if confirmed working — verify by typing 'r' into the terminal while flutter run is active and checking whether the Windows app window updates without a full restart ().

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

  - **[2026-07-31]** CLAUDE.md's AI panel description was stale — corrected via code check. Actual current shape is **Ask / Plan / Translate** (not "Ask/chat default, Translate/Explain secondary" as previously documented). Ask and Plan both use `renderChatThread`/streaming chat bubbles (`AIPanel.tsx:128-253`), fully wired with own messages, prompt, loading state, hooked to `ai:complete`. Explain mode does not exist yet — `AIPanel.tsx:7`'s `TabKey` type has no `'explain'` entry, no `ai:explain` IPC handler in `main.ts`. CLAUDE.md needs updating to match so future sessions don't work off the wrong panel shape.

- **[2026-07-31]** Two items previously logged as open, confirmed closed via direct code check (not just recap/memory): (1) Translate conversation-bleed bug — 07-28 fix confirmed actually in code, `llm.ts:143-164` creates a fresh `context`/`LlamaChatSession` per `generate()` call and disposes it in a `finally`, not a cached session. (2) Ollama→llama.cpp error handling — `ai:complete` is actively used (Ask + Plan both call it), and both `ai:complete` and `ai:translate` (`main.ts:632-667`) have try/catch returning `{success, error}`, surfaced in the renderer via `getCompletionErrorText()`. Both marking definitively resolved so they don't get accidentally re-opened or re-fixed.

- **[2026-08-04]** Adaptive Assistance Engine MVP built — 4 trigger-to-suggestion paths, reading off existing Stats layer counters only, no new signal types/model/prompt-content classification, per the Aug 3-6 MVP-first resequencing (07-29 entry).

  **Gap found before building:** the task brief (and by extension the 07-30 Stats-layer entry) assumed a run counter already existed alongside the idle timer and AI call counter — it didn't. `stats.ts` only tracked `idleTimeMs`/`aiCallCount`; `terminal:run` called `recordActivity()` but nothing incremented a run count anywhere. Added `runCount` to `stats.ts` (`SessionState`/`SessionFile`/`AggregateFile`/`getCurrentSession()`, plus `incrementRunCount()`) mirroring the existing `aiCallCount` pattern exactly — additive only, no changes to idle timer or call-counter behavior. Scenarios 2 and 4 both need this count, so it wasn't optional to defer.

  **Architecture:** new `src/main/adaptiveEngine.ts`, reading tunables from new `src/main/adaptiveEngine.config.json` (not hardcoded — Andre tunes post Aug 7-11 testing) rather than reaching into `stats.ts`'s internal 1s tick loop. It keeps its own idle timer (same reset-based approach as `stats.ts`, just driven off `idleThresholdSeconds` from config) and is fed by three hooks — `onEditorActivity()`, `onAiCall()`, `onRun()` — called from the exact same three call sites in `main.ts` that already call `recordActivity()`/`incrementAiCallCount()`/`incrementRunCount()`. No new signal sources.

  **Priority + suppression:** scenario 2 > 3 > 1 > 4 when multiple are true simultaneously (`evaluate()` checks in that order, returns on first fire). A single `suggestionActive` flag blocks any new suggestion while one is showing; `dismissSuggestion()` (called on explicit close or renderer-side auto-expiry) sets a `cooldownUntil` timestamp that blocks all scenarios, not just the one dismissed, for `cooldownMinutesAfterDismiss`.

  **Scenario 3 accept-to-hint flow:** toast never auto-fires an AI call — only `requestHint()` (new `adaptive:hint` IPC handler) does, and only on explicit accept. Uses a distinct short system prompt (no full-solution framing), `maxTokens: 80`, and a scoped `contextSize: 1024` — extended `generate()` in `llm.ts` with an optional 4th `options?: { maxTokens?: number; contextSize?: number }` param, non-breaking for the three existing callers (Ask/Translate/Explain, none of which pass it). Output guardrail: empty/fenced-code-block/>400-char responses fall back to a generic hint string rather than surfacing a raw model response. The hint call counts normally via `incrementAiCallCount()` since it's student-initiated, same call-counter path as every other AI call — no second counter, no second model.

  **UI:** new isolated `src/renderer/components/adaptive/AdaptiveToast.tsx`, mounted in `EditorLayout.tsx` the same one-line way `StatsDebugPanel` already is — doesn't touch any teammate-owned component file. Fixed-position corner toast, no modal/overlay, auto-dismisses after `autoDismissSeconds` (value travels with the suggestion payload from main so the renderer doesn't need its own copy of the config file).

  **Ch3 framing note (as requested):** of the 4 scenarios, only **Scenario 2** (rapid AI-call clustering with zero runs, i.e. help-seeking/over-reliance behavior) has direct literature backing behind the trigger logic itself. Scenarios 1, 3, and 4 (idle-then-call, silent-struggle-via-repeated-idle-resets, and session-wide call/run ratio) are proposed/testable heuristics built for this project, not adaptations of an established published trigger — frame them as such in Ch3, not as literature-validated.

  **Confirmed correct, not re-touched:** the `GPU_LAYERS` entry above (07-21, superseded 08-03) already reflects the current code — `llm.ts` defaults to `'auto'`, the `[20,13,8,4,0]` ladder is fallback-only. Checked directly against `llm.ts:13-20` while working in this file today; no further correction needed.

  **Not built (per spec):** Scenario 3's full-solution/prompt-content-classification version, any silent/non-accepted AI call, any second model — all explicitly deferred to Aug 13-29.

- **[2026-08-04]** Dev-mode GPU isolation relaunch-loop bug fixed. Root cause: `GGML_VK_VISIBLE_DEVICES` was only ever set via mid-process env mutation on the current process, so every electronmon-triggered restart (i.e. every file save in dev) lost the var, re-triggered `ensureGpuDeviceIsolation()`'s full probe → relaunch → `app.exit()` cycle, on every single save — not just once at cold start.

  **Fix:** new `scripts/resolve-gpu-isolation.mjs`, invoked from `npm start` before `start:renderer`, resolves the dedicated-GPU index once under plain Node (same throwaway-probe technique as `probeGpuDeviceNames()`, classification logic intentionally duplicated — not imported — from `gpuIsolation.ts` since that file pulls in `electron`, which doesn't resolve outside the Electron binary; both copies cross-reference each other via comments, flagged to keep in sync manually if the classification rule ever changes) and injects `GGML_VK_VISIBLE_DEVICES` into the env before spawning `start:renderer`, inherited automatically down the `start:renderer` → `webpack.config.renderer.dev.ts`'s internal `spawn` → `start:main` → electronmon → `electron.exe` chain (confirmed via trace — no intermediate spawn overrides env). `ensureGpuDeviceIsolation()`'s existing `if (process.env.GGML_VK_VISIBLE_DEVICES)` guard now catches the pre-set var immediately in dev, so the probe/relaunch path is never re-entered on hot reload — packaged builds are unaffected, still take the original probe+relaunch path once at cold start. Failure-safe by design: any probe failure in the new script degrades to `{}` (starts exactly like before the fix, minus pre-set isolation), never blocks `npm start` from booting.

  **Confirmed via real console output:** `[gpu-isolation] GGML_VK_VISIBLE_DEVICES already set (0), skipping isolation probe` fires cleanly on cold start and on every subsequent file-save restart, no relaunch/exit-3221225477 lines; real-world confirmation via Task Manager showing GPU 99% / CPU 10% during an active Explain-mode generation.

  **Closed sub-question:** whether the relaunch-loop was leaving orphaned `electron.exe` processes behind (suspected after Ctrl+C didn't cleanly exit) was never directly confirmed one way or the other — moot now since the fix eliminates the repeated relaunches in dev entirely.

- **[2026-08-04]** Bug fix: Scenario 1 (idle→call) toast was firing correctly (confirmed via debug panel's "Last suggestion fired: Scenario 1") but displaying copy that read as Scenario 3's "stepping away" framing. Root cause was **not** an ID/payload mixup — `tryFire()` (`adaptiveEngine.ts:66-74`) correctly keys `message: COPY[scenario]`, and `AdaptiveToast.tsx` renders `suggestion.message` verbatim with no scenario-specific fallback logic. `COPY[3]` already held its own distinct, correct text ("Looks like you might be stuck — want a hint?") — so there was no swap between the two entries. The actual bug: `COPY[1]` (`adaptiveEngine.ts:16`) was simply authored with silent-struggle/away-from-keyboard framing instead of idle-then-call framing, from the start. Fixed by rewriting `COPY[1]` to reflect the actual pattern (reaching for AI right after a pause, not "stepping away"). Copy/mapping-only change — no trigger logic, thresholds, or timing touched.

- **[2026-08-05]** GPU-probe timeout on first `npm start` after any restart/shutdown fixed. Diagnosed via `err.killed`/`err.signal`/`err.code` on the failed `execFile` call: `killed: true`, `signal: 'SIGTERM'`, `code: null` — a timeout-kill, not a crash. Pattern was 100% reproducible: first `npm start` after a restart times out, every subsequent run in the same session succeeds.

  **Root cause:** the pre-start GPU probe's original 15s `execFile` timeout was too tight for genuine first-run cold-start overhead in Vulkan device enumeration — not driver-state flakiness or a crash-prone relaunch as earlier framing assumed. Confirmed by the diagnostic, not just a hunch.

  **Fix:** raised the probe timeout from 15s → 40s in both duplicated copies (`src/main/gpuIsolation.ts`'s `PROBE_TIMEOUT_MS`, packaged-build cold-start path; `scripts/resolve-gpu-isolation.mjs`'s `PROBE_TIMEOUT_MS`, dev pre-launch path) — this is the primary fix. Added one retry in each as a secondary safety net only, in case an unusually slow first run still exceeds 40s.

  **No functional breakage at any point during the investigation** — the existing failure-safe fallback to `{}` (start without pre-set isolation, `gpuIsolation.ts`'s runtime relaunch path picks up the slack) worked correctly throughout. Just slower/noisier boots on the affected first-runs, nothing silently broken.

- **[2026-08-06]** Platform-scope/delimitation decision: offline-first, fully-bundled guarantee is scoped to **Windows desktop execution only** (Flutter Windows target, plus PHP/Node/C#/Dart script execution) — not Android device deployment, iOS, or web/browser.

  **Trigger:** investigated Flutter/ADB Android device detection failing on a second dev machine (no Android Studio ever installed there). Root cause confirmed via `flutter doctor -v`: "Unable to locate Android SDK" — Flutter's Android toolchain requires a pre-existing, separately-installed Android SDK on the host. Confirmed independent of Fabrica's own bundled runtimes (Node/PHP/.NET/Dart/Flutter-Windows/Git), which all remain self-contained and work with zero host dependency — this is specifically an Android-toolchain gap, not a regression in the bundling work.

  **Decision:** physical Android device deployment via ADB requires the host machine's own pre-existing Android SDK and is explicitly OUT of the offline-bundled guarantee — it remains a developer-convenience feature contingent on host machine setup (consistent with the 08-03 two-layer-dependency finding), not a validated capability of the distributed installer. iOS and web/browser targets were never implemented and are out of scope entirely.

  **Ch3 framing:** to be stated as a delimitation (platform scope: Windows desktop), not a limitation/gap — the architecture could support broader validation in future work, but this thesis validates Windows desktop specifically as the representative deployment context for Philippine school computer labs.

  **Considered and deferred:** bundling the Android SDK itself into the installer (to remove this host dependency entirely) was evaluated as theoretically possible but explicitly deferred — real size cost (est. 1-3GB+), unverified redistribution licensing, zero implementation/testing done. Belongs to the post-defense installer-scope conversation if pursued at all (same gate as the 07-29 Android-APK-toolchain idea), not current thesis scope.

## Standing rules (not flags, just don't forget)

- Never instruct Copilot agent to launch/run/build/self-test the app — burns credits. Agent writes code + reports changes; Andre runs/tests locally and pastes back real terminal output/screenshots.
- `resources/runtimes/` and `resources/models/` are gitignored — repopulate locally before any electron-builder packaging run.
- Innovation feature direction (Adaptive Assistance Engine vs. alternatives) is gated on adviser verdict — no building ahead of that call.
- Verify agent claims of success against real output (actual terminal text/generated output), not just a clean build or `get_errors` — caught multiple false positives this way this week (dev-mode `resourcesPath` bug, missing fallback logic, a UI status badge showing "completed" for a run that needs closer reading to interpret correctly).
- For isolated backend/library testing (GPU layer tuning, model benchmarking), prefer standalone Node scripts in `scripts/` over full Electron `npm start` cycles — much faster iteration, no rebuild/watch overhead. Do one final confirmation run inside the real app before trusting a number, since Electron's own process also competes for VRAM.
- Write multi-line files from PowerShell via here-string (`@'...'@ | Set-Content -Encoding utf8`) rather than editor copy-paste — copy-paste-into-Notepad-and-save has silently produced an empty file before.
- Native module rebuilds on this machine require: VS2022 Build Tools installed side-by-side with VS2026 (node-gyp doesn't recognize VS2026/"version 18" — confirmed upstream bug), with Windows 11 SDK + "MSVC v143 Spectre-mitigated libs (Latest)" added as individual components; a root package.json override `"node-abi": "^4.31.0"`; and `npm run rebuild` run under Node 22 LTS via nvm-windows rather than the machine's default Node 26.1.0. This entire chain needs to be repeated on any other machine (teammate's, or a fresh install) that needs to build node-pty or any future native module — consider documenting as a setup script or README section before defense, not just this log entry.
- Agent-assisted coding uses Claude Code (terminal/VS Code/desktop), not GitHub Copilot agent mode. Never instruct the agent to launch/run/build/self-test the app — burns credits/time. Agent prompts end at "write code + report what changed"; Andre runs/tests locally and pastes back real terminal output/screenshots.