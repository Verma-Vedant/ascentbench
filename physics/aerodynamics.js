/**
 * @file aerodynamics.js
 * @description Simplified 2D translational aerodynamics for AscentBench.
 * Computes relative airspeed, Mach number, dynamic pressure, Mach-dependent Cd,
 * and drag force from atmospheric state and vehicle reference area.
 *
 * Model scope: drag only; no lift, Reynolds-number dependence, detailed angle-of-
 * attack aerodynamics, CFD, or vehicle-specific aerodynamic database.
 * Units are SI unless stated otherwise.
 */
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


function assertPositiveNumber(value, name) {
  assertFiniteNumber(value, name);

  if (value <= 0) {
    throw new RangeError(`${name} must be greater than 0.`);
  }
}


function assertVector2(vector, name) {
  assertObject(vector, name);

  assertFiniteNumber(
    vector.x,
    `${name}.x`
  );

  assertFiniteNumber(
    vector.y,
    `${name}.y`
  );
}


function freezeVector(vector) {
  return Object.freeze({
    x: vector.x,
    y: vector.y,
  });
}


// =============================================================================
// 2. BASIC VECTOR HELPERS
// =============================================================================

/**
 * Magnitude of a 2D vector:
 *
 *   |v| = sqrt(vx^2 + vy^2)
 *
 * @param {{x:number,y:number}} vector
 * @returns {number}
 */
export function getVectorMagnitude(vector) {
  assertVector2(vector, "vector");

  return Math.hypot(
    vector.x,
    vector.y
  );
}


/**
 * Normalize a 2D vector.
 *
 * For a zero vector, returns {x:0, y:0} rather than dividing by zero.
 *
 * @param {{x:number,y:number}} vector
 * @returns {{x:number,y:number}}
 */
export function getUnitVector(vector) {
  assertVector2(vector, "vector");

  const magnitude =
    getVectorMagnitude(vector);

  if (magnitude === 0) {
    return freezeVector({
      x: 0,
      y: 0,
    });
  }

  return freezeVector({
    x: vector.x / magnitude,
    y: vector.y / magnitude,
  });
}


// =============================================================================
// 3. RELATIVE AIR VELOCITY
// =============================================================================

/**
 * Velocity of the vehicle relative to the local air:
 *
 *   V_rel = V_vehicle - V_air
 *
 * In the first simulator, airVelocity normally defaults to {0,0}.
 *
 * Keeping this interface explicit leaves room for:
 *   - rotating atmosphere,
 *   - wind,
 * without rewriting the drag equations.
 *
 * @param {{x:number,y:number}} vehicleVelocity [m/s]
 * @param {{x:number,y:number}} airVelocity [m/s]
 * @returns {{x:number,y:number}}
 */
export function getRelativeAirVelocity(
  vehicleVelocity,
  airVelocity = { x: 0, y: 0 }
) {
  assertVector2(
    vehicleVelocity,
    "vehicleVelocity"
  );

  assertVector2(
    airVelocity,
    "airVelocity"
  );

  return freezeVector({
    x:
      vehicleVelocity.x -
      airVelocity.x,

    y:
      vehicleVelocity.y -
      airVelocity.y,
  });
}


// =============================================================================
// 4. MACH NUMBER
// =============================================================================

/**
 * Mach number:
 *
 *   M = V / a
 *
 * where:
 *   V = relative airspeed
 *   a = local speed of sound
 *
 * In the vacuum approximation, the atmosphere module returns
 * speedOfSound = null. In that case Mach is not reported.
 *
 * @param {number} relativeAirspeed [m/s]
 * @param {number|null} speedOfSound [m/s]
 * @returns {number|null}
 */
export function getMachNumber(
  relativeAirspeed,
  speedOfSound
) {
  assertNonNegativeNumber(
    relativeAirspeed,
    "relativeAirspeed"
  );

  if (
    speedOfSound === null ||
    speedOfSound === undefined
  ) {
    return null;
  }

  assertPositiveNumber(
    speedOfSound,
    "speedOfSound"
  );

  return (
    relativeAirspeed /
    speedOfSound
  );
}


// =============================================================================
// 5. DYNAMIC PRESSURE
// =============================================================================

/**
 * Dynamic pressure:
 *
 *   q = 1/2 * rho * V^2
 *
 * It is NOT the same thing as static atmospheric pressure.
 *
 * q is especially useful because the drag equation becomes:
 *
 *   D = q * Cd * A
 *
 * @param {number} density [kg/m^3]
 * @param {number} relativeAirspeed [m/s]
 * @returns {number} dynamic pressure [Pa]
 */
export function getDynamicPressure(
  density,
  relativeAirspeed
) {
  assertNonNegativeNumber(
    density,
    "density"
  );

  assertNonNegativeNumber(
    relativeAirspeed,
    "relativeAirspeed"
  );

  return (
    0.5 *
    density *
    relativeAirspeed *
    relativeAirspeed
  );
}


// =============================================================================
// 6. MACH-Cd MODEL CREATION / VALIDATION
// =============================================================================

/**
 * Build a validated Mach-dependent Cd model.
 *
 * points must look like:
 *
 *   [
 *     { mach: 0.0, cd: ... },
 *     { mach: 0.8, cd: ... },
 *     { mach: 1.0, cd: ... },
 *     { mach: 2.0, cd: ... }
 *   ]
 *
 * Requirements:
 * - at least 2 points,
 * - Mach >= 0,
 * - Cd >= 0,
 * - strictly increasing Mach values,
 * - no duplicate Mach entries.
 *
 * `outsideRange` controls what happens beyond the supplied table:
 *
 *   "clamp" -> use nearest endpoint Cd
 *   "error" -> throw instead
 *
 * For the first project model, "clamp" is practical but should be documented
 * in the methodology if the trajectory actually leaves the data range.
 *
 * @param {object} config
 * @returns {object}
 */
export function createMachCdModel({
  id,
  name = null,
  points,
  outsideRange = "clamp",
  provenance = null,
}) {
  if (
    typeof id !== "string" ||
    id.trim().length === 0
  ) {
    throw new TypeError(
      "Cd model id must be a non-empty string."
    );
  }

  if (
    name !== null &&
    typeof name !== "string"
  ) {
    throw new TypeError(
      "Cd model name must be a string or null."
    );
  }

  if (
    !Array.isArray(points) ||
    points.length < 2
  ) {
    throw new RangeError(
      "Cd model points must contain at least two entries."
    );
  }

  if (
    outsideRange !== "clamp" &&
    outsideRange !== "error"
  ) {
    throw new RangeError(
      'outsideRange must be "clamp" or "error".'
    );
  }

  const validatedPoints =
    points.map((point, index) => {
      assertObject(
        point,
        `points[${index}]`
      );

      assertNonNegativeNumber(
        point.mach,
        `points[${index}].mach`
      );

      assertNonNegativeNumber(
        point.cd,
        `points[${index}].cd`
      );

      return Object.freeze({
        mach: point.mach,
        cd: point.cd,
      });
    });

  for (
    let i = 1;
    i < validatedPoints.length;
    i += 1
  ) {
    if (
      validatedPoints[i].mach <=
      validatedPoints[i - 1].mach
    ) {
      throw new RangeError(
        "Cd model Mach values must be strictly increasing."
      );
    }
  }

  return Object.freeze({
    id: id.trim(),
    name:
      name === null
        ? null
        : name.trim(),

    points:
      Object.freeze(
        validatedPoints
      ),

    outsideRange,

    provenance,
  });
}


// =============================================================================
// 7. LINEAR INTERPOLATION
// =============================================================================

/**
 * Generic linear interpolation between two known points:
 *
 *                x - x1
 *   y = y1 + ------------- * (y2 - y1)
 *                x2 - x1
 *
 * @returns {number}
 */
export function interpolateLinear(
  x,
  x1,
  y1,
  x2,
  y2
) {
  assertFiniteNumber(x, "x");
  assertFiniteNumber(x1, "x1");
  assertFiniteNumber(y1, "y1");
  assertFiniteNumber(x2, "x2");
  assertFiniteNumber(y2, "y2");

  if (x2 === x1) {
    throw new RangeError(
      "Cannot interpolate between identical x values."
    );
  }

  const fraction =
    (x - x1) /
    (x2 - x1);

  return (
    y1 +
    fraction *
    (y2 - y1)
  );
}


// =============================================================================
// 8. Cd FROM MACH TABLE
// =============================================================================

/**
 * Obtain drag coefficient from a validated Mach-Cd model.
 *
 * Linear interpolation is used between tabulated points.
 *
 * Example:
 *
 *   M1 = 0.8, Cd1 = 0.30
 *   M2 = 1.0, Cd2 = 0.50
 *
 * At M = 0.9:
 *
 *   Cd = 0.40
 *
 * This is a modelling approximation. Real Cd(M) can contain sharp nonlinear
 * behaviour, particularly around transonic flow. The table should therefore
 * contain enough points to represent whatever fidelity the source supports.
 *
 * @param {number} mach
 * @param {object} cdModel
 * @returns {number}
 */
export function getDragCoefficient(
  mach,
  cdModel
) {
  assertNonNegativeNumber(
    mach,
    "mach"
  );

  assertObject(
    cdModel,
    "cdModel"
  );

  if (
    !Array.isArray(cdModel.points) ||
    cdModel.points.length < 2
  ) {
    throw new TypeError(
      "cdModel must be created with createMachCdModel()."
    );
  }

  const points =
    cdModel.points;

  const first =
    points[0];

  const last =
    points[
      points.length - 1
    ];

  if (mach < first.mach) {
    if (
      cdModel.outsideRange === "error"
    ) {
      throw new RangeError(
        `Mach ${mach} is below Cd-model range beginning at ${first.mach}.`
      );
    }

    return first.cd;
  }

  if (mach > last.mach) {
    if (
      cdModel.outsideRange === "error"
    ) {
      throw new RangeError(
        `Mach ${mach} is above Cd-model range ending at ${last.mach}.`
      );
    }

    return last.cd;
  }

  if (mach === first.mach) {
    return first.cd;
  }

  if (mach === last.mach) {
    return last.cd;
  }

  for (
    let i = 0;
    i < points.length - 1;
    i += 1
  ) {
    const lower =
      points[i];

    const upper =
      points[i + 1];

    if (
      mach >= lower.mach &&
      mach <= upper.mach
    ) {
      return interpolateLinear(
        mach,
        lower.mach,
        lower.cd,
        upper.mach,
        upper.cd
      );
    }
  }

  /**
   * This branch should be unreachable when the model and interpolation range
   * checks above are correct.
   */
  throw new Error(
    "Failed to resolve drag coefficient from Mach table."
  );
}


// =============================================================================
// 9. DRAG MAGNITUDE
// =============================================================================

/**
 * Drag magnitude:
 *
 *   D = q * Cd * A
 *
 * @param {number} dynamicPressure [Pa]
 * @param {number} dragCoefficient dimensionless
 * @param {number} referenceArea [m^2]
 * @returns {number} drag force [N]
 */
export function getDragMagnitude(
  dynamicPressure,
  dragCoefficient,
  referenceArea
) {
  assertNonNegativeNumber(
    dynamicPressure,
    "dynamicPressure"
  );

  assertNonNegativeNumber(
    dragCoefficient,
    "dragCoefficient"
  );

  assertPositiveNumber(
    referenceArea,
    "referenceArea"
  );

  return (
    dynamicPressure *
    dragCoefficient *
    referenceArea
  );
}


// =============================================================================
// 10. DRAG FORCE VECTOR
// =============================================================================

/**
 * Drag points opposite relative air velocity:
 *
 *                  V_rel
 *   D_vec = -D * ---------
 *                 |V_rel|
 *
 * If relative airspeed is zero, drag is exactly zero and the direction is
 * undefined; the function returns {0,0}.
 *
 * @param {{x:number,y:number}} relativeAirVelocity [m/s]
 * @param {number} dragMagnitude [N]
 * @returns {{x:number,y:number}} drag force vector [N]
 */
export function getDragVector(
  relativeAirVelocity,
  dragMagnitude
) {
  assertVector2(
    relativeAirVelocity,
    "relativeAirVelocity"
  );

  assertNonNegativeNumber(
    dragMagnitude,
    "dragMagnitude"
  );

  const speed =
    getVectorMagnitude(
      relativeAirVelocity
    );

  if (
    speed === 0 ||
    dragMagnitude === 0
  ) {
    return freezeVector({
      x: 0,
      y: 0,
    });
  }

  return freezeVector({
    x:
      -dragMagnitude *
      relativeAirVelocity.x /
      speed,

    y:
      -dragMagnitude *
      relativeAirVelocity.y /
      speed,
  });
}


// =============================================================================
// 11. COMPLETE AERODYNAMIC STATE
// =============================================================================

/**
 * Main function intended for dynamics.js.
 *
 * Inputs:
 * -------
 * vehicleVelocity:
 *   Vehicle inertial/local-frame velocity [m/s].
 *
 * atmosphere:
 *   Result returned by atmosphere.js.
 *
 * referenceArea:
 *   Current vehicle/stage aerodynamic reference area [m^2].
 *
 * cdModel:
 *   Validated model returned by createMachCdModel().
 *
 * airVelocity:
 *   Optional local air velocity [m/s].
 *   Defaults to zero in the first simulation.
 *
 *
 * Vacuum behaviour:
 * -----------------
 * If atmosphere.js reports its vacuum approximation:
 *
 *   q = 0
 *   D = 0
 *   Mach = null
 *   Cd = null
 *
 *
 * @returns {object}
 */
export function getAerodynamicState({
  vehicleVelocity,
  atmosphere,
  referenceArea,
  cdModel,
  airVelocity = { x: 0, y: 0 },
}) {
  assertVector2(
    vehicleVelocity,
    "vehicleVelocity"
  );

  assertVector2(
    airVelocity,
    "airVelocity"
  );

  assertObject(
    atmosphere,
    "atmosphere"
  );

  assertPositiveNumber(
    referenceArea,
    "referenceArea"
  );

  const relativeAirVelocity =
    getRelativeAirVelocity(
      vehicleVelocity,
      airVelocity
    );

  const relativeAirspeed =
    getVectorMagnitude(
      relativeAirVelocity
    );

  /**
   * Explicitly respect atmosphere.js's vacuum approximation.
   */
  if (
    atmosphere.isVacuumApproximation === true ||
    atmosphere.density === 0
  ) {
    return Object.freeze({
      model:
        "DRAG_ONLY_MACH_DEPENDENT_CD",

      relativeAirVelocity,
      relativeAirspeed,

      mach: null,
      dragCoefficient: null,

      dynamicPressure: 0,
      dragMagnitude: 0,

      dragVector:
        freezeVector({
          x: 0,
          y: 0,
        }),

      referenceArea,

      airVelocity:
        freezeVector({
          x: airVelocity.x,
          y: airVelocity.y,
        }),

      continuumAerodynamicsActive:
        false,
    });
  }

  assertNonNegativeNumber(
    atmosphere.density,
    "atmosphere.density"
  );

  const mach =
    getMachNumber(
      relativeAirspeed,
      atmosphere.speedOfSound
    );

  if (mach === null) {
    throw new Error(
      "Non-vacuum aerodynamic state requires a valid speed of sound."
    );
  }

  const dragCoefficient =
    getDragCoefficient(
      mach,
      cdModel
    );

  const dynamicPressure =
    getDynamicPressure(
      atmosphere.density,
      relativeAirspeed
    );

  const dragMagnitude =
    getDragMagnitude(
      dynamicPressure,
      dragCoefficient,
      referenceArea
    );

  const dragVector =
    getDragVector(
      relativeAirVelocity,
      dragMagnitude
    );

  return Object.freeze({
    model:
      "DRAG_ONLY_MACH_DEPENDENT_CD",

    relativeAirVelocity,
    relativeAirspeed,

    mach,
    dragCoefficient,

    dynamicPressure,
    dragMagnitude,
    dragVector,

    referenceArea,

    airVelocity:
      freezeVector({
        x: airVelocity.x,
        y: airVelocity.y,
      }),

    continuumAerodynamicsActive:
      true,
  });
}


// =============================================================================
// 12. MAX-Q HELPER
// =============================================================================

/**
 * Compare a new aerodynamic state against the current recorded Max-Q state.
 *
 * This does NOT calculate trajectory history itself. It is simply a clean
 * helper for diagnostics / telemetry code.
 *
 * currentMaxQ may be null on the first timestep.
 *
 * candidate should contain:
 *   time
 *   altitude
 *   dynamicPressure
 *   mach
 *
 * @returns {object}
 */
export function updateMaxQ(
  currentMaxQ,
  candidate
) {
  assertObject(
    candidate,
    "candidate"
  );

  assertNonNegativeNumber(
    candidate.dynamicPressure,
    "candidate.dynamicPressure"
  );

  assertNonNegativeNumber(
    candidate.time,
    "candidate.time"
  );

  assertFiniteNumber(
    candidate.altitude,
    "candidate.altitude"
  );

  if (
    candidate.mach !== null &&
    candidate.mach !== undefined
  ) {
    assertNonNegativeNumber(
      candidate.mach,
      "candidate.mach"
    );
  }

  if (
    currentMaxQ === null ||
    candidate.dynamicPressure >
      currentMaxQ.dynamicPressure
  ) {
    return Object.freeze({
      time:
        candidate.time,

      altitude:
        candidate.altitude,

      dynamicPressure:
        candidate.dynamicPressure,

      mach:
        candidate.mach ?? null,
    });
  }

  return currentMaxQ;
}
