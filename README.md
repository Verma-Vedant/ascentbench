# AscentBench

**Open-source educational launch-vehicle simulator for exploring ascent physics, staging, orbital mechanics, numerical integration, and model validation.**

AscentBench is a browser-based, transparent 2D launch-vehicle simulation and analysis project. Its goal is educational: make the assumptions, equations, numerical methods, validation evidence, and limitations of a launch simulation inspectable instead of hiding them behind a black box.

> **Educational use only.** AscentBench is not flight software, launch-day prediction software, operational guidance, or a substitute for professional aerospace analysis.

## Website

Production domain: **https://ascentbench.info**

## What AscentBench models

The current simulator includes:

- spherical-Earth inverse-square gravity
- a U.S. Standard Atmosphere 1976-style lower-atmosphere model through 86 km, followed by an explicit vacuum approximation
- simplified sea-level-to-vacuum propulsion performance
- Mach-dependent drag using an assumed generic drag-coefficient table
- open-loop 2D guidance
- classical fixed-step RK4 integration
- serial multi-stage mass and event bookkeeping
- planar two-body orbital-state analysis
- telemetry/result adaptation for the browser interface

The project intentionally exposes these assumptions and documents what is not modeled.

## Why this project exists

Launch-vehicle simulators can produce convincing plots while hiding important assumptions. AscentBench is built around the opposite idea: the physics modules, validation scripts, reference values, tolerances, raw terminal evidence, and known limitations should all be inspectable.

That means validation failures are kept visible. A disagreement with a real vehicle is treated as information about model fidelity, not something to hide behind a green badge.

## Validation status

| Validation | Result | Key evidence |
| --- | --- | --- |
| Atmosphere | PASS | 9 geometric-altitude cases from 0 to 86 km; maximum pressure error 0.013345% and density error 0.012264% against the independent reference table used by the validation harness |
| 200 km circular orbit | PASS | Circular speed 7.788487985 km/s; period 5301.004602 s; circular-orbit state reproduced to floating-point-level differences |
| RK4 energy conservation | PASS | Maximum specific-energy drift 1.473889940e-13% over 100 one-second RK4 steps; criterion 0.01% |
| Timestep convergence | PASS | Default dt=0.2 s vs dt=0.05 s; worst selected continuous-output difference 5.689672e-4% |
| Staging and mass accounting | PASS | 26/26 checks; 494,000 kg initial mass closes to 5,000 kg final payload with exact propellant/dry-mass bookkeeping |
| Falcon 9 CRS-5 benchmark | MODEL FIDELITY LIMITATION IDENTIFIED | Mach-1 timing differs by 0.878895%, MECO altitude by 10.868338%, and published MECO Mach by 39.343261% |

The Falcon 9 comparison is deliberately **not** presented as successful vehicle-level validation. The large MECO Mach disagreement shows that the current approximate vehicle model, generic guidance/aerodynamics, and mission-specific data are not sufficient to reproduce the real CRS-5 first-stage state accurately.

See [`validation.html`](validation.html) for the interpreted validation report and [`validation/`](validation/) for the executable validation scripts and raw evidence.

## Physics architecture

```text
physics/
├── constants.js
├── gravity.js
├── atmosphere.js
├── propulsion.js
├── aerodynamics.js
├── guidance.js
├── dynamics.js
├── integrator.js
├── staging.js
├── orbit.js
└── vehicle-model.js
```

Each module is kept separate so that the model can be read and tested subsystem by subsystem.

## Project structure

```text
ascentbench/
├── index.html
├── styles.css
├── script.js
├── validation.html
├── limitations.html
├── technical-pages.css
├── technical-pages.js
│
├── analyzer/
│   ├── analyzer.html
│   ├── analyzer.css
│   ├── analyzer.js
│   ├── guidance-profile.js
│   ├── input-adapter.js
│   ├── result-adapter.js
│   └── simulation.js
│
├── physics/
│   └── ...physics modules...
│
├── validation/
│   ├── atmosphere-validation.js
│   ├── orbit-validation.js
│   ├── energy-validation.js
│   ├── convergence-validation.js
│   ├── staging-validation.js
│   ├── falcon9-validation.js
│   └── raw-output/
│
├── tests/
│   └── smoke.mjs
│
├── TEST_RESULTS.md
├── LICENSE
├── .gitignore
└── package.json
```

## Run locally

Because the project uses ES modules, serve the repository through a local HTTP server instead of opening `index.html` directly with `file://`.

With Python installed:

```bash
python -m http.server 8080
```

Then open:

```text
http://localhost:8080/
```

## Run the smoke tests

Node.js is required for the automated test and validation scripts.

```bash
npm test
```

The smoke suite exercises important atmosphere, propulsion, orbit, integration, simulation-pipeline, sampling, and terminal-mass behavior.

## Run validation independently

```bash
npm run validate:atmosphere
npm run validate:orbit
npm run validate:energy
npm run validate:convergence
npm run validate:staging
npm run validate:falcon9
```

The Falcon 9 command is a descriptive public-flight benchmark. It intentionally does not invent an arbitrary pass/fail threshold for a vehicle model that does not reproduce mission-specific Falcon 9 guidance, aerodynamics, throttle history, or exact CRS-5 mass loading.

## Known limitations

The current implementation does **not** model a complete real launch environment. Important limitations include:

- 2D rather than full 3D trajectory dynamics
- spherical Earth
- no J2 or other higher-order geopotential effects
- no winds or weather
- no mission-specific atmosphere
- generic rather than vehicle-specific aerodynamic coefficients
- no lift or full angle-of-attack aerodynamics
- simplified propulsion and throttle behavior
- assumed open-loop guidance rather than a real vehicle flight program
- no detailed stage-separation dynamics
- planar two-body orbital analysis

The complete interpretation is documented in [`limitations.html`](limitations.html).

## Security and privacy

AscentBench is currently a static, client-side application. It does not require user accounts or a project database. Do not place API keys, passwords, access tokens, or other secrets in browser-delivered JavaScript or commit them to this repository.

The hosted production version uses restrictive browser security headers, but public client-side source code must always be assumed inspectable by visitors.

## Contributing

Issues, corrections, reproducible validation improvements, documentation fixes, and well-justified model improvements are welcome. Changes to physics should include a clear explanation of the model change and, where practical, validation evidence showing its effect.

## License

This project is released under the [MIT License](LICENSE).

The MIT license permits reuse and modification while preserving the copyright and license notice. The software is provided without warranty.

## Author and contact

**Vedant Verma**

Project contact: **contact.ascentbench@gmail.com**  
Website: **https://ascentbench.info**

AscentBench is an independent educational engineering project.
