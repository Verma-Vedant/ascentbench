/**
 * @file staging.js
 * @description Serial-stage propellant, burnout, separation, and activation
 * bookkeeping for AscentBench. Tracks usable/residual propellant and discarded
 * stage mass while preserving continuous position and velocity across the current
 * idealized separation event. Parallel boosters are outside the current model.
 */
import {
  getStageUsablePropellantMass,
  getStageBurnoutOwnMass,
} from "./vehicle-model.js";


// =============================================================================
// 1. INTERNAL VALIDATION
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
    throw new RangeError(
      `${name} cannot be negative.`
    );
  }
}


function assertPositiveNumber(value, name) {
  assertFiniteNumber(value, name);

  if (value <= 0) {
    throw new RangeError(
      `${name} must be greater than 0.`
    );
  }
}


function assertVehicle(vehicle) {
  assertObject(vehicle, "vehicle");

  if (
    !Array.isArray(vehicle.stages) ||
    vehicle.stages.length < 1
  ) {
    throw new TypeError(
      "vehicle.stages must contain at least one stage."
    );
  }
}


function assertFlightState(state) {
  assertObject(state, "state");

  for (const key of [
    "x",
    "y",
    "vx",
    "vy",
    "mass",
  ]) {
    assertFiniteNumber(
      state[key],
      `state.${key}`
    );
  }

  assertPositiveNumber(
    state.mass,
    "state.mass"
  );
}


function assertRuntime(runtime) {
  assertObject(runtime, "runtime");

  if (
    !Number.isInteger(
      runtime.activeStageIndex
    )
  ) {
    throw new TypeError(
      "runtime.activeStageIndex must be an integer."
    );
  }

  if (
    !Array.isArray(
      runtime.stageStates
    )
  ) {
    throw new TypeError(
      "runtime.stageStates must be an array."
    );
  }
}


function freezeRuntime(runtime) {
  return Object.freeze({
    ...runtime,

    stageStates:
      Object.freeze(
        runtime.stageStates.map(
          (stageState) =>
            Object.freeze({
              ...stageState,
            })
        )
      ),
  });
}


// =============================================================================
// 2. INITIAL RUNTIME STATE
// =============================================================================

/**
 * Create mutable-in-concept, immutable-in-value runtime bookkeeping for a
 * serial vehicle.
 *
 * This is separate from the static vehicle definition.
 *
 * Static vehicle definition:
 *   "What is the rocket?"
 *
 * Runtime state:
 *   "Which stage is active, and how much usable propellant remains?"
 */
export function createInitialStagingState(
  vehicle
) {
  assertVehicle(vehicle);

  const stageStates =
    vehicle.stages.map(
      (stage, index) => ({
        stageIndex:
          index,

        stageId:
          stage.id,

        remainingUsablePropellant:
          getStageUsablePropellantMass(
            stage
          ),

        burnedOut:
          false,

        separated:
          false,

        active:
          index === 0,
      })
    );

  return freezeRuntime({
    activeStageIndex: 0,

    stageStates,

    allStagesComplete: false,
  });
}


// =============================================================================
// 3. ACTIVE-STAGE HELPERS
// =============================================================================

/**
 * Return the current static stage definition.
 *
 * Returns null after all stages are complete.
 */
export function getActiveStage(
  vehicle,
  runtime
) {
  assertVehicle(vehicle);
  assertRuntime(runtime);

  if (
    runtime.allStagesComplete === true
  ) {
    return null;
  }

  const index =
    runtime.activeStageIndex;

  if (
    index < 0 ||
    index >= vehicle.stages.length
  ) {
    return null;
  }

  return vehicle.stages[index];
}


/**
 * Return runtime bookkeeping for the active stage.
 */
export function getActiveStageState(
  runtime
) {
  assertRuntime(runtime);

  if (
    runtime.allStagesComplete === true
  ) {
    return null;
  }

  return (
    runtime.stageStates[
      runtime.activeStageIndex
    ] ?? null
  );
}


// =============================================================================
// 4. PROPELLANT REMAINING
// =============================================================================

/**
 * Return active-stage usable propellant remaining [kg].
 */
export function getRemainingUsablePropellant(
  runtime
) {
  const active =
    getActiveStageState(
      runtime
    );

  if (active === null) {
    return 0;
  }

  return (
    active.remainingUsablePropellant
  );
}


// =============================================================================
// 5. BURNOUT TEST
// =============================================================================

/**
 * True when the active stage has exhausted usable propellant.
 *
 * tolerance exists because floating-point arithmetic may produce values like:
 *
 *   3e-12 kg
 *
 * instead of exact zero.
 */
export function isActiveStageBurnedOut(
  runtime,
  tolerance = 1e-9
) {
  assertRuntime(runtime);
  assertNonNegativeNumber(
    tolerance,
    "tolerance"
  );

  const active =
    getActiveStageState(
      runtime
    );

  if (active === null) {
    return true;
  }

  return (
    active.remainingUsablePropellant <=
    tolerance
  );
}


// =============================================================================
// 6. TIME TO BURNOUT
// =============================================================================

/**
 * Estimate continuous burn time remaining at the CURRENT mass-flow rate:
 *
 *   t_remaining =
 *     m_usable_remaining / mdot
 *
 * If massFlowRate = 0:
 *   returns Infinity
 *
 * This is useful for event-safe integration:
 *
 *   if timeToBurnout < proposedDt
 *
 * split the step exactly at burnout.
 */
export function getTimeToActiveStageBurnout(
  runtime,
  massFlowRate
) {
  assertRuntime(runtime);

  assertNonNegativeNumber(
    massFlowRate,
    "massFlowRate"
  );

  const remaining =
    getRemainingUsablePropellant(
      runtime
    );

  if (remaining <= 0) {
    return 0;
  }

  if (massFlowRate === 0) {
    return Infinity;
  }

  return (
    remaining /
    massFlowRate
  );
}


// =============================================================================
// 7. CONSUME ACTIVE-STAGE PROPELLANT
// =============================================================================

/**
 * Consume usable propellant for a continuous powered interval:
 *
 *   consumed = mdot * dt
 *
 * The function clamps consumption to the remaining usable propellant.
 *
 * NOTE:
 * This updates PROPULSION BOOKKEEPING ONLY.
 *
 * The translational state.mass is already reduced continuously through:
 *
 *   dm/dt = -mdot
 *
 * inside dynamics.js + integrator.js.
 *
 * Therefore this function MUST NOT also subtract consumed propellant from
 * state.mass, or mass would be counted twice.
 */
export function consumeActiveStagePropellant({
  runtime,
  massFlowRate,
  dt,
}) {
  assertRuntime(runtime);

  assertNonNegativeNumber(
    massFlowRate,
    "massFlowRate"
  );

  assertNonNegativeNumber(
    dt,
    "dt"
  );

  if (
    runtime.allStagesComplete === true ||
    dt === 0 ||
    massFlowRate === 0
  ) {
    return Object.freeze({
      runtime,
      consumedMass: 0,
      reachedBurnout:
        isActiveStageBurnedOut(
          runtime
        ),
    });
  }

  const activeIndex =
    runtime.activeStageIndex;

  const active =
    runtime.stageStates[
      activeIndex
    ];

  const requestedConsumption =
    massFlowRate * dt;

  const consumedMass =
    Math.min(
      requestedConsumption,
      active.remainingUsablePropellant
    );

  const remaining =
    Math.max(
      0,
      active.remainingUsablePropellant -
      consumedMass
    );

  const stageStates =
    runtime.stageStates.map(
      (stageState, index) => {
        if (
          index !== activeIndex
        ) {
          return {
            ...stageState,
          };
        }

        return {
          ...stageState,

          remainingUsablePropellant:
            remaining,

          burnedOut:
            remaining <= 1e-9,
        };
      }
    );

  const nextRuntime =
    freezeRuntime({
      ...runtime,
      stageStates,
    });

  return Object.freeze({
    runtime:
      nextRuntime,

    consumedMass,

    reachedBurnout:
      remaining <= 1e-9,
  });
}


// =============================================================================
// 8. DISCARDED MASS AT SEPARATION
// =============================================================================

/**
 * Mass discarded when a burned-out stage is separated:
 *
 *   m_discarded =
 *     dryMass + residualPropellantMass
 *
 * Usable propellant is expected to have already been consumed.
 */
export function getStageSeparationMass(
  stage
) {
  assertObject(stage, "stage");

  return (
    getStageBurnoutOwnMass(
      stage
    )
  );
}


// =============================================================================
// 9. APPLY STAGE SEPARATION
// =============================================================================

/**
 * Apply an idealized serial-stage separation event.
 *
 * Precondition:
 * - active stage must be burned out.
 *
 *
 * CONTINUITY ASSUMPTION
 * ---------------------
 * In this simplified model:
 *
 *   x+  = x-
 *   y+  = y-
 *   vx+ = vx-
 *   vy+ = vy-
 *
 * Only vehicle mass/configuration changes discontinuously.
 *
 *
 * MASS CHANGE
 * -----------
 *
 *   m_after =
 *     m_before
 *     - (stage dry mass + residual propellant mass)
 *
 *
 * NEXT STAGE
 * ----------
 * If another serial stage exists:
 *   activeStageIndex -> next stage
 *
 * Otherwise:
 *   allStagesComplete = true
 */
export function separateActiveStage({
  vehicle,
  runtime,
  state,
}) {
  assertVehicle(vehicle);
  assertRuntime(runtime);
  assertFlightState(state);

  if (
    runtime.allStagesComplete === true
  ) {
    throw new RangeError(
      "No active stage remains to separate."
    );
  }

  if (
    !isActiveStageBurnedOut(
      runtime
    )
  ) {
    throw new RangeError(
      "Active stage cannot be separated before usable-propellant burnout."
    );
  }

  const activeIndex =
    runtime.activeStageIndex;

  const activeStage =
    vehicle.stages[
      activeIndex
    ];

  const discardedMass =
    getStageSeparationMass(
      activeStage
    );

  const nextMass =
    state.mass -
    discardedMass;

  if (nextMass <= 0) {
    throw new RangeError(
      "Stage separation would produce non-positive vehicle mass."
    );
  }

  const hasNextStage =
    activeIndex + 1 <
    vehicle.stages.length;

  const stageStates =
    runtime.stageStates.map(
      (stageState, index) => {
        if (
          index === activeIndex
        ) {
          return {
            ...stageState,

            remainingUsablePropellant:
              0,

            burnedOut:
              true,

            separated:
              true,

            active:
              false,
          };
        }

        if (
          hasNextStage &&
          index ===
            activeIndex + 1
        ) {
          return {
            ...stageState,
            active: true,
          };
        }

        return {
          ...stageState,
          active: false,
        };
      }
    );

  const nextRuntime =
    freezeRuntime({
      activeStageIndex:
        hasNextStage
          ? activeIndex + 1
          : activeIndex,

      stageStates,

      allStagesComplete:
        !hasNextStage,
    });

  /**
   * Position and velocity are intentionally unchanged.
   */
  const nextState =
    Object.freeze({
      x:
        state.x,

      y:
        state.y,

      vx:
        state.vx,

      vy:
        state.vy,

      mass:
        nextMass,
    });

  return Object.freeze({
    state:
      nextState,

    runtime:
      nextRuntime,

    event:
      Object.freeze({
        type:
          "stageSeparation",

        separatedStageIndex:
          activeIndex,

        separatedStageId:
          activeStage.id,

        discardedMass,

        nextStageIndex:
          hasNextStage
            ? activeIndex + 1
            : null,

        allStagesComplete:
          !hasNextStage,
      }),
  });
}


// =============================================================================
// 10. EVENT-SAFE STEP SIZE
// =============================================================================

/**
 * Determine how much of a proposed continuous integration step may occur
 * before active-stage burnout.
 *
 * Example:
 *
 *   proposed dt = 0.10 s
 *   time to burnout = 0.037 s
 *
 * then:
 *
 *   safe dt = 0.037 s
 *
 * Integrate only to the event, update staging state, then continue with the
 * remaining 0.063 s afterward.
 *
 * This is the basic mechanism that prevents RK4 from stepping through a
 * discontinuity.
 */
export function getBurnoutSafeStepSize({
  runtime,
  massFlowRate,
  proposedDt,
}) {
  assertRuntime(runtime);

  assertNonNegativeNumber(
    massFlowRate,
    "massFlowRate"
  );

  assertPositiveNumber(
    proposedDt,
    "proposedDt"
  );

  const timeToBurnout =
    getTimeToActiveStageBurnout(
      runtime,
      massFlowRate
    );

  if (
    !Number.isFinite(
      timeToBurnout
    )
  ) {
    return proposedDt;
  }

  return Math.min(
    proposedDt,
    timeToBurnout
  );
}


// =============================================================================
// 11. RUNTIME SUMMARY
// =============================================================================

/**
 * Return a compact staging summary for telemetry/debugging.
 */
export function getStagingSummary({
  vehicle,
  runtime,
}) {
  assertVehicle(vehicle);
  assertRuntime(runtime);

  const activeStage =
    getActiveStage(
      vehicle,
      runtime
    );

  const activeStageState =
    getActiveStageState(
      runtime
    );

  return Object.freeze({
    activeStageIndex:
      runtime.allStagesComplete
        ? null
        : runtime.activeStageIndex,

    activeStageId:
      activeStage?.id ?? null,

    remainingUsablePropellant:
      activeStageState
        ?.remainingUsablePropellant ?? 0,

    activeStageBurnedOut:
      runtime.allStagesComplete
        ? true
        : isActiveStageBurnedOut(
            runtime
          ),

    separatedStageCount:
      runtime.stageStates.filter(
        (stageState) =>
          stageState.separated
      ).length,

    totalStages:
      vehicle.stages.length,

    allStagesComplete:
      runtime.allStagesComplete,
  });
}
