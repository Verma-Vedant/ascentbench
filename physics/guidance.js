/**
 * @file guidance.js
 * @description Mathematical 2D thrust-direction primitives for AscentBench.
 * Provides radial, tangential, velocity-aligned, and radial/tangential blend
 * directions in an Earth-centred frame. Mission-specific pitch schedules and
 * closed-loop flight guidance belong to the Analyzer guidance-profile layer.
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


function assertBlendFactor(value) {
  assertFiniteNumber(
    value,
    "blendFactor"
  );

  if (value < 0 || value > 1) {
    throw new RangeError(
      "blendFactor must be between 0 and 1."
    );
  }
}


function assertProgradeSign(value) {
  if (value !== 1 && value !== -1) {
    throw new RangeError(
      "progradeSign must be either +1 or -1."
    );
  }
}


function freezeVector(vector) {
  return Object.freeze({
    x: vector.x,
    y: vector.y,
  });
}


// =============================================================================
// 2. BASIC VECTOR MATH
// =============================================================================

/**
 * Magnitude of a 2D vector:
 *
 *   |v| = sqrt(vx^2 + vy^2)
 */
export function getVectorMagnitude(vector) {
  assertVector2(
    vector,
    "vector"
  );

  return Math.hypot(
    vector.x,
    vector.y
  );
}


/**
 * Normalize a vector.
 *
 * Unlike some generic vector helpers, this function does NOT silently
 * normalize a zero vector because guidance direction would then be undefined.
 */
export function normalizeVector(vector) {
  assertVector2(
    vector,
    "vector"
  );

  const magnitude =
    getVectorMagnitude(
      vector
    );

  if (magnitude === 0) {
    throw new RangeError(
      "Cannot normalize a zero vector."
    );
  }

  return freezeVector({
    x: vector.x / magnitude,
    y: vector.y / magnitude,
  });
}


/**
 * Dot product:
 *
 *   a dot b = ax*bx + ay*by
 */
export function dot2(a, b) {
  assertVector2(a, "a");
  assertVector2(b, "b");

  return (
    a.x * b.x +
    a.y * b.y
  );
}


/**
 * Scalar 2D cross-product equivalent:
 *
 *   crossZ(a,b) = ax*by - ay*bx
 *
 * This is the z-component that would result if the two 2D vectors were
 * embedded in 3D.
 */
export function cross2(a, b) {
  assertVector2(a, "a");
  assertVector2(b, "b");

  return (
    a.x * b.y -
    a.y * b.x
  );
}


// =============================================================================
// 3. LOCAL RADIAL / TANGENTIAL FRAME
// =============================================================================

/**
 * Unit vector pointing radially outward from Earth's centre.
 *
 *   r_hat = r / |r|
 */
export function getRadialUnitVector(
  position
) {
  assertVector2(
    position,
    "position"
  );

  return normalizeVector(
    position
  );
}


/**
 * Unit vector perpendicular to radial direction.
 *
 * For progradeSign = +1:
 *
 *   t_hat = (-r_y, r_x)
 *
 * which is a +90 degree rotation in the 2D plane.
 *
 * progradeSign = -1 selects the opposite tangent.
 *
 * This is only a mathematical 2D direction convention. It is not a
 * real-world launch-azimuth recommendation.
 */
export function getTangentialUnitVector(
  position,
  progradeSign = 1
) {
  assertProgradeSign(
    progradeSign
  );

  const radial =
    getRadialUnitVector(
      position
    );

  return freezeVector({
    x:
      -radial.y *
      progradeSign,

    y:
      radial.x *
      progradeSign,
  });
}


// =============================================================================
// 4. VELOCITY DECOMPOSITION
// =============================================================================

/**
 * Decompose velocity into local radial and tangential components.
 *
 * Returns:
 *
 *   radialVelocity     = v dot r_hat
 *   tangentialVelocity = v dot t_hat
 */
export function decomposeVelocity({
  position,
  velocity,
  progradeSign = 1,
}) {
  assertVector2(
    position,
    "position"
  );

  assertVector2(
    velocity,
    "velocity"
  );

  assertProgradeSign(
    progradeSign
  );

  const radialDirection =
    getRadialUnitVector(
      position
    );

  const tangentialDirection =
    getTangentialUnitVector(
      position,
      progradeSign
    );

  const radialVelocity =
    dot2(
      velocity,
      radialDirection
    );

  const tangentialVelocity =
    dot2(
      velocity,
      tangentialDirection
    );

  return Object.freeze({
    radialVelocity,
    tangentialVelocity,
    radialDirection,
    tangentialDirection,
  });
}


// =============================================================================
// 5. FLIGHT-PATH ANGLE
// =============================================================================

/**
 * Flight-path angle gamma:
 *
 *   gamma = atan2(v_r, v_t)
 *
 * Using our local convention:
 *
 *   +pi/2 -> radial outward
 *    0     -> tangential
 *   -pi/2 -> radial inward
 *
 * If velocity is exactly zero, gamma is undefined and this function
 * returns null.
 */
export function getFlightPathAngle({
  position,
  velocity,
  progradeSign = 1,
}) {
  const speed =
    getVectorMagnitude(
      velocity
    );

  if (speed === 0) {
    return null;
  }

  const {
    radialVelocity,
    tangentialVelocity,
  } = decomposeVelocity({
    position,
    velocity,
    progradeSign,
  });

  return Math.atan2(
    radialVelocity,
    tangentialVelocity
  );
}


// =============================================================================
// 6. LOCAL PITCH ANGLE FROM A DIRECTION VECTOR
// =============================================================================

/**
 * Convert any non-zero direction vector to local pitch angle.
 *
 *   pitch = atan2(radial component, tangential component)
 *
 * Therefore:
 *
 *   pitch = 90 deg -> radial
 *   pitch = 0 deg  -> tangential
 */
export function getLocalPitchAngle({
  position,
  direction,
  progradeSign = 1,
}) {
  const unitDirection =
    normalizeVector(
      direction
    );

  const radial =
    getRadialUnitVector(
      position
    );

  const tangent =
    getTangentialUnitVector(
      position,
      progradeSign
    );

  const radialComponent =
    dot2(
      unitDirection,
      radial
    );

  const tangentialComponent =
    dot2(
      unitDirection,
      tangent
    );

  return Math.atan2(
    radialComponent,
    tangentialComponent
  );
}


// =============================================================================
// 7. SIGNED ANGLE BETWEEN DIRECTIONS
// =============================================================================

/**
 * Signed angle from vector `from` to vector `to`:
 *
 *   angle = atan2(cross(from,to), dot(from,to))
 *
 * Result lies in [-pi, +pi].
 */
export function getSignedAngleBetween(
  from,
  to
) {
  const a =
    normalizeVector(from);

  const b =
    normalizeVector(to);

  return Math.atan2(
    cross2(a, b),
    dot2(a, b)
  );
}


// =============================================================================
// 8. ANGLE OF ATTACK APPROXIMATION
// =============================================================================

/**
 * Simplified 2D angle of attack:
 *
 *   alpha = signed angle from velocity direction to thrust/body direction
 *
 * In the current simplified model, thrust direction is treated as a proxy for
 * vehicle body-axis direction.
 *
 * If velocity is zero, angle of attack is undefined and null is returned.
 */
export function getAngleOfAttack({
  velocity,
  thrustDirection,
}) {
  assertVector2(
    velocity,
    "velocity"
  );

  assertVector2(
    thrustDirection,
    "thrustDirection"
  );

  if (
    getVectorMagnitude(
      velocity
    ) === 0
  ) {
    return null;
  }

  return getSignedAngleBetween(
    velocity,
    thrustDirection
  );
}


// =============================================================================
// 9. RADIAL-TANGENTIAL DIRECTION BLEND
// =============================================================================

/**
 * Build an abstract thrust direction by blending local radial and tangential
 * unit vectors.
 *
 * blendFactor = 0:
 *   radial
 *
 * blendFactor = 1:
 *   tangential
 *
 * 0 < blendFactor < 1:
 *   normalized direction between them
 *
 * The interpolation is intentionally abstract. It does NOT define when or
 * how a real vehicle should transition between these directions.
 */
export function getRadialTangentialBlendDirection({
  position,
  blendFactor,
  progradeSign = 1,
}) {
  assertBlendFactor(
    blendFactor
  );

  const radial =
    getRadialUnitVector(
      position
    );

  const tangent =
    getTangentialUnitVector(
      position,
      progradeSign
    );

  const blended = {
    x:
      (1 - blendFactor) *
      radial.x +
      blendFactor *
      tangent.x,

    y:
      (1 - blendFactor) *
      radial.y +
      blendFactor *
      tangent.y,
  };

  return normalizeVector(
    blended
  );
}


// =============================================================================
// 10. VELOCITY-ALIGNED DIRECTION
// =============================================================================

/**
 * Return a direction aligned with current velocity.
 *
 * If speed is zero, no velocity direction exists; the function returns the
 * caller-supplied fallbackDirection.
 */
export function getVelocityAlignedDirection({
  velocity,
  fallbackDirection,
}) {
  assertVector2(
    velocity,
    "velocity"
  );

  assertVector2(
    fallbackDirection,
    "fallbackDirection"
  );

  if (
    getVectorMagnitude(
      velocity
    ) === 0
  ) {
    return normalizeVector(
      fallbackDirection
    );
  }

  return normalizeVector(
    velocity
  );
}


// =============================================================================
// 11. MAIN GUIDANCE STATE
// =============================================================================

/**
 * Main guidance function intended for dynamics.js.
 *
 * Supported modes:
 *
 *   "radial"
 *   "tangential"
 *   "velocityAligned"
 *   "radialTangentialBlend"
 *
 * NOTE:
 * This function chooses direction only from explicitly supplied abstract
 * inputs. It does not contain a vehicle-specific flight schedule.
 *
 * @param {object} config
 * @returns {object}
 */
export function getGuidanceState({
  position,
  velocity,

  mode = "velocityAligned",

  blendFactor = 0,

  progradeSign = 1,
}) {
  assertVector2(
    position,
    "position"
  );

  assertVector2(
    velocity,
    "velocity"
  );

  assertProgradeSign(
    progradeSign
  );

  const radialDirection =
    getRadialUnitVector(
      position
    );

  const tangentialDirection =
    getTangentialUnitVector(
      position,
      progradeSign
    );

  let thrustDirection;

  switch (mode) {
    case "radial":
      thrustDirection =
        radialDirection;
      break;

    case "tangential":
      thrustDirection =
        tangentialDirection;
      break;

    case "velocityAligned":
      thrustDirection =
        getVelocityAlignedDirection({
          velocity,
          fallbackDirection:
            radialDirection,
        });
      break;

    case "radialTangentialBlend":
      thrustDirection =
        getRadialTangentialBlendDirection({
          position,
          blendFactor,
          progradeSign,
        });
      break;

    default:
      throw new RangeError(
        `Unknown guidance mode: "${mode}".`
      );
  }

  const flightPathAngle =
    getFlightPathAngle({
      position,
      velocity,
      progradeSign,
    });

  const pitchAngle =
    getLocalPitchAngle({
      position,
      direction:
        thrustDirection,
      progradeSign,
    });

  const angleOfAttack =
    getAngleOfAttack({
      velocity,
      thrustDirection,
    });

  return Object.freeze({
    model:
      "ABSTRACT_2D_DIRECTION_GUIDANCE",

    mode,

    thrustDirection,

    radialDirection,
    tangentialDirection,

    pitchAngle,
    flightPathAngle,
    angleOfAttack,

    blendFactor:
      mode ===
      "radialTangentialBlend"
        ? blendFactor
        : null,

    progradeSign,
  });
}


// =============================================================================
// 12. ANGLE DISPLAY HELPERS
// =============================================================================

/**
 * Convert radians to degrees.
 */
export function radiansToDegrees(
  radians
) {
  assertFiniteNumber(
    radians,
    "radians"
  );

  return (
    radians *
    180 /
    Math.PI
  );
}


/**
 * Convert degrees to radians.
 */
export function degreesToRadians(
  degrees
) {
  assertFiniteNumber(
    degrees,
    "degrees"
  );

  return (
    degrees *
    Math.PI /
    180
  );
}
