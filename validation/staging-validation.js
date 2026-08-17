/**
 * @file staging-validation.js
 * @description Mass-ledger and serial-stage event-integrity verification for
 * physics/staging.js and analyzer/simulation.js. Checks analytical stack masses,
 * propellant depletion, residual handling, burnout/separation ordering, configured
 * delays, separation mass, state continuity, stage flags, and final mass closure.
 */
import {
  prepareSimulationInput,
} from "../analyzer/input-adapter.js";

import {
  runSimulation,
} from "../analyzer/simulation.js";

import {
  createStage,
  createVehicle,
  getVehicleInitialMass,
  getStageUsablePropellantMass,
  getStageBurnoutOwnMass,
} from "../physics/vehicle-model.js";

import {
  createInitialStagingState,
  consumeActiveStagePropellant,
  separateActiveStage,
  getActiveStageState,
  isActiveStageBurnedOut,
} from "../physics/staging.js";


// =============================================================================
// 1. ACCEPTANCE CRITERIA
// =============================================================================

/**
 * Mass bookkeeping is exact in principle. The check allows 1 milligram of
 * absolute numerical slack because JavaScript uses binary floating-point
 * arithmetic and later configurations may use non-integer engineering data.
 *
 * This is a NUMERICAL tolerance, not a physical uncertainty.
 */
const MASS_TOLERANCE_KG = 1e-6;

/**
 * The event-aware orchestrator uses a small event-time tolerance. For this
 * integrity test, the observed separation delay must reproduce the configured
 * delay to within 10 ns.
 *
 * Again, this is software event-resolution tolerance, not launch-timing
 * accuracy for a real vehicle.
 */
const EVENT_TIME_TOLERANCE_S = 1e-8;

/**
 * Idealized separation intentionally copies x, y, vx, vy unchanged. A tiny
 * absolute tolerance keeps the check robust to harmless future arithmetic
 * refactors while remaining far below any meaningful flight scale.
 */
const STATE_CONTINUITY_TOLERANCE = 1e-12;


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

function createRawInput() {
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
      launchAltitude: { value: 0, unit: "m" },
      velocityX: 0,
      velocityY: { value: 0, unit: "m/s" },
    },

    mission: {
      targetPeriapsisAltitude: { value: 200, unit: "km" },
      targetApoapsisAltitude: { value: 200, unit: "km" },
      altitudeTolerance: { value: 20, unit: "km" },
    },

    solver: {
      method: "rk4",
      dt: { value: 0.2, unit: "s" },
      maxTime: { value: 900, unit: "s" },
      recordEveryNSteps: 1,
    },

    propulsion: {
      engineOn: true,
      throttle: 1,
    },

    air: {
      velocityX: { value: 0, unit: "m/s" },
      velocityY: { value: 0, unit: "m/s" },
    },

    atmosphere: {
      aboveModel: "vacuum",
    },
  };
}

const prepared = prepareSimulationInput(createRawInput());
const vehicle = prepared.simulationConfig.vehicle;


// =============================================================================
// 3. TEST HELPERS
// =============================================================================

const checks = [];

function absoluteDifference(a, b) {
  return Math.abs(a - b);
}

function within(value, reference, tolerance) {
  return absoluteDifference(value, reference) <= tolerance;
}

function recordCheck(name, pass, details = []) {
  checks.push(Object.freeze({ name, pass, details: Object.freeze([...details]) }));
}

function fixed(value, digits = 12) {
  return Number.isFinite(value) ? value.toFixed(digits) : String(value);
}

function scientific(value, digits = 6) {
  return Number.isFinite(value) ? value.toExponential(digits) : String(value);
}

function printCheck(check) {
  console.log(`${check.pass ? "PASS" : "FAIL"}  ${check.name}`);
  for (const detail of check.details) {
    console.log(`      ${detail}`);
  }
}


// =============================================================================
// 4. ANALYTICAL MASS LEDGER
// =============================================================================

const stage1 = vehicle.stages[0];
const stage2 = vehicle.stages[1];

const stage1UsablePropellant = getStageUsablePropellantMass(stage1);
const stage2UsablePropellant = getStageUsablePropellantMass(stage2);
const stage1DiscardMass = getStageBurnoutOwnMass(stage1);
const stage2DiscardMass = getStageBurnoutOwnMass(stage2);
const expectedInitialMass = getVehicleInitialMass(vehicle);

const expectedStage1BurnoutMass =
  expectedInitialMass - stage1UsablePropellant;

const expectedAfterStage1SeparationMass =
  expectedStage1BurnoutMass - stage1DiscardMass;

const expectedStage2BurnoutMass =
  expectedAfterStage1SeparationMass - stage2UsablePropellant;

const expectedFinalMass =
  expectedStage2BurnoutMass - stage2DiscardMass;

const expectedTotalUsablePropellant =
  stage1UsablePropellant + stage2UsablePropellant;

const expectedTotalDiscardedMass =
  stage1DiscardMass + stage2DiscardMass;


// =============================================================================
// 5. CONTROLLED STAGING.JS BOOKKEEPING TEST
// =============================================================================

let controlledRuntime = createInitialStagingState(vehicle);

const controlledInitialState = Object.freeze({
  x: 6_371_000,
  y: 123,
  vx: 45,
  vy: 67,
  mass: expectedInitialMass,
});

recordCheck(
  "Initial vehicle mass matches analytical stack sum",
  within(controlledInitialState.mass, expectedInitialMass, MASS_TOLERANCE_KG),
  [
    `model=${fixed(controlledInitialState.mass, 9)} kg`,
    `expected=${fixed(expectedInitialMass, 9)} kg`,
    `tolerance=${scientific(MASS_TOLERANCE_KG)} kg`,
  ]
);

recordCheck(
  "Stage 1 usable propellant bookkeeping",
  within(
    getActiveStageState(controlledRuntime).remainingUsablePropellant,
    stage1UsablePropellant,
    MASS_TOLERANCE_KG
  ),
  [
    `runtime=${fixed(getActiveStageState(controlledRuntime).remainingUsablePropellant, 9)} kg`,
    `expected=${fixed(stage1UsablePropellant, 9)} kg`,
  ]
);

// Burn Stage 1 in a controlled 100 s bookkeeping interval.
const stage1BurnUpdate = consumeActiveStagePropellant({
  runtime: controlledRuntime,
  massFlowRate: stage1UsablePropellant / 100,
  dt: 100,
});
controlledRuntime = stage1BurnUpdate.runtime;

const controlledStage1BurnoutState = Object.freeze({
  ...controlledInitialState,
  mass: controlledInitialState.mass - stage1BurnUpdate.consumedMass,
});

recordCheck(
  "Stage 1 consumes exactly its usable propellant",
  within(stage1BurnUpdate.consumedMass, stage1UsablePropellant, MASS_TOLERANCE_KG),
  [
    `consumed=${fixed(stage1BurnUpdate.consumedMass, 9)} kg`,
    `expected=${fixed(stage1UsablePropellant, 9)} kg`,
  ]
);

recordCheck(
  "Stage 1 is marked burned out with zero usable propellant",
  isActiveStageBurnedOut(controlledRuntime) &&
    within(
      getActiveStageState(controlledRuntime).remainingUsablePropellant,
      0,
      MASS_TOLERANCE_KG
    ),
  [
    `remaining=${scientific(getActiveStageState(controlledRuntime).remainingUsablePropellant)} kg`,
  ]
);

recordCheck(
  "Stage 1 burnout stack mass matches analytical ledger",
  within(
    controlledStage1BurnoutState.mass,
    expectedStage1BurnoutMass,
    MASS_TOLERANCE_KG
  ),
  [
    `model=${fixed(controlledStage1BurnoutState.mass, 9)} kg`,
    `expected=${fixed(expectedStage1BurnoutMass, 9)} kg`,
  ]
);

const stage1Separation = separateActiveStage({
  vehicle,
  runtime: controlledRuntime,
  state: controlledStage1BurnoutState,
});
controlledRuntime = stage1Separation.runtime;

recordCheck(
  "Stage 1 separation discards dry + residual mass",
  within(stage1Separation.event.discardedMass, stage1DiscardMass, MASS_TOLERANCE_KG),
  [
    `discarded=${fixed(stage1Separation.event.discardedMass, 9)} kg`,
    `expected=${fixed(stage1DiscardMass, 9)} kg`,
  ]
);

recordCheck(
  "Stage 1 post-separation mass matches analytical ledger",
  within(
    stage1Separation.state.mass,
    expectedAfterStage1SeparationMass,
    MASS_TOLERANCE_KG
  ),
  [
    `model=${fixed(stage1Separation.state.mass, 9)} kg`,
    `expected=${fixed(expectedAfterStage1SeparationMass, 9)} kg`,
  ]
);

recordCheck(
  "Idealized Stage 1 separation preserves position and velocity",
  ["x", "y", "vx", "vy"].every((key) =>
    within(
      stage1Separation.state[key],
      controlledStage1BurnoutState[key],
      STATE_CONTINUITY_TOLERANCE
    )
  ),
  [
    `state continuity tolerance=${scientific(STATE_CONTINUITY_TOLERANCE)}`,
  ]
);

recordCheck(
  "Stage 2 becomes active after Stage 1 separation",
  controlledRuntime.activeStageIndex === 1 &&
    controlledRuntime.stageStates[0].separated === true &&
    controlledRuntime.stageStates[0].active === false &&
    controlledRuntime.stageStates[1].active === true &&
    controlledRuntime.allStagesComplete === false,
  [
    `activeStageIndex=${controlledRuntime.activeStageIndex}`,
  ]
);

// Burn Stage 2 in a controlled 100 s bookkeeping interval.
const stage2BurnUpdate = consumeActiveStagePropellant({
  runtime: controlledRuntime,
  massFlowRate: stage2UsablePropellant / 100,
  dt: 100,
});
controlledRuntime = stage2BurnUpdate.runtime;

const controlledStage2BurnoutState = Object.freeze({
  ...stage1Separation.state,
  mass: stage1Separation.state.mass - stage2BurnUpdate.consumedMass,
});

recordCheck(
  "Stage 2 consumes exactly its usable propellant",
  within(stage2BurnUpdate.consumedMass, stage2UsablePropellant, MASS_TOLERANCE_KG),
  [
    `consumed=${fixed(stage2BurnUpdate.consumedMass, 9)} kg`,
    `expected=${fixed(stage2UsablePropellant, 9)} kg`,
  ]
);

recordCheck(
  "Stage 2 burnout stack mass matches analytical ledger",
  within(
    controlledStage2BurnoutState.mass,
    expectedStage2BurnoutMass,
    MASS_TOLERANCE_KG
  ),
  [
    `model=${fixed(controlledStage2BurnoutState.mass, 9)} kg`,
    `expected=${fixed(expectedStage2BurnoutMass, 9)} kg`,
  ]
);

const stage2Separation = separateActiveStage({
  vehicle,
  runtime: controlledRuntime,
  state: controlledStage2BurnoutState,
});
controlledRuntime = stage2Separation.runtime;

recordCheck(
  "Stage 2 separation discards dry + residual mass",
  within(stage2Separation.event.discardedMass, stage2DiscardMass, MASS_TOLERANCE_KG),
  [
    `discarded=${fixed(stage2Separation.event.discardedMass, 9)} kg`,
    `expected=${fixed(stage2DiscardMass, 9)} kg`,
  ]
);

recordCheck(
  "Final controlled mass equals analytical payload-only mass",
  within(stage2Separation.state.mass, expectedFinalMass, MASS_TOLERANCE_KG),
  [
    `model=${fixed(stage2Separation.state.mass, 9)} kg`,
    `expected=${fixed(expectedFinalMass, 9)} kg`,
  ]
);

recordCheck(
  "Final controlled runtime marks all stages complete",
  controlledRuntime.allStagesComplete === true &&
    controlledRuntime.stageStates.every((stageState) =>
      stageState.burnedOut === true &&
      stageState.separated === true &&
      stageState.active === false
    ),
  [
    `allStagesComplete=${controlledRuntime.allStagesComplete}`,
  ]
);


// =============================================================================
// 6. RESIDUAL-PROPELLANT EDGE CASE
// =============================================================================

/**
 * The Analyzer example has zero residual propellant in both stages. A small
 * synthetic one-stage case verifies the separate bookkeeping rule that
 * residual propellant remains attached at burnout and is discarded with the
 * stage at separation.
 */
const residualTestStage = createStage({
  id: "residual-test-stage",
  name: "Residual Test Stage",
  masses: {
    dryMass: 1_000,
    propellantMass: 10_000,
    residualPropellantMass: 500,
  },
  propulsion: {
    thrustSeaLevel: 100_000,
    thrustVacuum: 110_000,
    ispSeaLevel: 250,
    ispVacuum: 270,
  },
  aerodynamics: {
    referenceArea: 1,
    cdModelId: null,
  },
  separationDelay: 0,
});

const residualTestVehicle = createVehicle({
  id: "residual-test-vehicle",
  name: "Residual Test Vehicle",
  payloadMass: 100,
  stages: [residualTestStage],
});

let residualRuntime = createInitialStagingState(residualTestVehicle);
const residualInitialMass = getVehicleInitialMass(residualTestVehicle);
const residualUsableMass = getStageUsablePropellantMass(residualTestStage);
const residualDiscardMass = getStageBurnoutOwnMass(residualTestStage);

const residualBurn = consumeActiveStagePropellant({
  runtime: residualRuntime,
  massFlowRate: residualUsableMass / 10,
  dt: 10,
});
residualRuntime = residualBurn.runtime;

const residualBurnoutState = Object.freeze({
  x: 6_371_000,
  y: 0,
  vx: 0,
  vy: 0,
  mass: residualInitialMass - residualBurn.consumedMass,
});

const residualSeparation = separateActiveStage({
  vehicle: residualTestVehicle,
  runtime: residualRuntime,
  state: residualBurnoutState,
});

recordCheck(
  "Residual propellant remains in burnout mass and is discarded at separation",
  within(residualBurn.consumedMass, 9_500, MASS_TOLERANCE_KG) &&
    within(residualBurnoutState.mass, 1_600, MASS_TOLERANCE_KG) &&
    within(residualSeparation.event.discardedMass, 1_500, MASS_TOLERANCE_KG) &&
    within(residualSeparation.state.mass, 100, MASS_TOLERANCE_KG),
  [
    `usable propellant burned=${fixed(residualBurn.consumedMass, 6)} kg (expected 9500)`,
    `burnout mass=${fixed(residualBurnoutState.mass, 6)} kg (payload + dry + residual = 1600)`,
    `discarded mass=${fixed(residualSeparation.event.discardedMass, 6)} kg (dry + residual = 1500)`,
    `final payload mass=${fixed(residualSeparation.state.mass, 6)} kg (expected 100)`,
  ]
);


// =============================================================================
// 7. INTEGRATED ANALYZER EVENT TEST
// =============================================================================

const integratedResult = runSimulation(prepared.simulationConfig);

const stagingEvents = integratedResult.events.filter((event) =>
  event.type === "stageBurnout" || event.type === "stageSeparation"
);

const expectedEventSignature = [
  "stageBurnout:0",
  "stageSeparation:0",
  "stageBurnout:1",
  "stageSeparation:1",
];

const observedEventSignature = stagingEvents.map((event) => {
  const stageIndex = event.type === "stageBurnout"
    ? event.stageIndex
    : event.separatedStageIndex;

  return `${event.type}:${stageIndex}`;
});

recordCheck(
  "Integrated staging event order is correct",
  observedEventSignature.length === expectedEventSignature.length &&
    observedEventSignature.every((value, index) => value === expectedEventSignature[index]),
  [
    `observed=${observedEventSignature.join(" -> ")}`,
    `expected=${expectedEventSignature.join(" -> ")}`,
  ]
);

const stage1BurnoutEvent = stagingEvents.find(
  (event) => event.type === "stageBurnout" && event.stageIndex === 0
);
const stage1SeparationEvent = stagingEvents.find(
  (event) => event.type === "stageSeparation" && event.separatedStageIndex === 0
);
const stage2BurnoutEvent = stagingEvents.find(
  (event) => event.type === "stageBurnout" && event.stageIndex === 1
);
const stage2SeparationEvent = stagingEvents.find(
  (event) => event.type === "stageSeparation" && event.separatedStageIndex === 1
);

function historySampleAtTime(history, targetTime) {
  let best = null;
  let bestDifference = Infinity;

  for (const sample of history) {
    const difference = Math.abs(sample.time - targetTime);
    if (difference < bestDifference) {
      best = sample;
      bestDifference = difference;
    }
  }

  return bestDifference <= EVENT_TIME_TOLERANCE_S ? best : null;
}

const stage1BurnoutSample = stage1BurnoutEvent
  ? historySampleAtTime(integratedResult.history, stage1BurnoutEvent.time)
  : null;
const stage2BurnoutSample = stage2BurnoutEvent
  ? historySampleAtTime(integratedResult.history, stage2BurnoutEvent.time)
  : null;
const stage1SeparationPreSample = stage1SeparationEvent
  ? historySampleAtTime(integratedResult.history, stage1SeparationEvent.time)
  : null;

recordCheck(
  "Integrated Stage 1 burnout mass matches analytical ledger",
  Boolean(stage1BurnoutSample) &&
    within(stage1BurnoutSample.state.mass, expectedStage1BurnoutMass, MASS_TOLERANCE_KG),
  [
    `history mass=${fixed(stage1BurnoutSample?.state.mass, 9)} kg`,
    `expected=${fixed(expectedStage1BurnoutMass, 9)} kg`,
  ]
);

recordCheck(
  "Stage 1 coast to separation consumes no additional propellant",
  Boolean(stage1BurnoutSample && stage1SeparationPreSample) &&
    within(
      stage1SeparationPreSample.state.mass,
      stage1BurnoutSample.state.mass,
      MASS_TOLERANCE_KG
    ),
  [
    `burnout mass=${fixed(stage1BurnoutSample?.state.mass, 9)} kg`,
    `pre-separation mass=${fixed(stage1SeparationPreSample?.state.mass, 9)} kg`,
    `configured coast delay=${fixed(stage1.separationDelay, 3)} s`,
  ]
);

recordCheck(
  "Integrated Stage 2 burnout mass matches analytical ledger",
  Boolean(stage2BurnoutSample) &&
    within(stage2BurnoutSample.state.mass, expectedStage2BurnoutMass, MASS_TOLERANCE_KG),
  [
    `history mass=${fixed(stage2BurnoutSample?.state.mass, 9)} kg`,
    `expected=${fixed(expectedStage2BurnoutMass, 9)} kg`,
  ]
);

function checkSeparationDelay({
  name,
  burnoutEvent,
  separationEvent,
  expectedDelay,
}) {
  if (!burnoutEvent || !separationEvent) {
    recordCheck(name, false, ["required event missing"]);
    return;
  }

  const observedDelay = separationEvent.time - burnoutEvent.time;
  const difference = absoluteDifference(observedDelay, expectedDelay);

  recordCheck(
    name,
    difference <= EVENT_TIME_TOLERANCE_S,
    [
      `burnout=${fixed(burnoutEvent.time, 12)} s`,
      `separation=${fixed(separationEvent.time, 12)} s`,
      `observed delay=${fixed(observedDelay, 12)} s`,
      `configured delay=${fixed(expectedDelay, 12)} s`,
      `difference=${scientific(difference)} s`,
      `tolerance=${scientific(EVENT_TIME_TOLERANCE_S)} s`,
    ]
  );
}

checkSeparationDelay({
  name: "Integrated Stage 1 separation delay matches configuration",
  burnoutEvent: stage1BurnoutEvent,
  separationEvent: stage1SeparationEvent,
  expectedDelay: stage1.separationDelay,
});

checkSeparationDelay({
  name: "Integrated Stage 2 separation delay matches configuration",
  burnoutEvent: stage2BurnoutEvent,
  separationEvent: stage2SeparationEvent,
  expectedDelay: stage2.separationDelay,
});

recordCheck(
  "Integrated separation events report correct discarded masses",
  Boolean(stage1SeparationEvent && stage2SeparationEvent) &&
    within(stage1SeparationEvent.discardedMass, stage1DiscardMass, MASS_TOLERANCE_KG) &&
    within(stage2SeparationEvent.discardedMass, stage2DiscardMass, MASS_TOLERANCE_KG),
  [
    `Stage 1 event=${fixed(stage1SeparationEvent?.discardedMass, 9)} kg, expected=${fixed(stage1DiscardMass, 9)} kg`,
    `Stage 2 event=${fixed(stage2SeparationEvent?.discardedMass, 9)} kg, expected=${fixed(stage2DiscardMass, 9)} kg`,
  ]
);

recordCheck(
  "Integrated simulation final mass equals analytical final mass",
  within(integratedResult.finalState.mass, expectedFinalMass, MASS_TOLERANCE_KG),
  [
    `model=${fixed(integratedResult.finalState.mass, 9)} kg`,
    `expected=${fixed(expectedFinalMass, 9)} kg`,
    `tolerance=${scientific(MASS_TOLERANCE_KG)} kg`,
  ]
);

const inferredIntegratedUsablePropellantBurned =
  expectedInitialMass -
  integratedResult.finalState.mass -
  expectedTotalDiscardedMass;

recordCheck(
  "Integrated total propellant consumption closes the mass ledger",
  within(
    inferredIntegratedUsablePropellantBurned,
    expectedTotalUsablePropellant,
    MASS_TOLERANCE_KG
  ),
  [
    `initial mass=${fixed(expectedInitialMass, 9)} kg`,
    `final mass=${fixed(integratedResult.finalState.mass, 9)} kg`,
    `discarded dry/residual mass=${fixed(expectedTotalDiscardedMass, 9)} kg`,
    `inferred propellant burned=${fixed(inferredIntegratedUsablePropellantBurned, 9)} kg`,
    `expected usable propellant=${fixed(expectedTotalUsablePropellant, 9)} kg`,
  ]
);

recordCheck(
  "Integrated final staging state marks all stages burned out and separated",
  integratedResult.finalStagingState.allStagesComplete === true &&
    integratedResult.finalStagingState.stageStates.every((stageState) =>
      stageState.burnedOut === true &&
      stageState.separated === true &&
      stageState.active === false &&
      within(stageState.remainingUsablePropellant, 0, MASS_TOLERANCE_KG)
    ),
  [
    `allStagesComplete=${integratedResult.finalStagingState.allStagesComplete}`,
    `separatedStageCount=${integratedResult.summary.stageSeparationCount}`,
  ]
);

recordCheck(
  "Integrated simulation terminates because all stages complete",
  integratedResult.summary.terminationReason === "allStagesComplete",
  [
    `terminationReason=${integratedResult.summary.terminationReason}`,
  ]
);


// =============================================================================
// 8. REPORT
// =============================================================================

console.log("SERIAL-STAGING MASS & EVENT VALIDATION");
console.log("======================================");
console.log("Models under test: physics/staging.js + analyzer/simulation.js event orchestration");
console.log("Vehicle:           Example Two-Stage Vehicle");
console.log("Integrator:        classical RK4, dt=0.2 s (integrated portion)");
console.log("Purpose:           mass-ledger and discrete-event integrity");
console.log("");

console.log("ANALYTICAL MASS LEDGER");
console.log("----------------------");
console.log(`Payload mass:                    ${fixed(vehicle.payloadMass, 3)} kg`);
console.log(`Stage 1 dry mass:                ${fixed(stage1.masses.dryMass, 3)} kg`);
console.log(`Stage 1 usable propellant:       ${fixed(stage1UsablePropellant, 3)} kg`);
console.log(`Stage 2 dry mass:                ${fixed(stage2.masses.dryMass, 3)} kg`);
console.log(`Stage 2 usable propellant:       ${fixed(stage2UsablePropellant, 3)} kg`);
console.log(`Initial vehicle mass:            ${fixed(expectedInitialMass, 3)} kg`);
console.log(`Stage 1 burnout mass:            ${fixed(expectedStage1BurnoutMass, 3)} kg`);
console.log(`After Stage 1 separation:        ${fixed(expectedAfterStage1SeparationMass, 3)} kg`);
console.log(`Stage 2 burnout mass:            ${fixed(expectedStage2BurnoutMass, 3)} kg`);
console.log(`Final mass after Stage 2 sep.:   ${fixed(expectedFinalMass, 3)} kg`);
console.log("");

console.log("INTEGRATED EVENT TIMELINE");
console.log("-------------------------");
for (const event of stagingEvents) {
  if (event.type === "stageBurnout") {
    console.log(
      `t=${fixed(event.time, 12)} s  STAGE ${event.stageIndex + 1} BURNOUT`
    );
  } else {
    console.log(
      `t=${fixed(event.time, 12)} s  STAGE ${event.separatedStageIndex + 1} SEPARATION` +
      `  discarded=${fixed(event.discardedMass, 6)} kg`
    );
  }
}
console.log("");

console.log("CHECKS");
console.log("------");
for (const check of checks) {
  printCheck(check);
}
console.log("");

console.log("ACCEPTANCE CRITERIA");
console.log("-------------------");
console.log(`Mass ledger agreement:          <= ${scientific(MASS_TOLERANCE_KG)} kg absolute difference`);
console.log(`Configured event-delay error:   <= ${scientific(EVENT_TIME_TOLERANCE_S)} s`);
console.log(`Separation state continuity:    <= ${scientific(STATE_CONTINUITY_TOLERANCE)} absolute component difference`);
console.log("Event order / stage flags:      exact logical agreement");
console.log("");
console.log("These are software bookkeeping/event-integrity criteria. They do not imply that real launch-vehicle stage-separation dynamics are modeled to these tolerances.");
console.log("");

const failedChecks = checks.filter((check) => !check.pass);

console.log("SUMMARY");
console.log("=======");
console.log(`Checks passed:                   ${checks.length - failedChecks.length}/${checks.length}`);
console.log(`Initial mass:                    ${fixed(expectedInitialMass, 3)} kg`);
console.log(`Total usable propellant:         ${fixed(expectedTotalUsablePropellant, 3)} kg`);
console.log(`Total discarded dry/residual:   ${fixed(expectedTotalDiscardedMass, 3)} kg`);
console.log(`Final mass:                      ${fixed(integratedResult.finalState.mass, 3)} kg`);
console.log(`Stage separations:               ${integratedResult.summary.stageSeparationCount}`);
console.log(`Termination reason:              ${integratedResult.summary.terminationReason}`);
console.log(`Result:                          ${failedChecks.length === 0 ? "PASS" : "FAIL"}`);

if (failedChecks.length > 0) {
  process.exitCode = 1;
}
