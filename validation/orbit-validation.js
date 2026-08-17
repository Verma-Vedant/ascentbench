/**
 * @file orbit-validation.js
 * @description Analytical 200 km circular-orbit verification for physics/orbit.js.
 * Independent two-body equations generate the reference state and expected orbital
 * quantities before the state is evaluated by the production orbit analyzer.
 * Tolerances are numerical implementation tolerances, not real-Earth uncertainty.
 */
import {
  createOrbitReport,
} from "../physics/orbit.js";


// =============================================================================
// 1. INDEPENDENT REFERENCE CASE
// =============================================================================

/**
 * Reference values are written explicitly rather than imported from the
 * project constants so the validation harness does not silently inherit a
 * changed project constant.
 *
 * These are the Earth-model values currently documented by AscentBench:
 *   mu = 3.986004418e14 m^3/s^2
 *   mean spherical radius = 6,371,000 m
 */
const REFERENCE_MU_EARTH = 3.986004418e14;
const REFERENCE_EARTH_RADIUS_M = 6_371_000;
const TEST_ALTITUDE_M = 200_000;

const referenceRadiusM =
  REFERENCE_EARTH_RADIUS_M +
  TEST_ALTITUDE_M;

const referenceCircularSpeedMps =
  Math.sqrt(
    REFERENCE_MU_EARTH /
    referenceRadiusM
  );

const referencePeriodS =
  2 *
  Math.PI *
  Math.sqrt(
    Math.pow(referenceRadiusM, 3) /
    REFERENCE_MU_EARTH
  );

const referenceSpecificEnergy =
  -REFERENCE_MU_EARTH /
  (2 * referenceRadiusM);

const referenceSpecificAngularMomentum =
  referenceRadiusM *
  referenceCircularSpeedMps;


// =============================================================================
// 2. STATE GIVEN TO THE MODEL UNDER TEST
// =============================================================================

/**
 * At the test instant:
 *   +x = radial outward
 *   +y = prograde tangential
 *
 * A circular orbit therefore has zero radial velocity and all velocity in +y.
 */
const state = Object.freeze({
  x: referenceRadiusM,
  y: 0,
  vx: 0,
  vy: referenceCircularSpeedMps,
});

const report =
  createOrbitReport({
    state,
    target: {
      periapsisAltitude:
        TEST_ALTITUDE_M,

      apoapsisAltitude:
        TEST_ALTITUDE_M,

      // Deliberately tight. The constructed state is analytically circular.
      altitudeTolerance: 1,
    },
  });

const orbit = report.orbit;


// =============================================================================
// 3. ERROR HELPERS
// =============================================================================

function absoluteError(
  modelValue,
  referenceValue
) {
  return Math.abs(
    modelValue - referenceValue
  );
}

function relativeErrorPercent(
  modelValue,
  referenceValue
) {
  if (referenceValue === 0) {
    return modelValue === 0
      ? 0
      : Infinity;
  }

  return (
    absoluteError(
      modelValue,
      referenceValue
    ) /
    Math.abs(referenceValue)
  ) * 100;
}

function scientific(value) {
  return Number.isFinite(value)
    ? value.toExponential(6)
    : String(value);
}

function fixed(value, digits = 6) {
  return Number.isFinite(value)
    ? value.toFixed(digits)
    : String(value);
}


// =============================================================================
// 4. TOLERANCES
// =============================================================================

/**
 * These are verification tolerances for floating-point agreement between an
 * analytically constructed circular orbit and the module output. They are NOT
 * claims about real-Earth accuracy.
 */
const TOLERANCES = Object.freeze({
  circularSpeedAbsoluteMps: 1e-6,
  periodAbsoluteS: 1e-6,
  specificEnergyRelativePercent: 1e-9,
  angularMomentumRelativePercent: 1e-9,
  eccentricityAbsolute: 1e-10,
  semiMajorAxisAbsoluteM: 1e-3,
  altitudeAbsoluteM: 1e-3,
  radialVelocityAbsoluteMps: 1e-9,
  tangentialVelocityAbsoluteMps: 1e-6,
});


// =============================================================================
// 5. INDIVIDUAL CHECKS
// =============================================================================

const checks = [
  {
    name: "Circular speed",
    model: orbit.circularSpeed,
    reference: referenceCircularSpeedMps,
    error: absoluteError(
      orbit.circularSpeed,
      referenceCircularSpeedMps
    ),
    tolerance: TOLERANCES.circularSpeedAbsoluteMps,
    unit: "m/s",
  },
  {
    name: "Orbital period",
    model: orbit.orbitalPeriod,
    reference: referencePeriodS,
    error: absoluteError(
      orbit.orbitalPeriod,
      referencePeriodS
    ),
    tolerance: TOLERANCES.periodAbsoluteS,
    unit: "s",
  },
  {
    name: "Specific orbital energy",
    model: orbit.specificEnergy,
    reference: referenceSpecificEnergy,
    error: relativeErrorPercent(
      orbit.specificEnergy,
      referenceSpecificEnergy
    ),
    tolerance: TOLERANCES.specificEnergyRelativePercent,
    unit: "% relative",
  },
  {
    name: "Specific angular momentum",
    model: orbit.specificAngularMomentum,
    reference: referenceSpecificAngularMomentum,
    error: relativeErrorPercent(
      orbit.specificAngularMomentum,
      referenceSpecificAngularMomentum
    ),
    tolerance: TOLERANCES.angularMomentumRelativePercent,
    unit: "% relative",
  },
  {
    name: "Eccentricity",
    model: orbit.eccentricity,
    reference: 0,
    error: Math.abs(orbit.eccentricity),
    tolerance: TOLERANCES.eccentricityAbsolute,
    unit: "absolute",
  },
  {
    name: "Semi-major axis",
    model: orbit.semiMajorAxis,
    reference: referenceRadiusM,
    error: absoluteError(
      orbit.semiMajorAxis,
      referenceRadiusM
    ),
    tolerance: TOLERANCES.semiMajorAxisAbsoluteM,
    unit: "m",
  },
  {
    name: "Periapsis altitude",
    model: orbit.periapsisAltitude,
    reference: TEST_ALTITUDE_M,
    error: absoluteError(
      orbit.periapsisAltitude,
      TEST_ALTITUDE_M
    ),
    tolerance: TOLERANCES.altitudeAbsoluteM,
    unit: "m",
  },
  {
    name: "Apoapsis altitude",
    model: orbit.apoapsisAltitude,
    reference: TEST_ALTITUDE_M,
    error: absoluteError(
      orbit.apoapsisAltitude,
      TEST_ALTITUDE_M
    ),
    tolerance: TOLERANCES.altitudeAbsoluteM,
    unit: "m",
  },
  {
    name: "Radial velocity",
    model: orbit.radialVelocity,
    reference: 0,
    error: Math.abs(orbit.radialVelocity),
    tolerance: TOLERANCES.radialVelocityAbsoluteMps,
    unit: "m/s",
  },
  {
    name: "Tangential velocity",
    model: orbit.tangentialVelocity,
    reference: referenceCircularSpeedMps,
    error: absoluteError(
      orbit.tangentialVelocity,
      referenceCircularSpeedMps
    ),
    tolerance: TOLERANCES.tangentialVelocityAbsoluteMps,
    unit: "m/s",
  },
];

for (const check of checks) {
  check.pass =
    Number.isFinite(check.error) &&
    check.error <= check.tolerance;
}

const classificationPass =
  report.basicClassification ===
  "BOUND_ORBIT";

const targetPass =
  report.targetEvaluation !== null &&
  report.targetEvaluation.reachedTarget === true &&
  report.targetEvaluation.classification ===
    "TARGET_ORBIT";

const overallPass =
  checks.every(
    (check) => check.pass
  ) &&
  classificationPass &&
  targetPass;


// =============================================================================
// 6. REPORT
// =============================================================================

console.log(
  "200 KM CIRCULAR-ORBIT VALIDATION"
);
console.log(
  "================================"
);
console.log(
  "Model under test: physics/orbit.js"
);
console.log(
  "Reference method: independent two-body circular-orbit equations"
);
console.log(
  `Reference Earth radius: ${REFERENCE_EARTH_RADIUS_M.toLocaleString("en-US")} m`
);
console.log(
  `Reference Earth mu:     ${REFERENCE_MU_EARTH.toExponential(9)} m^3/s^2`
);
console.log(
  `Test altitude:          ${(TEST_ALTITUDE_M / 1000).toFixed(0)} km`
);
console.log("");

console.log("REFERENCE STATE");
console.log("---------------");
console.log(
  `Radius:                 ${fixed(referenceRadiusM, 3)} m`
);
console.log(
  `Circular speed:         ${fixed(referenceCircularSpeedMps, 9)} m/s  (${fixed(referenceCircularSpeedMps / 1000, 9)} km/s)`
);
console.log(
  `Orbital period:         ${fixed(referencePeriodS, 9)} s  (${fixed(referencePeriodS / 60, 6)} min)`
);
console.log(
  `Specific energy:        ${fixed(referenceSpecificEnergy, 6)} J/kg`
);
console.log("");

console.log("MODEL OUTPUT");
console.log("------------");
console.log(
  `Radius:                 ${fixed(orbit.radius, 6)} m`
);
console.log(
  `Altitude:               ${fixed(orbit.altitude, 6)} m`
);
console.log(
  `Speed:                  ${fixed(orbit.speed, 9)} m/s`
);
console.log(
  `Circular speed:         ${fixed(orbit.circularSpeed, 9)} m/s`
);
console.log(
  `Radial velocity:        ${scientific(orbit.radialVelocity)} m/s`
);
console.log(
  `Tangential velocity:    ${fixed(orbit.tangentialVelocity, 9)} m/s`
);
console.log(
  `Specific energy:        ${fixed(orbit.specificEnergy, 6)} J/kg`
);
console.log(
  `Angular momentum:       ${fixed(orbit.specificAngularMomentum, 6)} m^2/s`
);
console.log(
  `Eccentricity:           ${scientific(orbit.eccentricity)}`
);
console.log(
  `Semi-major axis:        ${fixed(orbit.semiMajorAxis, 6)} m`
);
console.log(
  `Periapsis altitude:     ${fixed(orbit.periapsisAltitude, 6)} m`
);
console.log(
  `Apoapsis altitude:      ${fixed(orbit.apoapsisAltitude, 6)} m`
);
console.log(
  `Orbital period:         ${fixed(orbit.orbitalPeriod, 9)} s`
);
console.log(
  `Basic classification:   ${report.basicClassification}`
);
console.log(
  `Target classification:  ${report.targetEvaluation?.classification ?? "—"}`
);
console.log("");

console.log("CHECKS");
console.log("------");

for (const check of checks) {
  console.log(
    `${check.pass ? "PASS" : "FAIL"}  ${check.name}`
  );
  console.log(
    `      model=${fixed(check.model, 12)}`
  );
  console.log(
    `      ref=${fixed(check.reference, 12)}`
  );
  console.log(
    `      error=${scientific(check.error)} ${check.unit}`
  );
  console.log(
    `      tolerance=${scientific(check.tolerance)} ${check.unit}`
  );
}

console.log(
  `${classificationPass ? "PASS" : "FAIL"}  Basic classification = BOUND_ORBIT`
);
console.log(
  `${targetPass ? "PASS" : "FAIL"}  200 km target orbit recognized`
);
console.log("");

console.log("SUMMARY");
console.log("=======");
console.log(
  `Reference circular speed: ${fixed(referenceCircularSpeedMps / 1000, 9)} km/s`
);
console.log(
  `Model circular speed:     ${fixed(orbit.circularSpeed / 1000, 9)} km/s`
);
console.log(
  `Reference orbital period: ${fixed(referencePeriodS, 6)} s`
);
console.log(
  `Model orbital period:     ${fixed(orbit.orbitalPeriod, 6)} s`
);
console.log(
  `Eccentricity:             ${scientific(orbit.eccentricity)}`
);
console.log(
  `Periapsis altitude:       ${fixed(orbit.periapsisAltitude / 1000, 9)} km`
);
console.log(
  `Apoapsis altitude:        ${fixed(orbit.apoapsisAltitude / 1000, 9)} km`
);
console.log(
  `Result: ${overallPass ? "PASS" : "FAIL"}`
);

if (!overallPass) {
  process.exitCode = 1;
}
