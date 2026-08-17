/**
 * @file propulsion.js
 * @description Simplified stage-level propulsion model for AscentBench.
 * Interpolates thrust between supplied sea-level and vacuum anchors as ambient
 * pressure changes, derives baseline mass flow from the vacuum thrust/Isp pair,
 * and applies throttle consistently to thrust and mass flow.
 *
 * Model scope: no chamber/nozzle cycle model, mixture-ratio dynamics, ignition
 * transients, engine-out behavior, or vehicle-specific throttle schedule.
 */
import {
  G0,
  P0,
} from "./constants.js";

import {
  getStageUsablePropellantMass,
} from "./vehicle-model.js";


// =============================================================================
// 1. INTERNAL VALIDATION HELPERS
// =============================================================================

function assertObject(value, name) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${name} must be an object.`);
  }
}


function assertFiniteNumber(value, name) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number.`);
  }
}


function assertNonNegativeNumber(value, name) {
  assertFiniteNumber(value, name);

  if (value < 0) {
    throw new RangeError(`${name} cannot be negative.`);
  }
}


function assertThrottle(throttle) {
  assertFiniteNumber(throttle, "throttle");

  if (throttle < 0 || throttle > 1) {
    throw new RangeError(
      "throttle must be between 0 and 1."
    );
  }
}


function assertPropulsionStage(stage) {
  assertObject(stage, "stage");
  assertObject(stage.propulsion, "stage.propulsion");

  const required = [
    "thrustSeaLevel",
    "thrustVacuum",
    "ispSeaLevel",
    "ispVacuum",
  ];

  for (const key of required) {
    const value = stage.propulsion[key];

    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(
        `stage.propulsion.${key} must be a positive finite number.`
      );
    }
  }
}


function clamp(value, minimum, maximum) {
  return Math.min(
    Math.max(value, minimum),
    maximum
  );
}


// =============================================================================
// 2. BASELINE MASS FLOW
// =============================================================================

/**
 * Derive baseline propellant mass-flow rate from the stage's vacuum
 * performance.
 *
 * Specific impulse is:
 *
 *   Isp = F / (mdot * g0)
 *
 * Rearranging:
 *
 *   mdot = F / (Isp * g0)
 *
 * The vacuum pair is used because both values describe the same zero-ambient-
 * pressure reference state.
 *
 * @param {object} stage - Validated stage definition.
 * @returns {number} Baseline mass-flow rate [kg/s].
 */
export function getBaselineMassFlowRate(stage) {
  assertPropulsionStage(stage);

  const {
    thrustVacuum,
    ispVacuum,
  } = stage.propulsion;

  return (
    thrustVacuum /
    (ispVacuum * G0)
  );
}


// =============================================================================
// 3. AMBIENT-PRESSURE FACTOR
// =============================================================================

/**
 * Return normalized ambient pressure relative to standard sea level:
 *
 *   pressureRatio = Pa / P0
 *
 * The standard interpolation model clamps this value to [0, 1].
 *
 * Why clamp?
 * ----------
 * Stage data gives us TWO anchor conditions:
 *   - vacuum
 *   - standard sea level
 *
 * The available anchors support interpolation between those conditions,
 * but not enough information to confidently extrapolate to pressures above
 * standard sea level.
 *
 * A launch location slightly below sea level will therefore use the
 * sea-level anchor rather than inventing additional nozzle behavior.
 *
 * @param {number} ambientPressure - Ambient pressure [Pa].
 * @returns {number} Pressure ratio in [0, 1].
 */
export function getAmbientPressureRatio(
  ambientPressure
) {
  assertNonNegativeNumber(
    ambientPressure,
    "ambientPressure"
  );

  return clamp(
    ambientPressure / P0,
    0,
    1
  );
}


// =============================================================================
// 4. AMBIENT THRUST
// =============================================================================

/**
 * Calculate stage thrust at ambient pressure.
 *
 * Linear pressure interpolation:
 *
 *   F(Pa) =
 *     F_vac
 *     - (F_vac - F_SL) * pressureRatio
 *
 * Boundary checks:
 *
 *   Pa = 0:
 *     pressureRatio = 0
 *     F = F_vac
 *
 *   Pa = P0:
 *     pressureRatio = 1
 *     F = F_SL
 *
 * @param {object} stage - Validated stage definition.
 * @param {number} ambientPressure - Ambient pressure [Pa].
 * @returns {number} Unthrottled thrust [N].
 */
export function getAmbientThrust(
  stage,
  ambientPressure
) {
  assertPropulsionStage(stage);

  const pressureRatio =
    getAmbientPressureRatio(
      ambientPressure
    );

  const {
    thrustSeaLevel,
    thrustVacuum,
  } = stage.propulsion;

  return (
    thrustVacuum -
    (
      thrustVacuum -
      thrustSeaLevel
    ) *
    pressureRatio
  );
}


// =============================================================================
// 5. EFFECTIVE SPECIFIC IMPULSE
// =============================================================================

/**
 * Calculate effective specific impulse from thrust and mass flow.
 *
 *   Isp = F / (mdot * g0)
 *
 * @param {number} thrust - Thrust [N].
 * @param {number} massFlowRate - Propellant mass-flow rate [kg/s].
 * @returns {number} Effective Isp [s].
 */
export function getEffectiveSpecificImpulse(
  thrust,
  massFlowRate
) {
  assertNonNegativeNumber(
    thrust,
    "thrust"
  );

  assertNonNegativeNumber(
    massFlowRate,
    "massFlowRate"
  );

  if (massFlowRate === 0) {
    if (thrust === 0) {
      return 0;
    }

    throw new RangeError(
      "Non-zero thrust cannot have zero mass flow in this model."
    );
  }

  return (
    thrust /
    (massFlowRate * G0)
  );
}


// =============================================================================
// 6. EFFECTIVE EXHAUST VELOCITY
// =============================================================================

/**
 * Convert effective specific impulse to effective exhaust velocity:
 *
 *   Veq = Isp * g0
 *
 * This is an effective performance quantity used by the rocket equation.
 *
 * @param {number} specificImpulse - Isp [s].
 * @returns {number} Effective exhaust velocity [m/s].
 */
export function getEffectiveExhaustVelocity(
  specificImpulse
) {
  assertNonNegativeNumber(
    specificImpulse,
    "specificImpulse"
  );

  return specificImpulse * G0;
}


// =============================================================================
// 7. FULL PROPULSION STATE
// =============================================================================

/**
 * Main propulsion function intended for dynamics.js.
 *
 * Example:
 *
 *   const propulsion = getPropulsionState(
 *     activeStage,
 *     atmosphere.pressure,
 *     { throttle: 1 }
 *   );
 *
 * Returns a self-consistent propulsion state.
 *
 * @param {object} stage
 * @param {number} ambientPressure [Pa]
 * @param {{throttle?: number, engineOn?: boolean}} options
 * @returns {object}
 */
export function getPropulsionState(
  stage,
  ambientPressure,
  options = {}
) {
  assertPropulsionStage(stage);

  assertNonNegativeNumber(
    ambientPressure,
    "ambientPressure"
  );

  const {
    throttle = 1,
    engineOn = true,
  } = options;

  assertThrottle(throttle);

  if (typeof engineOn !== "boolean") {
    throw new TypeError(
      "engineOn must be a boolean."
    );
  }

  const pressureRatio =
    getAmbientPressureRatio(
      ambientPressure
    );

  const referenceMassFlowRate =
    getBaselineMassFlowRate(stage);

  const referenceThrust =
    getAmbientThrust(
      stage,
      ambientPressure
    );

  /**
   * Calculate the effective Isp BEFORE throttle scaling.
   *
   * Since our simple throttle model scales thrust and mass flow by the
   * same factor, Isp remains equal to this value for every non-zero
   * throttle setting.
   */
  const referenceSpecificImpulse =
    getEffectiveSpecificImpulse(
      referenceThrust,
      referenceMassFlowRate
    );

  const effectiveExhaustVelocity =
    getEffectiveExhaustVelocity(
      referenceSpecificImpulse
    );

  const commandedThrottle =
    engineOn ? throttle : 0;

  const thrust =
    referenceThrust *
    commandedThrottle;

  const massFlowRate =
    referenceMassFlowRate *
    commandedThrottle;

  return Object.freeze({
    model:
      "SEA_LEVEL_TO_VACUUM_PRESSURE_INTERPOLATION",

    engineOn:
      engineOn &&
      commandedThrottle > 0,

    throttle:
      commandedThrottle,

    ambientPressure,
    pressureRatio,

    thrust,

    specificImpulse:
      referenceSpecificImpulse,

    effectiveExhaustVelocity,

    massFlowRate,

    referenceThrust,
    referenceMassFlowRate,

    isVacuum:
      ambientPressure === 0,
  });
}


// =============================================================================
// 8. SEA-LEVEL CONSISTENCY CHECK
// =============================================================================

/**
 * Check whether the stage's published sea-level Isp is consistent with the
 * single mass-flow rate implied by its vacuum thrust and vacuum Isp.
 *
 * Baseline mass flow:
 *
 *   mdot =
 *     F_vac / (Isp_vac * g0)
 *
 * Predicted sea-level Isp:
 *
 *   Isp_SL,pred =
 *     F_SL / (mdot * g0)
 *
 * Then compare that with stage.propulsion.ispSeaLevel.
 *
 * Small differences are normal because public data is often rounded.
 * Large differences suggest that:
 *   - data came from inconsistent sources,
 *   - values refer to different configurations,
 *   - or our simplified constant-mass-flow assumption is inadequate.
 *
 * This function DIAGNOSES the discrepancy; it does not silently modify data.
 *
 * @param {object} stage
 * @returns {object}
 */
export function getPropulsionConsistency(
  stage
) {
  assertPropulsionStage(stage);

  const massFlowRate =
    getBaselineMassFlowRate(stage);

  const predictedSeaLevelIsp =
    getEffectiveSpecificImpulse(
      stage.propulsion.thrustSeaLevel,
      massFlowRate
    );

  const providedSeaLevelIsp =
    stage.propulsion.ispSeaLevel;

  const absoluteDifference =
    predictedSeaLevelIsp -
    providedSeaLevelIsp;

  const relativeDifference =
    absoluteDifference /
    providedSeaLevelIsp;

  return Object.freeze({
    baselineMassFlowRate:
      massFlowRate,

    providedSeaLevelIsp,

    predictedSeaLevelIsp,

    absoluteDifference,

    relativeDifference,

    relativeDifferencePercent:
      relativeDifference * 100,
  });
}


// =============================================================================
// 9. BURN-TIME ESTIMATE
// =============================================================================

/**
 * Estimate nominal full-throttle usable-propellant burn time:
 *
 *   t_burn =
 *     m_propellant,usable / mdot
 *
 * This is a simple consistency / reporting calculation.
 *
 * The actual time-domain simulator will integrate propellant consumption
 * directly and handle engine cutoff as an event.
 *
 * @param {object} stage
 * @returns {number} Estimated burn time [s].
 */
export function estimateFullThrottleBurnTime(
  stage
) {
  assertPropulsionStage(stage);

  const usablePropellantMass =
    getStageUsablePropellantMass(
      stage
    );

  const massFlowRate =
    getBaselineMassFlowRate(stage);

  return (
    usablePropellantMass /
    massFlowRate
  );
}


// =============================================================================
// 10. STAGE PROPULSION DIAGNOSTICS
// =============================================================================

/**
 * Return useful non-flight diagnostics for a stage's propulsion data.
 *
 * This lets the database / validation layer ask:
 *
 *   - What mass flow does this data imply?
 *   - Does the given sea-level Isp agree?
 *   - What full-throttle burn time does the mass-flow model imply?
 *   - How far is that from a published nominal burn time, if one exists?
 *
 * @param {object} stage
 * @returns {object}
 */
export function getPropulsionDiagnostics(
  stage
) {
  assertPropulsionStage(stage);

  const consistency =
    getPropulsionConsistency(stage);

  const estimatedBurnTime =
    estimateFullThrottleBurnTime(stage);

  let burnTimeComparison = null;

  if (
    Number.isFinite(stage.nominalBurnTime) &&
    stage.nominalBurnTime > 0
  ) {
    const absoluteDifference =
      estimatedBurnTime -
      stage.nominalBurnTime;

    burnTimeComparison = Object.freeze({
      provided:
        stage.nominalBurnTime,

      estimated:
        estimatedBurnTime,

      absoluteDifference,

      relativeDifference:
        absoluteDifference /
        stage.nominalBurnTime,

      relativeDifferencePercent:
        (
          absoluteDifference /
          stage.nominalBurnTime
        ) * 100,
    });
  }

  return Object.freeze({
    baselineMassFlowRate:
      consistency.baselineMassFlowRate,

    estimatedFullThrottleBurnTime:
      estimatedBurnTime,

    seaLevelIspConsistency:
      consistency,

    burnTimeComparison,
  });
}
