# Validation and test results

## Passed

- All JavaScript files pass `node --check`.
- Every ES-module import in the physics/analyzer engine resolves successfully in the intended folder structure.
- `npm test` passes.
- Sea-level atmosphere anchor check passes.
- Atmosphere above 86 km enters the documented vacuum approximation.
- Propulsion sea-level and vacuum thrust-anchor checks pass.
- 200 km circular-orbit reference check passes (~7.788 km/s, ~5301 s period with the project's Earth constants).
- RK4 two-body energy-conservation check passes over 100 steps with drift far below 0.01%.
- Default two-stage Analyzer input prepares successfully and runs to stage completion.
- Result-adapter sampling works when the output stride is greater than 1.
- The mass chart now ends at the same final mass reported by the simulation after terminal stage separation.
- Local HTML/CSS/JS references resolve to existing files.
- Local HTTP requests for the homepage, Analyzer, CSS, JS, and physics modules return HTTP 200.
- All `physics/` files are byte-for-byte unchanged from the supplied versions.

## Environment limitation

The container's installed Chromium is blocked by an administrator policy from navigating to local HTTP/file URLs, so I could not perform a real browser click-through in that Chromium instance. The browser-facing DOM IDs/references were statically checked, while the complete input-adapter → simulation → result-adapter pipeline was executed directly under Node.

## Validation / limitations page checks

- `validation.html` and `limitations.html` are present at the deployment root.
- All JavaScript files, including `technical-pages.js`, pass `node --check`.
- Existing `npm test` smoke suite still passes after the documentation-page additions.
- A local HTML asset/link scan finds no missing relative `href` or `src` targets.
- Homepage and Analyzer navigation now resolve to both new pages.
- No file under `physics/` was modified while adding these pages.


## Phase 5 staging and mass-accounting validation

- `npm run validate:staging` passes 26/26 checks.
- Analytical example-vehicle mass ledger: 494,000 kg initial → 94,000 kg Stage 1 burnout → 69,000 kg after Stage 1 separation → 9,000 kg Stage 2 burnout → 5,000 kg final payload.
- Total usable propellant is 460,000 kg; total discarded dry/residual stage mass is 29,000 kg.
- Integrated event order is Stage 1 burnout → Stage 1 separation → Stage 2 burnout → Stage 2 separation.
- Stage 1 configured 2 s separation delay is reproduced to floating-point/event-time resolution; Stage 2 configured 0 s delay is reproduced exactly.
- A separate residual-propellant edge case verifies that residual propellant remains in burnout mass and is discarded with the stage.
- Final staging runtime marks all stages burned out and separated and terminates with `allStagesComplete`.
- No file under `physics/` was modified.

## Phase 6 Falcon 9 CRS-5 public-flight benchmark

- Benchmark is descriptive; no arbitrary vehicle-level pass/fail threshold is applied.
- Public NASA CRS-5 anchors used: supersonic at ~70 s; first-stage MECO at ~157 s; ~80 km altitude and ~Mach 10 at MECO.
- Proxy result at 157 s: 71.305329 km altitude (10.868338% difference) and Mach 6.065674 (39.343261% difference).
- Proxy Mach-1 crossing: 69.384774 s vs NASA ~70 s (0.878895% difference).
- The 39.34% MECO Mach discrepancy is treated as a substantial model-fidelity limitation, not a successful Falcon 9 validation.
- Sourced vehicle anchors are separated from explicit modeling assumptions such as aggregate propellant, assumed Isp, generic Cd, open-loop guidance, and constant throttle.
- No file under `physics/` was modified.

## Phase 7 validation webpage

- Replaced obsolete pending validation content with measured evidence from the atmosphere, orbit, RK4 energy, timestep convergence, staging, and Falcon 9 benchmark phases.
- Added reference provenance and explanations for why each benchmark/reference convention was chosen.
- Added tolerance rationale that explicitly distinguishes numerical/software acceptance thresholds from physical uncertainty.
- Added the full nine-point atmosphere matrix, 200 km orbit equations/conventions, RK4 conservation history, five-step convergence table, analytical staging mass ledger, and Falcon 9 per-metric error interpretation.
- Falcon 9 section prominently labels the 39.343261% MECO Mach difference as a major fidelity limitation and explains that exact causal percentages cannot be assigned from the available evidence.
- Added direct links to primary reference documents and links to each executable validation script.
- No file under `physics/` was modified.
