/**
 * @file convergence-validation.js
 * @description Full-simulation fixed-timestep convergence study. The same vehicle,
 * guidance, atmosphere, aerodynamics, propulsion, and event configuration is run
 * at dt = 1.0, 0.5, 0.2, 0.1, and 0.05 s. The 0.05 s run is a numerical comparison
 * reference, not physical truth.
 */
import {
  prepareSimulationInput,
} from "../analyzer/input-adapter.js";

import {
  runSimulation,
} from "../analyzer/simulation.js";


// =============================================================================
// 1. CONVERGENCE TEST DEFINITION
// =============================================================================

const TIME_STEPS_S = Object.freeze([
  1.0,
  0.5,
  0.2,
  0.1,
  0.05,
]);

const PROJECT_DEFAULT_DT_S = 0.2;
const REFERENCE_DT_S = 0.05;

/**
 * Numerical acceptance criterion for the PROJECT DEFAULT timestep.
 *
 * The dt = 0.2 s run must differ from the dt = 0.05 s run by no more than
 * 0.01% for the selected continuous headline metrics.
 *
 * Why 0.01%?
 * ------------
 * This is intentionally a strict numerical-stability threshold for a
 * preliminary simulator. It is small enough to reveal material timestep
 * sensitivity while remaining completely separate from real-world model
 * uncertainty (guidance, Cd, winds, engine data, 2D assumptions, etc.).
 *
 * Passing this threshold means "the reported result is stable with respect
 * to this timestep refinement test". It does NOT mean the launch prediction
 * is physically accurate to 0.01%.
 */
const MAX_DEFAULT_VS_FINE_RELATIVE_DIFFERENCE_PERCENT = 0.01;

/**
 * Event-time acceptance criterion.
 *
 * Burnout timing for the default run must agree with the finest run within
 * one normal project timestep (0.2 s). The event-aware simulation usually
 * performs much better because it splits steps at burnout.
 */
const MAX_EVENT_TIME_DIFFERENCE_S = PROJECT_DEFAULT_DT_S;

/** Final mass is bookkeeping, so use a tiny absolute numerical tolerance. */
const MAX_FINAL_MASS_DIFFERENCE_KG = 1e-6;


// =============================================================================
// 2. FIXED ANALYZER EXAMPLE CASE
// =============================================================================

const EXAMPLE_STAGES = Object.freeze([
  Object.freeze({
    name: "Stage 1",
    dryMass: 25_000,
    propellantMass: 400_000,
    residualPropellantMass: 0,
    thrustSeaLevel: 7_600,
    thrustVacuum: 8_200,
    ispSeaLevel: 282,
    ispVacuum: 311,
    diameter: 3.7,
    separationDelay: 2,
  }),
  Object.freeze({
    name: "Stage 2",
    dryMass: 4_000,
    propellantMass: 60_000,
    residualPropellantMass: 0,
    thrustSeaLevel: 900,
    thrustVacuum: 1_000,
    ispSeaLevel: 320,
    ispVacuum: 348,
    diameter: 3.7,
    separationDelay: 0,
  }),
]);

const EXAMPLE_CD_POINTS = Object.freeze([
  Object.freeze([0.0, 0.25]),
  Object.freeze([0.8, 0.28]),
  Object.freeze([1.0, 0.50]),
  Object.freeze([1.2, 0.42]),
  Object.freeze([2.0, 0.30]),
  Object.freeze([5.0, 0.25]),
  Object.freeze([10.0, 0.22]),
]);

function createRawInput(dt) {
  return {
    vehicle: {
      name: "Example Two-Stage Vehicle",
      payloadMass: {
        value: 5_000,
        unit: "kg",
      },
      stages: EXAMPLE_STAGES.map((stage) => ({
        name: stage.name,
        dryMass: stage.dryMass,
        propellantMass: stage.propellantMass,
        residualPropellantMass: stage.residualPropellantMass,
        thrustSeaLevel: {
          value: stage.thrustSeaLevel,
          unit: "kN",
        },
        thrustVacuum: {
          value: stage.thrustVacuum,
          unit: "kN",
        },
        ispSeaLevel: stage.ispSeaLevel,
        ispVacuum: stage.ispVacuum,
        diameter: {
          value: stage.diameter,
          unit: "m",
        },
        cdModelId: "default-cd",
        separationDelay: {
          value: stage.separationDelay,
          unit: "s",
        },
      })),
    },

    aerodynamics: {
      models: [{
        id: "default-cd",
        name: "Analyzer Cd model",
        points: EXAMPLE_CD_POINTS.map(([mach, cd]) => ({ mach, cd })),
        outsideRange: "clamp",
        provenance: {
          origin: "assumed",
          note: "User-editable Analyzer Mach-Cd table.",
        },
      }],
    },

    guidance: {
      type: "genericAssumed",
      progradeSign: 1,
    },

    initialConditions: {
      launchAltitude: {
        value: 0,
        unit: "m",
      },
      velocityX: 0,
      velocityY: {
        value: 0,
        unit: "m/s",
      },
    },

    mission: {
      targetPeriapsisAltitude: {
        value: 200,
        unit: "km",
      },
      targetApoapsisAltitude: {
        value: 200,
        unit: "km",
      },
      altitudeTolerance: {
        value: 20,
        unit: "km",
      },
    },

    solver: {
      method: "rk4",
      dt: {
        value: dt,
        unit: "s",
      },
      maxTime: {
        value: 900,
        unit: "s",
      },
      recordEveryNSteps: 1,
    },

    propulsion: {
      engineOn: true,
      throttle: 1,
    },

    air: {
      velocityX: {
        value: 0,
        unit: "m/s",
      },
      velocityY: {
        value: 0,
        unit: "m/s",
      },
    },

    atmosphere: {
      aboveModel: "vacuum",
    },
  };
}


// =============================================================================
// 3. RUN / REDUCE ONE SIMULATION
// =============================================================================

function valueOrNull(metric) {
  return metric && Number.isFinite(metric.value)
    ? metric.value
    : null;
}

function getStageBurnoutTimes(events) {
  return events
    .filter((event) => event.type === "stageBurnout")
    .sort((a, b) => a.stageIndex - b.stageIndex)
    .map((event) => event.time);
}

/**
 * Interpolate one history quantity at the first upward crossing of a fixed
 * geometric altitude. This gives us a timestep-comparable Mach metric without
 * relying on the sample nearest the 86 km atmosphere/vacuum boundary.
 */
function interpolateAtAltitude(history, targetAltitudeM, selector) {
  for (let index = 1; index < history.length; index += 1) {
    const lower = history[index - 1];
    const upper = history[index];

    const lowerAltitude = lower.diagnostics.altitude;
    const upperAltitude = upper.diagnostics.altitude;

    if (
      lowerAltitude <= targetAltitudeM &&
      upperAltitude >= targetAltitudeM &&
      upperAltitude !== lowerAltitude
    ) {
      const lowerValue = selector(lower);
      const upperValue = selector(upper);

      if (!Number.isFinite(lowerValue) || !Number.isFinite(upperValue)) {
        return null;
      }

      const fraction =
        (targetAltitudeM - lowerAltitude) /
        (upperAltitude - lowerAltitude);

      return (
        lowerValue +
        (upperValue - lowerValue) * fraction
      );
    }
  }

  return null;
}

function runCase(dt) {
  const prepared =
    prepareSimulationInput(
      createRawInput(dt)
    );

  const result =
    runSimulation(
      prepared.simulationConfig
    );

  return Object.freeze({
    dt,
    integrationSteps: result.summary.integrationSteps,
    finalTimeS: result.finalTime,
    terminationReason: result.summary.terminationReason,

    maxAltitudeM: valueOrNull(result.summary.maxAltitude),
    maxSpeedMps: valueOrNull(result.summary.maxSpeed),
    maxMach: valueOrNull(result.summary.maxMach),
    machAt50Km: interpolateAtAltitude(
      result.history,
      50_000,
      (sample) => sample.diagnostics.aerodynamics.mach
    ),
    maxQPa: valueOrNull(result.summary.maxQ),

    stageBurnoutTimesS:
      Object.freeze(
        getStageBurnoutTimes(result.events)
      ),

    finalMassKg: result.finalState.mass,

    periapsisAltitudeM:
      result.orbitReport.orbit.periapsisAltitude,

    apoapsisAltitudeM:
      result.orbitReport.orbit.apoapsisAltitude,

    eccentricity:
      result.orbitReport.orbit.eccentricity,

    orbitClassification:
      result.orbitReport.basicClassification,
  });
}

const results =
  Object.freeze(
    TIME_STEPS_S.map(runCase)
  );

const fineReference =
  results.find(
    (result) => result.dt === REFERENCE_DT_S
  );

const defaultResult =
  results.find(
    (result) => result.dt === PROJECT_DEFAULT_DT_S
  );

if (!fineReference || !defaultResult) {
  throw new Error(
    "Convergence test could not locate the default or finest timestep run."
  );
}


// =============================================================================
// 4. COMPARISON HELPERS
// =============================================================================

function absoluteDifference(a, b) {
  return Math.abs(a - b);
}

function relativeDifferencePercent(value, reference) {
  if (!Number.isFinite(value) || !Number.isFinite(reference)) {
    return Infinity;
  }

  if (reference === 0) {
    return value === 0
      ? 0
      : Infinity;
  }

  return (
    Math.abs(value - reference) /
    Math.abs(reference)
  ) * 100;
}

function scientific(value, digits = 6) {
  return Number.isFinite(value)
    ? value.toExponential(digits)
    : "—";
}

function fixed(value, digits = 6) {
  return Number.isFinite(value)
    ? value.toFixed(digits)
    : "—";
}

function pad(value, width) {
  return String(value).padStart(width, " ");
}


// =============================================================================
// 5. DEFAULT-vs-FINE ACCEPTANCE CHECKS
// =============================================================================

const continuousChecks = Object.freeze([
  Object.freeze({
    name: "Maximum altitude",
    model: defaultResult.maxAltitudeM,
    reference: fineReference.maxAltitudeM,
  }),
  Object.freeze({
    name: "Maximum speed",
    model: defaultResult.maxSpeedMps,
    reference: fineReference.maxSpeedMps,
  }),
  Object.freeze({
    name: "Mach at 50 km geometric altitude",
    model: defaultResult.machAt50Km,
    reference: fineReference.machAt50Km,
  }),
  Object.freeze({
    name: "Maximum dynamic pressure",
    model: defaultResult.maxQPa,
    reference: fineReference.maxQPa,
  }),
  Object.freeze({
    name: "Periapsis altitude",
    model: defaultResult.periapsisAltitudeM,
    reference: fineReference.periapsisAltitudeM,
  }),
  Object.freeze({
    name: "Apoapsis altitude",
    model: defaultResult.apoapsisAltitudeM,
    reference: fineReference.apoapsisAltitudeM,
  }),
  Object.freeze({
    name: "Eccentricity",
    model: defaultResult.eccentricity,
    reference: fineReference.eccentricity,
  }),
].map((check) => {
  const differencePercent =
    relativeDifferencePercent(
      check.model,
      check.reference
    );

  return Object.freeze({
    ...check,
    differencePercent,
    tolerancePercent:
      MAX_DEFAULT_VS_FINE_RELATIVE_DIFFERENCE_PERCENT,
    pass:
      differencePercent <=
      MAX_DEFAULT_VS_FINE_RELATIVE_DIFFERENCE_PERCENT,
  });
}));

const eventChecks = [];

const eventCount = Math.min(
  defaultResult.stageBurnoutTimesS.length,
  fineReference.stageBurnoutTimesS.length
);

for (let index = 0; index < eventCount; index += 1) {
  const model = defaultResult.stageBurnoutTimesS[index];
  const reference = fineReference.stageBurnoutTimesS[index];
  const differenceS = absoluteDifference(model, reference);

  eventChecks.push(
    Object.freeze({
      name: `Stage ${index + 1} burnout time`,
      model,
      reference,
      differenceS,
      toleranceS: MAX_EVENT_TIME_DIFFERENCE_S,
      pass: differenceS <= MAX_EVENT_TIME_DIFFERENCE_S,
    })
  );
}

const eventCountPass =
  defaultResult.stageBurnoutTimesS.length ===
  fineReference.stageBurnoutTimesS.length;

const finalMassDifferenceKg =
  absoluteDifference(
    defaultResult.finalMassKg,
    fineReference.finalMassKg
  );

const finalMassPass =
  finalMassDifferenceKg <=
  MAX_FINAL_MASS_DIFFERENCE_KG;

const classificationPass =
  defaultResult.orbitClassification ===
  fineReference.orbitClassification;

const terminationPass =
  defaultResult.terminationReason ===
  fineReference.terminationReason;

const allContinuousPass =
  continuousChecks.every((check) => check.pass);

const allEventsPass =
  eventCountPass &&
  eventChecks.every((check) => check.pass);

const overallPass =
  allContinuousPass &&
  allEventsPass &&
  finalMassPass &&
  classificationPass &&
  terminationPass;


// =============================================================================
// 6. CONSOLE REPORT
// =============================================================================

console.log("RK4 FULL-SIMULATION TIMESTEP-CONVERGENCE VALIDATION");
console.log("===================================================");
console.log("Model under test: integrated Analyzer simulation stack");
console.log("Integrator:       classical RK4");
console.log("Vehicle:          Example Two-Stage Vehicle");
console.log("Guidance:         built-in generic assumed profile");
console.log("Cd model:         built-in generic assumed Mach-Cd table");
console.log("Only quantity changed between runs: solver.dt");
console.log("");
console.log(`Timesteps tested: ${TIME_STEPS_S.join(", ")} s`);
console.log(`Project default:  ${PROJECT_DEFAULT_DT_S} s`);
console.log(`Fine reference:   ${REFERENCE_DT_S} s`);
console.log("");

console.log("RUN RESULTS");
console.log("-----------");
console.log(
  " dt(s)   steps    maxAlt(km)   maxSpeed(km/s)   Mach@50km   maxQ(kPa)   peri(km)      apo(km)        ecc"
);

for (const result of results) {
  console.log(
    `${pad(fixed(result.dt, 2), 6)}` +
    `${pad(result.integrationSteps, 8)}` +
    `${pad(fixed(result.maxAltitudeM / 1000, 6), 14)}` +
    `${pad(fixed(result.maxSpeedMps / 1000, 9), 18)}` +
    `${pad(fixed(result.machAt50Km, 7), 12)}` +
    `${pad(fixed(result.maxQPa / 1000, 6), 13)}` +
    `${pad(fixed(result.periapsisAltitudeM / 1000, 6), 13)}` +
    `${pad(fixed(result.apoapsisAltitudeM / 1000, 6), 15)}` +
    `${pad(fixed(result.eccentricity, 9), 13)}`
  );
}

console.log("");
console.log("STAGE BURNOUT TIMES");
console.log("-------------------");
for (const result of results) {
  const times = result.stageBurnoutTimesS
    .map((time, index) => `S${index + 1}=${fixed(time, 9)} s`)
    .join("  ");

  console.log(
    `dt=${fixed(result.dt, 2)} s  ${times}`
  );
}

console.log("");
console.log("MAXIMUM MACH DIAGNOSTIC (NOT AN ACCEPTANCE METRIC)");
console.log("-------------------------------------------------");
for (const result of results) {
  console.log(
    `dt=${fixed(result.dt, 2)} s  maximum reported Mach=${fixed(result.maxMach, 9)}`
  );
}
console.log(
  "Maximum reported Mach is intentionally excluded from PASS/FAIL because Mach becomes undefined above the 86 km atmosphere-model boundary; the last sub-86-km sample therefore shifts with timestep."
);
console.log(
  "Mach at a fixed 50 km geometric altitude is used instead."
);

console.log("");
console.log("DEFAULT dt = 0.2 s VS FINE dt = 0.05 s");
console.log("---------------------------------------");

for (const check of continuousChecks) {
  console.log(
    `${check.pass ? "PASS" : "FAIL"}  ${check.name}`
  );
  console.log(
    `      dt=0.2: ${fixed(check.model, 12)}`
  );
  console.log(
    `      dt=0.05:${fixed(check.reference, 12)}`
  );
  console.log(
    `      relative difference=${scientific(check.differencePercent)} %`
  );
  console.log(
    `      tolerance=${fixed(check.tolerancePercent, 5)} %`
  );
}

for (const check of eventChecks) {
  console.log(
    `${check.pass ? "PASS" : "FAIL"}  ${check.name}`
  );
  console.log(
    `      dt=0.2: ${fixed(check.model, 12)} s`
  );
  console.log(
    `      dt=0.05:${fixed(check.reference, 12)} s`
  );
  console.log(
    `      difference=${scientific(check.differenceS)} s`
  );
  console.log(
    `      tolerance=${fixed(check.toleranceS, 3)} s`
  );
}

console.log(
  `${finalMassPass ? "PASS" : "FAIL"}  Final mass consistency`
);
console.log(
  `      dt=0.2: ${fixed(defaultResult.finalMassKg, 9)} kg`
);
console.log(
  `      dt=0.05:${fixed(fineReference.finalMassKg, 9)} kg`
);
console.log(
  `      difference=${scientific(finalMassDifferenceKg)} kg`
);
console.log(
  `      tolerance=${scientific(MAX_FINAL_MASS_DIFFERENCE_KG)} kg`
);

console.log(
  `${classificationPass ? "PASS" : "FAIL"}  Orbit classification unchanged (${defaultResult.orbitClassification})`
);
console.log(
  `${terminationPass ? "PASS" : "FAIL"}  Termination reason unchanged (${defaultResult.terminationReason})`
);
console.log("");

console.log("ACCEPTANCE CRITERION");
console.log("--------------------");
console.log(
  `For the project default dt=${PROJECT_DEFAULT_DT_S} s, selected continuous outputs must differ by <= ${MAX_DEFAULT_VS_FINE_RELATIVE_DIFFERENCE_PERCENT}% from the dt=${REFERENCE_DT_S} s run.`
);
console.log(
  `Stage-burnout times must differ by <= ${MAX_EVENT_TIME_DIFFERENCE_S} s, final mass must agree within ${MAX_FINAL_MASS_DIFFERENCE_KG} kg, and classifications must remain unchanged.`
);
console.log(
  "These are numerical-convergence criteria only. They do not measure real-world launch accuracy."
);
console.log("");

const worstContinuousCheck =
  continuousChecks.reduce(
    (worst, current) =>
      current.differencePercent > worst.differencePercent
        ? current
        : worst,
    continuousChecks[0]
  );

console.log("SUMMARY");
console.log("=======");
console.log(
  `Default timestep:                   ${PROJECT_DEFAULT_DT_S} s`
);
console.log(
  `Fine comparison timestep:           ${REFERENCE_DT_S} s`
);
console.log(
  `Worst default-vs-fine difference:   ${scientific(worstContinuousCheck.differencePercent)} % (${worstContinuousCheck.name})`
);
console.log(
  `Allowed continuous difference:      ${fixed(MAX_DEFAULT_VS_FINE_RELATIVE_DIFFERENCE_PERCENT, 5)} %`
);
console.log(
  `Default integration steps:          ${defaultResult.integrationSteps}`
);
console.log(
  `Fine integration steps:             ${fineReference.integrationSteps}`
);
console.log(
  `Result:                             ${overallPass ? "PASS" : "FAIL"}`
);

if (!overallPass) {
  process.exitCode = 1;
}
