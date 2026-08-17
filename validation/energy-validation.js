/**
 * @file energy-validation.js
 * @description RK4 conservation test for physics/integrator.js using an independent
 * Newtonian two-body gravity derivative. A 200 km circular orbit is propagated for
 * 100 one-second steps with thrust, drag, staging, and mass flow disabled. Maximum
 * specific-energy drift is evaluated over the complete history.
 */
import {
  MU_EARTH,
  R_EARTH,
} from "../physics/constants.js";

import {
  integrateStep,
} from "../physics/integrator.js";


// =============================================================================
// 1. TEST DEFINITION
// =============================================================================

const TEST_ALTITUDE_M = 200_000;
const TEST_MASS_KG = 1_000;
const TIME_STEP_S = 1;
const STEP_COUNT = 100;

/**
 * Acceptance criterion chosen for the project validation plan:
 *
 *   maximum |relative energy drift| <= 0.01%
 *
 * This is a NUMERICAL implementation tolerance, not a statement about
 * real-world orbital-model accuracy. The two-body model itself ignores
 * perturbations such as J2, atmospheric drag, third-body gravity, etc.
 *
 * The maximum drift is evaluated over the complete 100-step history, not merely
 * the final value, so an intermediate excursion cannot be hidden by later
 * cancellation.
 */
const MAX_ENERGY_DRIFT_PERCENT = 0.01;


// =============================================================================
// 2. INDEPENDENT TWO-BODY REFERENCE HELPERS
// =============================================================================

function magnitude2(x, y) {
  return Math.hypot(x, y);
}


function circularSpeed(mu, radius) {
  return Math.sqrt(mu / radius);
}


function specificMechanicalEnergy(state, mu = MU_EARTH) {
  const radius = magnitude2(state.x, state.y);
  const speed = magnitude2(state.vx, state.vy);

  return (
    0.5 * speed * speed -
    mu / radius
  );
}


function specificAngularMomentum(state) {
  return (
    state.x * state.vy -
    state.y * state.vx
  );
}


/**
 * Independent two-body derivative used only by this validation test.
 *
 *   r'' = -mu * r / |r|^3
 *
 * Mass is constant because this is a vacuum coast test.
 */
function twoBodyDerivative(_time, state) {
  const radius = magnitude2(state.x, state.y);

  if (!(radius > 0)) {
    throw new RangeError("Orbital radius must be greater than zero.");
  }

  const factor = -MU_EARTH / (radius * radius * radius);

  return {
    dxdt: state.vx,
    dydt: state.vy,
    dvxdt: factor * state.x,
    dvydt: factor * state.y,
    dmdt: 0,
  };
}


// =============================================================================
// 3. INITIAL CIRCULAR-ORBIT STATE
// =============================================================================

const initialRadiusM =
  R_EARTH + TEST_ALTITUDE_M;

const initialCircularSpeedMps =
  circularSpeed(
    MU_EARTH,
    initialRadiusM
  );

const initialState = Object.freeze({
  x: initialRadiusM,
  y: 0,
  vx: 0,
  vy: initialCircularSpeedMps,
  mass: TEST_MASS_KG,
});

const initialEnergy =
  specificMechanicalEnergy(initialState);

const initialAngularMomentum =
  specificAngularMomentum(initialState);


// =============================================================================
// 4. PROPAGATE WITH THE EXISTING RK4 INTEGRATOR
// =============================================================================

let time = 0;
let state = initialState;

const history = [
  Object.freeze({
    step: 0,
    time,
    state,
    energy: initialEnergy,
    angularMomentum: initialAngularMomentum,
    energyDriftPercent: 0,
  }),
];

for (
  let step = 1;
  step <= STEP_COUNT;
  step += 1
) {
  state = integrateStep({
    derivativeFunction: twoBodyDerivative,
    time,
    state,
    dt: TIME_STEP_S,
    method: "rk4",
  });

  time += TIME_STEP_S;

  const energy =
    specificMechanicalEnergy(state);

  const angularMomentum =
    specificAngularMomentum(state);

  const energyDriftPercent =
    Math.abs(
      (energy - initialEnergy) /
      initialEnergy
    ) * 100;

  history.push(
    Object.freeze({
      step,
      time,
      state,
      energy,
      angularMomentum,
      energyDriftPercent,
    })
  );
}


// =============================================================================
// 5. RESULT REDUCTION
// =============================================================================

const finalSample =
  history[history.length - 1];

let maximumEnergyDriftSample =
  history[0];

for (const sample of history) {
  if (
    sample.energyDriftPercent >
    maximumEnergyDriftSample.energyDriftPercent
  ) {
    maximumEnergyDriftSample = sample;
  }
}

const finalEnergyDifference =
  finalSample.energy - initialEnergy;

const finalEnergyDriftPercent =
  Math.abs(
    finalEnergyDifference /
    initialEnergy
  ) * 100;

const finalAngularMomentumDifference =
  finalSample.angularMomentum -
  initialAngularMomentum;

const finalAngularMomentumDriftPercent =
  Math.abs(
    finalAngularMomentumDifference /
    initialAngularMomentum
  ) * 100;

const passed =
  maximumEnergyDriftSample.energyDriftPercent <=
  MAX_ENERGY_DRIFT_PERCENT;


// =============================================================================
// 6. CONSOLE REPORT
// =============================================================================

function scientific(value, digits = 6) {
  return Number(value).toExponential(digits);
}


function fixed(value, digits = 12) {
  return Number(value).toFixed(digits);
}


console.log("RK4 TWO-BODY ENERGY-CONSERVATION VALIDATION");
console.log("===========================================");
console.log("Model under test: physics/integrator.js (RK4)");
console.log("Force field: independent Newtonian two-body gravity");
console.log("Atmosphere: OFF");
console.log("Drag: OFF");
console.log("Thrust: OFF");
console.log("Mass flow: OFF");
console.log("");
console.log(`Earth radius used:       ${R_EARTH.toLocaleString("en-US")} m`);
console.log(`Earth mu used:           ${MU_EARTH.toExponential(9)} m^3/s^2`);
console.log(`Initial altitude:        ${(TEST_ALTITUDE_M / 1000).toFixed(0)} km`);
console.log(`Initial orbital speed:   ${(initialCircularSpeedMps / 1000).toFixed(9)} km/s`);
console.log(`RK4 time step:           ${TIME_STEP_S} s`);
console.log(`RK4 steps:               ${STEP_COUNT}`);
console.log(`Propagation duration:    ${time} s`);
console.log("");

console.log("ENERGY");
console.log("------");
console.log(`Initial specific energy: ${fixed(initialEnergy, 12)} J/kg`);
console.log(`Final specific energy:   ${fixed(finalSample.energy, 12)} J/kg`);
console.log(`Final difference:        ${scientific(finalEnergyDifference, 9)} J/kg`);
console.log(`Final relative drift:    ${scientific(finalEnergyDriftPercent, 9)} %`);
console.log(`Maximum relative drift:  ${scientific(maximumEnergyDriftSample.energyDriftPercent, 9)} %`);
console.log(`Maximum drift at step:   ${maximumEnergyDriftSample.step} (t=${maximumEnergyDriftSample.time} s)`);
console.log("");

console.log("SECONDARY CONSERVATION CHECK");
console.log("----------------------------");
console.log(`Initial angular momentum: ${fixed(initialAngularMomentum, 9)} m^2/s`);
console.log(`Final angular momentum:   ${fixed(finalSample.angularMomentum, 9)} m^2/s`);
console.log(`Relative drift:           ${scientific(finalAngularMomentumDriftPercent, 9)} %`);
console.log("");

console.log("SELECTED HISTORY");
console.log("----------------");
for (const selectedStep of [0, 25, 50, 75, 100]) {
  const sample = history[selectedStep];

  console.log(
    `Step ${String(selectedStep).padStart(3)}  ` +
    `t=${String(sample.time).padStart(3)} s  ` +
    `energy=${fixed(sample.energy, 9)} J/kg  ` +
    `drift=${scientific(sample.energyDriftPercent, 6)} %`
  );
}
console.log("");

console.log("ACCEPTANCE CRITERION");
console.log("--------------------");
console.log(
  `Maximum energy drift must remain <= ${MAX_ENERGY_DRIFT_PERCENT}% ` +
  `over all ${STEP_COUNT} RK4 steps.`
);
console.log(
  "This tolerance tests numerical implementation/step-size behavior; " +
  "it is not a physical-accuracy uncertainty for the real Earth."
);
console.log("");

console.log("SUMMARY");
console.log("=======");
console.log(`Maximum energy drift:    ${scientific(maximumEnergyDriftSample.energyDriftPercent, 9)} %`);
console.log(`Allowed drift:           ${MAX_ENERGY_DRIFT_PERCENT.toFixed(5)} %`);
console.log(`Result:                  ${passed ? "PASS" : "FAIL"}`);

if (!passed) {
  process.exitCode = 1;
}
