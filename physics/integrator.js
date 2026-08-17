/**
 * @file integrator.js
 * @description Generic fixed-step numerical integration for AscentBench.
 * Implements Euler and classical fourth-order Runge-Kutta (RK4) integration over
 * the project's continuous state shape. The module is physics-agnostic; discrete
 * events such as burnout and staging are resolved by the simulation orchestrator.
 */
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


function assertPositiveNumber(value, name) {
  assertFiniteNumber(value, name);

  if (value <= 0) {
    throw new RangeError(
      `${name} must be greater than 0.`
    );
  }
}


function assertFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(
      `${name} must be a function.`
    );
  }
}


// =============================================================================
// 2. STATE / DERIVATIVE VALIDATION
// =============================================================================

/**
 * Validate the project's continuous state.
 */
export function validateIntegratorState(
  state
) {
  assertObject(
    state,
    "state"
  );

  assertFiniteNumber(
    state.x,
    "state.x"
  );

  assertFiniteNumber(
    state.y,
    "state.y"
  );

  assertFiniteNumber(
    state.vx,
    "state.vx"
  );

  assertFiniteNumber(
    state.vy,
    "state.vy"
  );

  assertPositiveNumber(
    state.mass,
    "state.mass"
  );

  return true;
}


/**
 * Validate the derivative object returned by f(t, state).
 */
export function validateStateDerivative(
  derivative
) {
  assertObject(
    derivative,
    "derivative"
  );

  assertFiniteNumber(
    derivative.dxdt,
    "derivative.dxdt"
  );

  assertFiniteNumber(
    derivative.dydt,
    "derivative.dydt"
  );

  assertFiniteNumber(
    derivative.dvxdt,
    "derivative.dvxdt"
  );

  assertFiniteNumber(
    derivative.dvydt,
    "derivative.dvydt"
  );

  assertFiniteNumber(
    derivative.dmdt,
    "derivative.dmdt"
  );

  return true;
}


// =============================================================================
// 3. STATE + SCALED DERIVATIVE
// =============================================================================

/**
 * Construct:
 *
 *   X_new = X + scale * dXdt
 *
 * This helper is used to construct the intermediate RK4 states.
 */
export function addScaledDerivative(
  state,
  derivative,
  scale
) {
  validateIntegratorState(
    state
  );

  validateStateDerivative(
    derivative
  );

  assertFiniteNumber(
    scale,
    "scale"
  );

  const nextMass =
    state.mass +
    derivative.dmdt *
    scale;

  if (nextMass <= 0) {
    throw new RangeError(
      "Numerical step produced non-positive vehicle mass."
    );
  }

  return Object.freeze({
    x:
      state.x +
      derivative.dxdt *
      scale,

    y:
      state.y +
      derivative.dydt *
      scale,

    vx:
      state.vx +
      derivative.dvxdt *
      scale,

    vy:
      state.vy +
      derivative.dvydt *
      scale,

    mass:
      nextMass,
  });
}


// =============================================================================
// 4. EULER STEP
// =============================================================================

/**
 * One explicit Euler step:
 *
 *   X_next =
 *     X + f(t,X)*dt
 *
 * Euler is first-order and is included mainly for:
 * - educational comparison,
 * - test cases,
 * - demonstrating why the final simulator uses RK4.
 *
 * @param {object} config
 * @returns {object} next state
 */
export function eulerStep({
  derivativeFunction,
  time,
  state,
  dt,
}) {
  assertFunction(
    derivativeFunction,
    "derivativeFunction"
  );

  assertFiniteNumber(
    time,
    "time"
  );

  validateIntegratorState(
    state
  );

  assertPositiveNumber(
    dt,
    "dt"
  );

  const derivative =
    derivativeFunction(
      time,
      state
    );

  validateStateDerivative(
    derivative
  );

  return addScaledDerivative(
    state,
    derivative,
    dt
  );
}


// =============================================================================
// 5. CLASSICAL RK4 STEP
// =============================================================================

/**
 * Advance one fixed timestep with classical fourth-order Runge-Kutta.
 *
 * derivativeFunction must have the shape:
 *
 *   (time, state) => derivative
 *
 * where derivative has:
 *
 *   {
 *     dxdt,
 *     dydt,
 *     dvxdt,
 *     dvydt,
 *     dmdt
 *   }
 */
export function rk4Step({
  derivativeFunction,
  time,
  state,
  dt,
}) {
  assertFunction(
    derivativeFunction,
    "derivativeFunction"
  );

  assertFiniteNumber(
    time,
    "time"
  );

  validateIntegratorState(
    state
  );

  assertPositiveNumber(
    dt,
    "dt"
  );

  // ---------------------------------------------------------------------------
  // k1
  // ---------------------------------------------------------------------------

  const k1 =
    derivativeFunction(
      time,
      state
    );

  validateStateDerivative(
    k1
  );

  // ---------------------------------------------------------------------------
  // k2
  // ---------------------------------------------------------------------------

  const stateForK2 =
    addScaledDerivative(
      state,
      k1,
      dt / 2
    );

  const k2 =
    derivativeFunction(
      time + dt / 2,
      stateForK2
    );

  validateStateDerivative(
    k2
  );

  // ---------------------------------------------------------------------------
  // k3
  // ---------------------------------------------------------------------------

  const stateForK3 =
    addScaledDerivative(
      state,
      k2,
      dt / 2
    );

  const k3 =
    derivativeFunction(
      time + dt / 2,
      stateForK3
    );

  validateStateDerivative(
    k3
  );

  // ---------------------------------------------------------------------------
  // k4
  // ---------------------------------------------------------------------------

  const stateForK4 =
    addScaledDerivative(
      state,
      k3,
      dt
    );

  const k4 =
    derivativeFunction(
      time + dt,
      stateForK4
    );

  validateStateDerivative(
    k4
  );

  // ---------------------------------------------------------------------------
  // Weighted RK4 combination
  // ---------------------------------------------------------------------------

  const oneSixthDt =
    dt / 6;

  const nextState =
    {
      x:
        state.x +
        oneSixthDt *
        (
          k1.dxdt +
          2 * k2.dxdt +
          2 * k3.dxdt +
          k4.dxdt
        ),

      y:
        state.y +
        oneSixthDt *
        (
          k1.dydt +
          2 * k2.dydt +
          2 * k3.dydt +
          k4.dydt
        ),

      vx:
        state.vx +
        oneSixthDt *
        (
          k1.dvxdt +
          2 * k2.dvxdt +
          2 * k3.dvxdt +
          k4.dvxdt
        ),

      vy:
        state.vy +
        oneSixthDt *
        (
          k1.dvydt +
          2 * k2.dvydt +
          2 * k3.dvydt +
          k4.dvydt
        ),

      mass:
        state.mass +
        oneSixthDt *
        (
          k1.dmdt +
          2 * k2.dmdt +
          2 * k3.dmdt +
          k4.dmdt
        ),
    };

  validateIntegratorState(
    nextState
  );

  return Object.freeze(
    nextState
  );
}


// =============================================================================
// 6. SINGLE-STEP METHOD DISPATCHER
// =============================================================================

/**
 * Generic one-step interface.
 *
 * method:
 *   "rk4"   -> default
 *   "euler" -> verification / comparison
 */
export function integrateStep({
  derivativeFunction,
  time,
  state,
  dt,
  method = "rk4",
}) {
  switch (method) {
    case "rk4":
      return rk4Step({
        derivativeFunction,
        time,
        state,
        dt,
      });

    case "euler":
      return eulerStep({
        derivativeFunction,
        time,
        state,
        dt,
      });

    default:
      throw new RangeError(
        `Unknown integration method: "${method}".`
      );
  }
}


// =============================================================================
// 7. FIXED-DURATION INTEGRATION
// =============================================================================

/**
 * Integrate a continuous system over a fixed duration.
 *
 * This is intentionally a SIMPLE continuous integrator.
 *
 * It is excellent for:
 * - verification tests,
 * - constant-acceleration tests,
 * - vacuum orbital propagation tests,
 * - comparing Euler and RK4,
 * - timestep-convergence studies.
 *
 * It is NOT the final ascent event loop because it knows nothing about stage
 * burnout or separation.
 *
 *
 * final partial step
 * ------------------
 * If duration is not exactly divisible by dt, the last step is shortened so
 * integration ends exactly at:
 *
 *   startTime + duration
 *
 *
 * onStep
 * ------
 * Optional callback:
 *
 *   onStep({
 *     time,
 *     state,
 *     stepIndex
 *   })
 *
 * It is useful for collecting trajectory history in tests.
 *
 * @returns {object}
 */
export function integrateFixedDuration({
  derivativeFunction,

  initialState,

  startTime = 0,

  duration,

  dt,

  method = "rk4",

  onStep = null,

  maxSteps = 1_000_000,
}) {
  assertFunction(
    derivativeFunction,
    "derivativeFunction"
  );

  validateIntegratorState(
    initialState
  );

  assertFiniteNumber(
    startTime,
    "startTime"
  );

  assertPositiveNumber(
    duration,
    "duration"
  );

  assertPositiveNumber(
    dt,
    "dt"
  );

  if (
    onStep !== null &&
    typeof onStep !== "function"
  ) {
    throw new TypeError(
      "onStep must be a function or null."
    );
  }

  if (
    !Number.isInteger(maxSteps) ||
    maxSteps <= 0
  ) {
    throw new RangeError(
      "maxSteps must be a positive integer."
    );
  }

  let time =
    startTime;

  let state =
    Object.freeze({
      ...initialState,
    });

  const endTime =
    startTime +
    duration;

  let stepIndex = 0;

  if (onStep) {
    onStep({
      time,
      state,
      stepIndex,
    });
  }

  while (
    time < endTime
  ) {
    if (
      stepIndex >= maxSteps
    ) {
      throw new RangeError(
        "Integration exceeded maxSteps."
      );
    }

    const remainingTime =
      endTime -
      time;

    const stepSize =
      Math.min(
        dt,
        remainingTime
      );

    state =
      integrateStep({
        derivativeFunction,
        time,
        state,
        dt: stepSize,
        method,
      });

    time +=
      stepSize;

    stepIndex += 1;

    /**
     * Suppress tiny floating-point drift at the exact final boundary.
     */
    if (
      Math.abs(
        endTime - time
      ) <
      Number.EPSILON *
      Math.max(
        1,
        Math.abs(endTime)
      ) *
      16
    ) {
      time =
        endTime;
    }

    if (onStep) {
      onStep({
        time,
        state,
        stepIndex,
      });
    }
  }

  return Object.freeze({
    method,

    startTime,
    endTime:
      time,

    requestedDuration:
      duration,

    nominalStepSize:
      dt,

    steps:
      stepIndex,

    finalState:
      state,
  });
}


// =============================================================================
// 8. STATE DIFFERENCE HELPER
// =============================================================================

/**
 * Compare two states component-by-component.
 *
 * Useful for timestep-convergence and verification reports.
 */
export function getStateDifference(
  referenceState,
  comparisonState
) {
  validateIntegratorState(
    referenceState
  );

  validateIntegratorState(
    comparisonState
  );

  return Object.freeze({
    x:
      comparisonState.x -
      referenceState.x,

    y:
      comparisonState.y -
      referenceState.y,

    vx:
      comparisonState.vx -
      referenceState.vx,

    vy:
      comparisonState.vy -
      referenceState.vy,

    mass:
      comparisonState.mass -
      referenceState.mass,
  });
}


// =============================================================================
// 9. ABSOLUTE STATE DIFFERENCE
// =============================================================================

/**
 * Same as getStateDifference(), but returns absolute magnitudes.
 */
export function getAbsoluteStateDifference(
  referenceState,
  comparisonState
) {
  const difference =
    getStateDifference(
      referenceState,
      comparisonState
    );

  return Object.freeze({
    x:
      Math.abs(
        difference.x
      ),

    y:
      Math.abs(
        difference.y
      ),

    vx:
      Math.abs(
        difference.vx
      ),

    vy:
      Math.abs(
        difference.vy
      ),

    mass:
      Math.abs(
        difference.mass
      ),
  });
}
