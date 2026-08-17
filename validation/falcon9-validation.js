/**
 * @file falcon9-validation.js
 * @description Descriptive public-flight benchmark of the simplified AscentBench
 * ascent stack against selected Falcon 9 v1.1 / CRS-5 published anchors. Published
 * values, model assumptions, derived diagnostics, and sensitivity experiments are
 * kept separate to avoid presenting approximate proxy data as flight telemetry.
 *
 * This benchmark has no arbitrary pass/fail threshold. It identifies vehicle-model
 * fidelity limitations and does not claim to reconstruct SpaceX guidance, throttle,
 * aerodynamic, or mission-specific mass histories. Direct source URLs accompany
 * externally sourced comparison values in this file.
 */
import { prepareSimulationInput } from "../analyzer/input-adapter.js";
import { runSimulation } from "../analyzer/simulation.js";
import { getStandardAtmosphere } from "../physics/atmosphere.js";

// =============================================================================
// 1. PRIMARY SOURCE REGISTRY
// =============================================================================

const SOURCES = Object.freeze({
  NASA_CRS5_PRESS_KIT: Object.freeze({
    title: "SpaceX CRS-5 Mission Press Kit (NASA)",
    url: "https://www.nasa.gov/wp-content/uploads/2018/07/spacex_nasa_crs-5_presskit-105.pdf",
    locations: Object.freeze({
      flightAnchors: "Launch and Ascent, p. 5",
      vehicle: "Falcon 9 Overview / Advanced Technology, pp. 15-16",
    }),
    notes:
      "Mission-contemporaneous source for ~70 s supersonic time, ~157 s MECO, 80 km / Mach 10 at MECO, Falcon 9 diameter, Merlin 1D thrust, and the statement that first-stage engines are gradually throttled near the end of first-stage flight.",
  }),

  FAA_FALCON_PROGRAM_EA: Object.freeze({
    title: "Environmental Assessment for SpaceX Falcon Launches at KSC and CCAFS (FAA)",
    url: "https://www.faa.gov/sites/faa.gov/files/space/environmental/nepa_docs/SpaceX_Falcon_Program_Final_EA_and_FONSI.pdf",
    locations: Object.freeze({
      v11Mass: "Section 1.2.2, p. 23",
      versionTable: "Table 2-1, p. 30",
      missionSpecificTrajectories: "Section 2.1.2.1, p. 36",
    }),
    notes:
      "Later FAA summary source. It describes Falcon 9 v1.1 as ~1,100,000 lb gross lift-off weight, lists version-level propellant/thrust data, notes that propellant quantities vary with mission parameters, and states that Falcon trajectories are mission-specific.",
  }),

  NASA_CAPE_ROTATION: Object.freeze({
    title: "NASA GSFC educational orbital-mechanics reference",
    url: "https://pwg.gsfc.nasa.gov/Education/JAS1.htm",
    notes:
      "Provides the useful reference that a due-east launch from Cape Canaveral near 28.5 deg N receives about 407 m/s of eastward inertial velocity from Earth's rotation. CRS-5 was not a simple due-east 2D launch, so 407 m/s is used only for a diagnostic sensitivity case.",
  }),

  US_STANDARD_ATMOSPHERE: Object.freeze({
    title: "U.S. Standard Atmosphere, 1976 (NASA NTRS)",
    url: "https://ntrs.nasa.gov/citations/19770009539",
    notes:
      "Reference family for the lower-atmosphere convention. LVA's atmosphere implementation is validated separately; here it is used only for a derived Mach/speed-of-sound diagnostic.",
  }),
});

// =============================================================================
// 2. PUBLISHED COMPARISON ANCHORS
// =============================================================================

const FLIGHT_REFERENCE = Object.freeze({
  mission: "SpaceX CRS-5",
  vehicleVersion: "Falcon 9 v1.1",

  supersonicTimeS: Object.freeze({
    value: 70,
    source: SOURCES.NASA_CRS5_PRESS_KIT.url,
    sourceLocation: SOURCES.NASA_CRS5_PRESS_KIT.locations.flightAnchors,
    sourceTextSummary:
      "NASA states Falcon 9 reaches supersonic speed one minute and ten seconds after liftoff.",
    precisionNote:
      "This is a rounded narrative flight anchor, not high-rate telemetry with a stated uncertainty.",
  }),

  mecoTimeS: Object.freeze({
    value: 157,
    source: SOURCES.NASA_CRS5_PRESS_KIT.url,
    sourceLocation: SOURCES.NASA_CRS5_PRESS_KIT.locations.flightAnchors,
    sourceTextSummary:
      "NASA states first-stage MECO occurs approximately 157 seconds into flight.",
    precisionNote:
      "The source explicitly says approximately; the benchmark therefore must not treat 157.000000 s as an exact telemetry truth.",
  }),

  mecoAltitudeM: Object.freeze({
    value: 80_000,
    source: SOURCES.NASA_CRS5_PRESS_KIT.url,
    sourceLocation: SOURCES.NASA_CRS5_PRESS_KIT.locations.flightAnchors,
    sourceTextSummary:
      "NASA states Falcon 9 is 80 km high at MECO.",
    precisionNote:
      "The press kit reports 80 km as a rounded narrative value and does not provide an uncertainty interval.",
  }),

  mecoMach: Object.freeze({
    value: 10,
    source: SOURCES.NASA_CRS5_PRESS_KIT.url,
    sourceLocation: SOURCES.NASA_CRS5_PRESS_KIT.locations.flightAnchors,
    sourceTextSummary:
      "NASA states Falcon 9 is traveling at 10 times the speed of sound at MECO.",
    precisionNote:
      "Mach 10 is rounded and the source does not specify a local speed-of-sound convention or an explicit m/s velocity.",
  }),
});

// =============================================================================
// 3. PUBLISHED VEHICLE ANCHORS USED BY THE PROXY
// =============================================================================

const LB_TO_KG = 0.45359237;
const FT_TO_M = 0.3048;

const PUBLISHED_VEHICLE_ANCHORS = Object.freeze({
  grossLiftoffMassKg: Object.freeze({
    value: 1_100_000 * LB_TO_KG,
    original: "approximately 1,100,000 lb",
    source: SOURCES.FAA_FALCON_PROGRAM_EA.url,
    sourceLocation: SOURCES.FAA_FALCON_PROGRAM_EA.locations.v11Mass,
    note:
      "FAA describes Falcon 9 v1.1 gross lift-off weight as approximately 1.1 million pounds. This rounded value is used only as an aggregate initial-mass anchor.",
  }),

  faaV11TotalPropellantKg: Object.freeze({
    value: 1_120_925 * LB_TO_KG,
    original: "1,120,925 lbm total propellant for Falcon 9 v1.1",
    source: SOURCES.FAA_FALCON_PROGRAM_EA.url,
    sourceLocation: SOURCES.FAA_FALCON_PROGRAM_EA.locations.versionTable,
    note:
      "FAA Table 2-1 lists this version-level value and explicitly notes that propellant quantities vary with mission parameters. It is NOT used as the CRS-5 exact propellant load.",
  }),

  faaV11ThrustPerEngineLbf: Object.freeze({
    value: 170_000,
    original: "170,000 lbf per engine (FAA later v1.1 summary)",
    source: SOURCES.FAA_FALCON_PROGRAM_EA.url,
    sourceLocation: SOURCES.FAA_FALCON_PROGRAM_EA.locations.versionTable,
    note:
      "This later FAA summary differs from the CRS-5 press kit's mission-contemporaneous 147,000 lbf / 654 kN per-engine liftoff value. It is displayed as a source-version consistency warning, not used in the baseline run.",
  }),

  diameterM: Object.freeze({
    value: 12 * FT_TO_M,
    original: "12 ft",
    source: SOURCES.NASA_CRS5_PRESS_KIT.url,
    sourceLocation: SOURCES.NASA_CRS5_PRESS_KIT.locations.vehicle,
    note: "NASA CRS-5 press kit gives Falcon 9 diameter as 12 ft.",
  }),

  thrustSeaLevelN: Object.freeze({
    value: 9 * 654_000,
    original: "9 engines x 654 kN each (147,000 lbf each)",
    source: SOURCES.NASA_CRS5_PRESS_KIT.url,
    sourceLocation: SOURCES.NASA_CRS5_PRESS_KIT.locations.vehicle,
    note:
      "NASA CRS-5 press kit states one Merlin 1D produces 654 kN at liftoff. This mission-contemporaneous source is preferred over later version-summary values.",
  }),

  thrustVacuumN: Object.freeze({
    value: 9 * 716_000,
    original: "9 engines x 716 kN each (161,000 lbf each)",
    source: SOURCES.NASA_CRS5_PRESS_KIT.url,
    sourceLocation: SOURCES.NASA_CRS5_PRESS_KIT.locations.vehicle,
    note:
      "NASA CRS-5 press kit states one Merlin 1D rises to 716 kN as it climbs out of the atmosphere.",
  }),
});

// =============================================================================
// 4. EXPLICIT MODELING ASSUMPTIONS
// =============================================================================

const BASELINE_CD_POINTS = Object.freeze([
  Object.freeze([0.0, 0.25]),
  Object.freeze([0.8, 0.28]),
  Object.freeze([1.0, 0.50]),
  Object.freeze([1.2, 0.42]),
  Object.freeze([2.0, 0.30]),
  Object.freeze([5.0, 0.25]),
  Object.freeze([10.0, 0.22]),
]);

const GENERIC_GUIDANCE_POINTS = Object.freeze([
  Object.freeze({ value: 0, pitchDegrees: 90 }),
  Object.freeze({ value: 1_000, pitchDegrees: 90 }),
  Object.freeze({ value: 20_000, pitchDegrees: 65 }),
  Object.freeze({ value: 60_000, pitchDegrees: 30 }),
  Object.freeze({ value: 120_000, pitchDegrees: 0 }),
]);

const ASSUMPTIONS = Object.freeze({
  aggregateUsablePropellantKg: 400_000,
  ispSeaLevelS: 282,
  ispVacuumS: 311,
  cdPoints: BASELINE_CD_POINTS,
  guidanceType: "genericAssumed",
  throttle: 1,
  launchRotationMps: 0,
});

// =============================================================================
// 5. RAW INPUT BUILDER
// =============================================================================

function createRawInput({
  massScale = 1,
  thrustScale = 1,
  ispScale = 1,
  cdScale = 1,
  customGuidancePoints = null,
  initialTangentialVelocityMps = 0,
  airTangentialVelocityMps = 0,
} = {}) {
  const initialMassKg =
    PUBLISHED_VEHICLE_ANCHORS.grossLiftoffMassKg.value * massScale;

  const propellantMassKg = ASSUMPTIONS.aggregateUsablePropellantKg;
  const aggregateNonPropellantMassKg = initialMassKg - propellantMassKg;

  if (aggregateNonPropellantMassKg <= 0) {
    throw new Error("Aggregate Falcon 9 proxy mass definition is invalid.");
  }

  return {
    vehicle: {
      name: "Falcon 9 v1.1 CRS-5 aggregate first-stage-ascent proxy",
      payloadMass: { value: 0, unit: "kg" },
      stages: [{
        name: "Aggregate powered-ascent proxy",
        dryMass: aggregateNonPropellantMassKg,
        propellantMass: propellantMassKg,
        residualPropellantMass: 0,
        thrustSeaLevel: {
          value: PUBLISHED_VEHICLE_ANCHORS.thrustSeaLevelN.value * thrustScale,
          unit: "N",
        },
        thrustVacuum: {
          value: PUBLISHED_VEHICLE_ANCHORS.thrustVacuumN.value * thrustScale,
          unit: "N",
        },
        ispSeaLevel: ASSUMPTIONS.ispSeaLevelS * ispScale,
        ispVacuum: ASSUMPTIONS.ispVacuumS * ispScale,
        diameter: {
          value: PUBLISHED_VEHICLE_ANCHORS.diameterM.value,
          unit: "m",
        },
        cdModelId: "falcon9-proxy-cd",
        separationDelay: { value: 0, unit: "s" },
      }],
    },

    aerodynamics: {
      models: [{
        id: "falcon9-proxy-cd",
        name: "Generic assumed Falcon-9 proxy Cd(M)",
        points: ASSUMPTIONS.cdPoints.map(([mach, cd]) => ({
          mach,
          cd: cd * cdScale,
        })),
        outsideRange: "clamp",
        provenance: {
          origin: "assumed",
          note:
            "Generic educational Cd(M) curve; not Falcon 9 flight aerodynamic data.",
        },
      }],
    },

    guidance: customGuidancePoints === null
      ? {
          type: ASSUMPTIONS.guidanceType,
          progradeSign: 1,
        }
      : {
          type: "pitchProgram",
          coordinate: "altitude",
          interpolation: "smoothstep",
          progradeSign: 1,
          points: customGuidancePoints,
        },

    initialConditions: {
      launchAltitude: { value: 0, unit: "m" },
      velocityX: 0,
      velocityY: {
        value: initialTangentialVelocityMps,
        unit: "m/s",
      },
    },

    mission: {},

    solver: {
      method: "rk4",
      dt: { value: 0.1, unit: "s" },
      maxTime: { value: FLIGHT_REFERENCE.mecoTimeS.value, unit: "s" },
      recordEveryNSteps: 1,
    },

    propulsion: {
      engineOn: true,
      throttle: ASSUMPTIONS.throttle,
    },

    air: {
      velocityX: { value: 0, unit: "m/s" },
      velocityY: {
        value: airTangentialVelocityMps,
        unit: "m/s",
      },
    },

    atmosphere: {
      aboveModel: "vacuum",
    },
  };
}

// =============================================================================
// 6. HISTORY / FORMATTING HELPERS
// =============================================================================

function findMachOneCrossing(history) {
  for (let i = 1; i < history.length; i += 1) {
    const a = history[i - 1];
    const b = history[i];
    const ma = a.diagnostics?.aerodynamics?.mach;
    const mb = b.diagnostics?.aerodynamics?.mach;

    if (!Number.isFinite(ma) || !Number.isFinite(mb)) continue;
    if (ma > 1 || mb < 1) continue;

    if (mb === ma) return b.time;

    const fraction = (1 - ma) / (mb - ma);
    return a.time + fraction * (b.time - a.time);
  }

  return null;
}

function relativeErrorPercent(model, reference) {
  if (!Number.isFinite(model) || !Number.isFinite(reference) || reference === 0) {
    return null;
  }

  return Math.abs(model - reference) / Math.abs(reference) * 100;
}

function format(value, digits = 6) {
  return Number.isFinite(value) ? value.toFixed(digits) : "N/A";
}

function signed(value, digits = 6) {
  if (!Number.isFinite(value)) return "N/A";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function printSource(label, item) {
  console.log(`${label}:`);
  console.log(`  value:    ${item.original ?? item.value}`);
  console.log(`  source:   ${item.source}`);
  if (item.sourceLocation) console.log(`  location: ${item.sourceLocation}`);
  if (item.note) console.log(`  note:     ${item.note}`);
  if (item.sourceTextSummary) console.log(`  basis:    ${item.sourceTextSummary}`);
  if (item.precisionNote) console.log(`  precision:${item.precisionNote}`);
}

function getRunMetrics(result, name) {
  const finalSample = result.history[result.history.length - 1];

  return Object.freeze({
    name,
    altitudeKm: finalSample.diagnostics.altitude / 1000,
    speedKmS: finalSample.diagnostics.speed / 1000,
    mach: finalSample.diagnostics.aerodynamics.mach,
    machOneTimeS: findMachOneCrossing(result.history),
    finalMassKg: finalSample.state.mass,
  });
}

function runCase(name, options = {}, propulsionProvider = null) {
  const prepared = prepareSimulationInput(createRawInput(options));
  const config = {
    ...prepared.simulationConfig,
  };

  if (propulsionProvider !== null) {
    config.propulsionProvider = propulsionProvider;
  }

  return getRunMetrics(
    runSimulation(config),
    name
  );
}

function deltaMetrics(caseResult, baseline) {
  return Object.freeze({
    altitudeKm: caseResult.altitudeKm - baseline.altitudeKm,
    speedKmS: caseResult.speedKmS - baseline.speedKmS,
    mach: caseResult.mach - baseline.mach,
    machOneTimeS: caseResult.machOneTimeS - baseline.machOneTimeS,
  });
}

// =============================================================================
// 7. BASELINE RUN
// =============================================================================

const baseline = runCase("BASELINE");

const modelAltitudeM = baseline.altitudeKm * 1000;
const modelMach = baseline.mach;
const modelSpeedMps = baseline.speedKmS * 1000;
const modelMachOneTimeS = baseline.machOneTimeS;

const altitudeErrorPercent = relativeErrorPercent(
  modelAltitudeM,
  FLIGHT_REFERENCE.mecoAltitudeM.value
);

const machErrorPercent = relativeErrorPercent(
  modelMach,
  FLIGHT_REFERENCE.mecoMach.value
);

const machOneTimeErrorPercent = relativeErrorPercent(
  modelMachOneTimeS,
  FLIGHT_REFERENCE.supersonicTimeS.value
);

// =============================================================================
// 8. CONTROLLED SENSITIVITY EXPERIMENTS
// =============================================================================

/**
 * INTERPRETATION NOTE:
 * The perturbations below are chosen to expose sensitivity, not to represent
 * certified uncertainty bounds on Falcon 9 data.
 *
 * +/-5% is used for mass, thrust, and Isp as a common relative perturbation so
 * their influence can be compared on roughly equal footing.
 *
 * +/-25% Cd is deliberately large because the baseline Cd curve is generic and
 * assumed; the question is whether even a large aerodynamic perturbation can
 * explain the observed discrepancy.
 */

const MORE_VERTICAL_GUIDANCE = Object.freeze([
  Object.freeze({ value: 0, pitchDegrees: 90 }),
  Object.freeze({ value: 1_000, pitchDegrees: 90 }),
  Object.freeze({ value: 20_000, pitchDegrees: 75 }),
  Object.freeze({ value: 60_000, pitchDegrees: 45 }),
  Object.freeze({ value: 120_000, pitchDegrees: 10 }),
]);

const MORE_HORIZONTAL_GUIDANCE = Object.freeze([
  Object.freeze({ value: 0, pitchDegrees: 90 }),
  Object.freeze({ value: 1_000, pitchDegrees: 85 }),
  Object.freeze({ value: 20_000, pitchDegrees: 55 }),
  Object.freeze({ value: 60_000, pitchDegrees: 15 }),
  Object.freeze({ value: 120_000, pitchDegrees: 0 }),
]);

const CAPE_ROTATION_DIAGNOSTIC_MPS = 407;

const sensitivityCases = [
  runCase("Cd -25%", { cdScale: 0.75 }),
  runCase("Cd +25%", { cdScale: 1.25 }),
  runCase("Initial mass -5%", { massScale: 0.95 }),
  runCase("Initial mass +5%", { massScale: 1.05 }),
  runCase("Isp -5%", { ispScale: 0.95 }),
  runCase("Isp +5%", { ispScale: 1.05 }),
  runCase("Thrust -5%", { thrustScale: 0.95 }),
  runCase("Thrust +5%", { thrustScale: 1.05 }),
  runCase("More-vertical guidance", {
    customGuidancePoints: MORE_VERTICAL_GUIDANCE,
  }),
  runCase("More-horizontal guidance", {
    customGuidancePoints: MORE_HORIZONTAL_GUIDANCE,
  }),
  runCase("Approx. co-rotating Cape initial state", {
    initialTangentialVelocityMps: CAPE_ROTATION_DIAGNOSTIC_MPS,
    airTangentialVelocityMps: CAPE_ROTATION_DIAGNOSTIC_MPS,
  }),
  runCase(
    "Illustrative late throttle-down",
    {},
    (context) => ({
      engineOn: true,
      throttle:
        context.time < 130
          ? 1
          : Math.max(
              0.7,
              1 - ((context.time - 130) / 27) * 0.3
            ),
    })
  ),
];

const sensitivity = Object.freeze(
  sensitivityCases.map((item) => Object.freeze({
    ...item,
    delta: deltaMetrics(item, baseline),
  }))
);

function caseByName(name) {
  return sensitivity.find((item) => item.name === name);
}

// =============================================================================
// 9. DERIVED MACH / ATMOSPHERE DIAGNOSTIC
// =============================================================================

const atmosphereAtModelAltitude = getStandardAtmosphere(modelAltitudeM);
const atmosphereAtReferenceAltitude = getStandardAtmosphere(
  FLIGHT_REFERENCE.mecoAltitudeM.value
);

const modelSpeedIfEvaluatedAt80kmMach =
  modelSpeedMps / atmosphereAtReferenceAltitude.speedOfSound;

const mach10DerivedSpeedAt80kmMps =
  FLIGHT_REFERENCE.mecoMach.value * atmosphereAtReferenceAltitude.speedOfSound;

const derivedSpeedGapKmS =
  (modelSpeedMps - mach10DerivedSpeedAt80kmMps) / 1000;

const totalMachGap = FLIGHT_REFERENCE.mecoMach.value - modelMach;
const altitudeSoundSpeedContribution =
  modelSpeedIfEvaluatedAt80kmMach - modelMach;

const acousticFractionOfMachGapPercent =
  totalMachGap > 0
    ? altitudeSoundSpeedContribution / totalMachGap * 100
    : null;

// =============================================================================
// 10. SOURCE CONSISTENCY DIAGNOSTICS
// =============================================================================

const grossLb = 1_100_000;
const faaPropellantLb = 1_120_925;
const propellantMinusGrossLb = faaPropellantLb - grossLb;
const faaVsNasaThrustDifferencePercent =
  (170_000 - 147_000) / 147_000 * 100;

// =============================================================================
// 11. OUTPUT
// =============================================================================

console.log("FALCON 9 CRS-5 PUBLIC-FLIGHT BENCHMARK + ERROR DIAGNOSIS");
console.log("========================================================");
console.log(`Mission:           ${FLIGHT_REFERENCE.mission}`);
console.log(`Vehicle version:   ${FLIGHT_REFERENCE.vehicleVersion}`);
console.log("Benchmark type:    approximate aggregate first-stage-ascent proxy");
console.log("Result semantics:  descriptive comparison + sensitivity diagnosis; NOT formal pass/fail");
console.log();

console.log("PRIMARY SOURCES");
console.log("---------------");
for (const source of Object.values(SOURCES)) {
  console.log(source.title);
  console.log(source.url);
  console.log(`  ${source.notes}`);
  console.log();
}

console.log("PUBLISHED FLIGHT REFERENCES");
console.log("---------------------------");
printSource("Supersonic time", FLIGHT_REFERENCE.supersonicTimeS);
printSource("MECO time", FLIGHT_REFERENCE.mecoTimeS);
printSource("MECO altitude", FLIGHT_REFERENCE.mecoAltitudeM);
printSource("MECO Mach", FLIGHT_REFERENCE.mecoMach);
console.log();

console.log("PUBLISHED VEHICLE ANCHORS USED BY BASELINE");
console.log("------------------------------------------");
printSource("Approximate gross liftoff mass", PUBLISHED_VEHICLE_ANCHORS.grossLiftoffMassKg);
printSource("Diameter", PUBLISHED_VEHICLE_ANCHORS.diameterM);
printSource("First-stage sea-level thrust", PUBLISHED_VEHICLE_ANCHORS.thrustSeaLevelN);
printSource("First-stage high-altitude/vacuum thrust anchor", PUBLISHED_VEHICLE_ANCHORS.thrustVacuumN);
console.log();

console.log("PUBLIC-SOURCE CONSISTENCY WARNINGS");
console.log("----------------------------------");
console.log(`FAA rounded v1.1 gross lift-off weight:  ${grossLb.toLocaleString("en-US")} lb`);
console.log(`FAA v1.1 version-table total propellant: ${faaPropellantLb.toLocaleString("en-US")} lbm`);
console.log(`Propellant minus rounded gross value:    ${propellantMinusGrossLb.toLocaleString("en-US")} lb`);
console.log("Interpretation: these aggregate public figures cannot be combined as an exact CRS-5 mass ledger. The FAA itself notes that propellant quantities vary by mission parameters; the gross value is explicitly approximate.");
console.log(`Source: ${SOURCES.FAA_FALCON_PROGRAM_EA.url}`);
console.log();
console.log("NASA CRS-5 per-engine liftoff thrust: 147,000 lbf (654 kN)");
console.log("Later FAA v1.1 summary thrust:        170,000 lbf per engine");
console.log(`Difference between public version summaries: ${format(faaVsNasaThrustDifferencePercent, 3)} %`);
console.log("Interpretation: vehicle-version/public-summary values changed across documents. The benchmark therefore uses the mission-contemporaneous CRS-5 NASA thrust anchor rather than mixing later values into the baseline.");
console.log(`NASA source: ${SOURCES.NASA_CRS5_PRESS_KIT.url}`);
console.log(`FAA source:  ${SOURCES.FAA_FALCON_PROGRAM_EA.url}`);
console.log();

console.log("UNSOURCED / EXPLICIT MODELING ASSUMPTIONS");
console.log("-----------------------------------------");
console.log(`Aggregate usable propellant reservoir: ${ASSUMPTIONS.aggregateUsablePropellantKg.toLocaleString("en-US")} kg`);
console.log(`Isp sea level / vacuum:                ${ASSUMPTIONS.ispSeaLevelS} s / ${ASSUMPTIONS.ispVacuumS} s`);
console.log("Aerodynamics:                          generic assumed Mach-Cd table");
console.log("Guidance:                              built-in generic open-loop profile");
console.log("Throttle:                              constant 100% in baseline");
console.log("Earth rotation / launch latitude:      not modeled in baseline 2D ascent stack");
console.log();

console.log("BASELINE STATE AT NASA-PUBLISHED MECO TIME");
console.log("------------------------------------------");
console.log(`Evaluation time:      ${FLIGHT_REFERENCE.mecoTimeS.value.toFixed(3)} s (imposed from rounded reference; not a model-predicted MECO time)`);
console.log(`Model altitude:       ${format(baseline.altitudeKm, 6)} km`);
console.log("NASA altitude:        80.000 km (rounded narrative anchor)");
console.log(`Altitude difference:  ${format(baseline.altitudeKm - 80, 6)} km`);
console.log(`Nominal percent diff: ${format(altitudeErrorPercent, 6)} %`);
console.log();
console.log(`Model Mach:           ${format(modelMach, 9)}`);
console.log("NASA Mach:            10.000 (rounded narrative anchor)");
console.log(`Mach difference:      ${format(modelMach - 10, 9)}`);
console.log(`Nominal percent diff: ${format(machErrorPercent, 6)} %`);
console.log();
console.log(`Model inertial speed: ${format(baseline.speedKmS, 9)} km/s`);
console.log("NASA explicit speed:  not provided in the press kit");
console.log();

console.log("EARLY-ASCENT CROSS-CHECK");
console.log("------------------------");
console.log(`Model Mach-1 crossing: ${format(modelMachOneTimeS, 6)} s`);
console.log("NASA supersonic time:  ~70 s (rounded narrative anchor)");
console.log(`Timing difference:     ${format(modelMachOneTimeS - 70, 6)} s`);
console.log(`Nominal percent diff:  ${format(machOneTimeErrorPercent, 6)} %`);
console.log();

console.log("CONTROLLED ONE-AT-A-TIME SENSITIVITY RUNS");
console.log("-----------------------------------------");
console.log("These are DIAGNOSTIC perturbations, not claimed Falcon 9 uncertainties and not fitted parameters.");
console.log("Mass/thrust/Isp: +/-5%; Cd: +/-25%; guidance: deliberately steeper/shallower assumed pitch programs.");
console.log("The throttle-down and Cape-rotation cases are directionality tests, not CRS-5 reconstructions.");
console.log();
console.log("case                              alt(km)   dAlt(km)   speed(km/s) dSpeed    Mach       dMach      Mach1(s)   dMach1(s)");
console.log("------------------------------------------------------------------------------------------------------------------");
console.log(`${baseline.name.padEnd(33)} ${format(baseline.altitudeKm,3).padStart(8)} ${format(0,3).padStart(10)} ${format(baseline.speedKmS,6).padStart(12)} ${format(0,6).padStart(8)} ${format(baseline.mach,6).padStart(10)} ${format(0,6).padStart(10)} ${format(baseline.machOneTimeS,3).padStart(10)} ${format(0,3).padStart(11)}`);
for (const item of sensitivity) {
  console.log(`${item.name.padEnd(33)} ${format(item.altitudeKm,3).padStart(8)} ${signed(item.delta.altitudeKm,3).padStart(10)} ${format(item.speedKmS,6).padStart(12)} ${signed(item.delta.speedKmS,6).padStart(8)} ${format(item.mach,6).padStart(10)} ${signed(item.delta.mach,6).padStart(10)} ${format(item.machOneTimeS,3).padStart(10)} ${signed(item.delta.machOneTimeS,3).padStart(11)}`);
}
console.log();

const massMinus = caseByName("Initial mass -5%");
const massPlus = caseByName("Initial mass +5%");
const thrustMinus = caseByName("Thrust -5%");
const thrustPlus = caseByName("Thrust +5%");
const ispMinus = caseByName("Isp -5%");
const ispPlus = caseByName("Isp +5%");
const cdMinus = caseByName("Cd -25%");
const cdPlus = caseByName("Cd +25%");
const vertical = caseByName("More-vertical guidance");
const horizontal = caseByName("More-horizontal guidance");
const rotation = caseByName("Approx. co-rotating Cape initial state");
const throttleDown = caseByName("Illustrative late throttle-down");

console.log("ERROR DIAGNOSIS A — MACH-1 CROSSING (~70 s)");
console.log("--------------------------------------------");
console.log(`Observed nominal discrepancy: ${format(modelMachOneTimeS - 70, 6)} s (${format(machOneTimeErrorPercent, 3)} %).`);
console.log("Reference limitation: NASA gives a rounded narrative time ('one minute and ten seconds'), not a telemetry uncertainty interval.");
console.log(`Source: ${FLIGHT_REFERENCE.supersonicTimeS.source}`);
console.log();
console.log(`Sensitivity to +/-5% initial mass: ${signed(massMinus.delta.machOneTimeS,3)} s / ${signed(massPlus.delta.machOneTimeS,3)} s`);
console.log(`Sensitivity to +/-5% thrust:       ${signed(thrustMinus.delta.machOneTimeS,3)} s / ${signed(thrustPlus.delta.machOneTimeS,3)} s`);
console.log(`Sensitivity to +/-5% Isp:          ${signed(ispMinus.delta.machOneTimeS,3)} s / ${signed(ispPlus.delta.machOneTimeS,3)} s`);
console.log(`Sensitivity to +/-25% Cd:          ${signed(cdMinus.delta.machOneTimeS,3)} s / ${signed(cdPlus.delta.machOneTimeS,3)} s`);
console.log("Conclusion: the 0.615 s agreement is smaller than the response to several plausible diagnostic perturbations. It is encouraging, but it cannot by itself validate the Falcon-specific mass/thrust/aero model; compensating errors can produce a close Mach-1 time.");
console.log();

console.log("ERROR DIAGNOSIS B — ALTITUDE AT 157 s");
console.log("-------------------------------------");
console.log(`Observed nominal discrepancy: ${format(baseline.altitudeKm - 80, 6)} km (model low by ${format(altitudeErrorPercent, 3)} % relative to the rounded 80 km anchor).`);
console.log();
console.log("High-sensitivity inputs in this proxy:");
console.log(`  Initial mass -5% / +5% -> altitude shift ${signed(massMinus.delta.altitudeKm,3)} / ${signed(massPlus.delta.altitudeKm,3)} km.`);
console.log(`  Thrust -5% / +5%       -> altitude shift ${signed(thrustMinus.delta.altitudeKm,3)} / ${signed(thrustPlus.delta.altitudeKm,3)} km.`);
console.log("  These perturbations are not uncertainty claims, but they show that thrust-to-mass ratio is a dominant numerical lever. Public CRS-5 mass information is only approximate, and public version summaries are not internally precise enough to reconstruct the exact flight mass state.");
console.log(`  FAA source: ${SOURCES.FAA_FALCON_PROGRAM_EA.url}`);
console.log();
console.log("Material guidance sensitivity:");
console.log(`  More-vertical assumed profile   -> altitude shift ${signed(vertical.delta.altitudeKm,3)} km.`);
console.log(`  More-horizontal assumed profile -> altitude shift ${signed(horizontal.delta.altitudeKm,3)} km.`);
console.log("  FAA states Falcon trajectories are mission-specific; the public sources used here do not provide the CRS-5 pitch program. Guidance therefore materially affects altitude allocation and is a major unclosed fidelity term.");
console.log(`  FAA source: ${SOURCES.FAA_FALCON_PROGRAM_EA.url}`);
console.log();
console.log("Moderate mass-flow sensitivity:");
console.log(`  Isp -5% / +5% -> altitude shift ${signed(ispMinus.delta.altitudeKm,3)} / ${signed(ispPlus.delta.altitudeKm,3)} km.`);
console.log("  Baseline Isp is an explicit assumption. Because LVA derives mass flow from thrust/(Isp*g0), Isp changes the vehicle mass history and therefore acceleration.");
console.log();
console.log("Low sensitivity in this experiment:");
console.log(`  Cd -25% / +25% -> altitude shift ${signed(cdMinus.delta.altitudeKm,3)} / ${signed(cdPlus.delta.altitudeKm,3)} km.`);
console.log(`  Approximate Cape co-rotation -> altitude shift ${signed(rotation.delta.altitudeKm,3)} km.`);
console.log("  Therefore, within these perturbations, neither the generic Cd curve nor omitted rotation is large enough by itself to explain the ~8.7 km altitude shortfall.");
console.log();
console.log("Wrong-direction / masking effect:");
console.log(`  Illustrative late throttle-down -> altitude shift ${signed(throttleDown.delta.altitudeKm,3)} km.`);
console.log("  NASA states the real first-stage engines were gradually throttled near the end of first-stage flight. The baseline incorrectly stays at 100%; adding an illustrative throttle-down reduces altitude further. Therefore missing throttle-down does NOT explain why baseline altitude is too low; constant full throttle actually biases the proxy slightly toward the reference and masks some discrepancy.");
console.log(`  NASA source: ${SOURCES.NASA_CRS5_PRESS_KIT.url}`);
console.log();

console.log("ERROR DIAGNOSIS C — MACH AT 157 s");
console.log("---------------------------------");
console.log(`Observed nominal discrepancy: model Mach ${format(modelMach,3)} vs rounded NASA Mach 10 (${format(machErrorPercent,3)} % nominal difference).`);
console.log();
console.log("First separate vehicle-speed error from local speed-of-sound error:");
console.log(`  LVA speed of sound at model altitude (${format(baseline.altitudeKm,3)} km): ${format(atmosphereAtModelAltitude.speedOfSound,3)} m/s.`);
console.log(`  LVA/USSA speed of sound at reference altitude (80 km):             ${format(atmosphereAtReferenceAltitude.speedOfSound,3)} m/s.`);
console.log(`  Holding MODEL speed fixed but evaluating at 80 km gives Mach:       ${format(modelSpeedIfEvaluatedAt80kmMach,3)}.`);
console.log(`  Original model Mach:                                                 ${format(modelMach,3)}.`);
console.log(`  Altitude/acoustic shift therefore changes Mach by only:              ${format(altitudeSoundSpeedContribution,3)}.`);
console.log(`  That is about ${format(acousticFractionOfMachGapPercent,1)} % of the total Mach gap under the LVA atmosphere convention.`);
console.log("  Conclusion: most of the Mach discrepancy is a vehicle-speed/trajectory discrepancy, not an atmosphere speed-of-sound discrepancy.");
console.log(`  Atmosphere reference family: ${SOURCES.US_STANDARD_ATMOSPHERE.url}`);
console.log();
console.log("Derived diagnostic only (NOT a NASA-reported velocity):");
console.log(`  Mach 10 at LVA's validated 80 km standard-atmosphere sound speed would correspond to ~${format(mach10DerivedSpeedAt80kmMps / 1000,3)} km/s.`);
console.log(`  Baseline model speed is ${format(baseline.speedKmS,3)} km/s, a derived gap of ${format(derivedSpeedGapKmS,3)} km/s.`);
console.log();
console.log("High-sensitivity inputs for Mach/speed in this proxy:");
console.log(`  Initial mass -5% / +5% -> Mach shift ${signed(massMinus.delta.mach,3)} / ${signed(massPlus.delta.mach,3)}.`);
console.log(`  Thrust -5% / +5%       -> Mach shift ${signed(thrustMinus.delta.mach,3)} / ${signed(thrustPlus.delta.mach,3)}.`);
console.log("  This again identifies the exact thrust-to-mass history as a dominant unresolved proxy input. The public mass anchor is approximate, and public Falcon version thrust summaries differ across documents.");
console.log();
console.log("Moderate sensitivity:");
console.log(`  Isp -5% / +5% -> Mach shift ${signed(ispMinus.delta.mach,3)} / ${signed(ispPlus.delta.mach,3)}.`);
console.log("  Isp is unsourced in the benchmark and directly controls modeled mass flow, so it is a material source of speed uncertainty.");
console.log();
console.log("Smaller sensitivity for the tested perturbations:");
console.log(`  More-vertical / horizontal guidance -> Mach shift ${signed(vertical.delta.mach,3)} / ${signed(horizontal.delta.mach,3)}.`);
console.log(`  Cd -25% / +25%                  -> Mach shift ${signed(cdMinus.delta.mach,3)} / ${signed(cdPlus.delta.mach,3)}.`);
console.log(`  Approximate Cape co-rotation     -> Mach shift ${signed(rotation.delta.mach,3)}.`);
console.log("  Guidance strongly moves altitude but only modestly changes Mach in these two diagnostic profiles; Cd and co-rotation are much too small here to explain a 3.93-Mach shortfall alone.");
console.log();
console.log("Wrong-direction / masking effect:");
console.log(`  Illustrative late throttle-down -> Mach shift ${signed(throttleDown.delta.mach,3)}.`);
console.log("  Since the real vehicle throttled down near the end of first-stage flight, the baseline's constant 100% throttle should overstate late powered acceleration relative to a throttled case. It therefore cannot explain the low Mach; it partially hides the discrepancy.");
console.log();
console.log("Coupled-model conclusion:");
console.log("  No single sensitivity perturbation tested here closes the Mach-10 gap. The benchmark is therefore most consistent with a combined fidelity problem: approximate mission mass/thrust state + assumed Isp/mass-flow history + non-Falcon guidance, with smaller contributions from generic aerodynamics and frame/rotation simplifications. These effects are nonlinear and MUST NOT be numerically added as an 'error budget'.");
console.log();

console.log("WHY THE MACH-1 MATCH DOES NOT CONTRADICT THE MECO MISMATCH");
console.log("---------------------------------------------------------");
console.log("At ~70 s the vehicle has experienced much less cumulative mass depletion and guidance evolution than at 157 s. The sensitivity runs show that small changes in thrust-to-mass and Isp can shift the Mach-1 time by seconds and later MECO-state quantities by much larger amounts. A close early crossing can therefore coexist with a large late-state discrepancy through cumulative model error and/or cancellation among assumptions.");
console.log();

console.log("SCIENTIFIC CLAIM BOUNDARY");
console.log("-------------------------");
console.log("SUPPORTED:");
console.log("  - LVA reproduces the rounded ~70 s supersonic anchor within ~0.9% in this proxy.");
console.log("  - At the imposed 157 s reference time, LVA is ~8.7 km below the rounded 80 km anchor and reports Mach ~6.07 instead of rounded Mach 10.");
console.log("  - Controlled sensitivity runs show high dependence on thrust-to-mass ratio, material dependence on Isp/mass-flow and guidance, and much smaller dependence on the tested Cd and rotation perturbations.");
console.log("  - A late throttle-down perturbation moves the result farther from the reference, so the baseline's missing throttle-down is not the cause of its low-Mach result.");
console.log();
console.log("NOT SUPPORTED:");
console.log("  - assigning an exact percentage of the CRS-5 error to any one missing model feature;");
console.log("  - treating the +/- perturbations as Falcon 9 uncertainty intervals;");
console.log("  - claiming the NASA rounded anchors are exact telemetry;");
console.log("  - claiming this proxy validates Falcon 9 flight guidance or aerodynamics.");
console.log();

console.log("SUMMARY");
console.log("=======");
console.log(`Mach-1 crossing:      model=${format(modelMachOneTimeS,3)} s, NASA~70 s, nominal diff=${format(machOneTimeErrorPercent,3)} %`);
console.log(`Altitude at 157 s:    model=${format(baseline.altitudeKm,3)} km, NASA~80 km, nominal diff=${format(altitudeErrorPercent,3)} %`);
console.log(`Mach at 157 s:        model=${format(modelMach,3)}, NASA~10, nominal diff=${format(machErrorPercent,3)} %`);
console.log("Primary sensitivity finding: thrust-to-mass and mass-flow history dominate the tested late-state response; guidance materially controls altitude; tested Cd/rotation effects are smaller; throttle-down omission biases in the wrong direction to explain low Mach.");
console.log("Result:               BENCHMARK + ERROR DIAGNOSIS COMPLETE (descriptive; no pass/fail threshold)");
