/**
 * @file orbit.js
 * @description Planar two-body orbital-state analysis for AscentBench.
 * Derives osculating orbital quantities from an instantaneous Earth-centred
 * position and velocity, including energy, angular momentum, eccentricity,
 * semi-major axis, periapsis, apoapsis, and period where defined.
 *
 * Model scope: 2D Keplerian analysis; no J2, third bodies, atmospheric drag,
 * inclination, or long-term perturbation propagation.
 */
import {
  MU_EARTH,
  R_EARTH,
} from "./constants.js";


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


function assertNonNegativeNumber(value, name) {
  assertFiniteNumber(value, name);

  if (value < 0) {
    throw new RangeError(
      `${name} cannot be negative.`
    );
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
 * Magnitude of a 2D vector.
 */
export function getVectorMagnitude(
  vector
) {
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
 * 2D scalar cross product:
 *
 *   h = x*vy - y*vx
 *
 * In planar orbital mechanics this is the z-component of specific angular
 * momentum.
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
// 3. RADIUS / ALTITUDE
// =============================================================================

/**
 * Earth-centred radius:
 *
 *   r = |position|
 */
export function getOrbitalRadius(
  position
) {
  const radius =
    getVectorMagnitude(
      position
    );

  assertPositiveNumber(
    radius,
    "orbital radius"
  );

  return radius;
}


/**
 * Geometric altitude relative to the project's mean Earth radius:
 *
 *   h = r - R_EARTH
 */
export function getOrbitalAltitude(
  position
) {
  return (
    getOrbitalRadius(
      position
    ) -
    R_EARTH
  );
}


// =============================================================================
// 4. RADIAL / TANGENTIAL VELOCITY
// =============================================================================

/**
 * Decompose velocity into radial and signed tangential components.
 *
 * Radial:
 *
 *   v_r = (r dot v) / |r|
 *
 * Tangential magnitude/sign:
 *
 *   v_t = h / |r|
 *
 * where:
 *
 *   h = x*vy - y*vx
 */
export function getOrbitalVelocityComponents({
  position,
  velocity,
}) {
  assertVector2(
    position,
    "position"
  );

  assertVector2(
    velocity,
    "velocity"
  );

  const radius =
    getOrbitalRadius(
      position
    );

  const radialVelocity =
    dot2(
      position,
      velocity
    ) /
    radius;

  const specificAngularMomentum =
    cross2(
      position,
      velocity
    );

  const tangentialVelocity =
    specificAngularMomentum /
    radius;

  return Object.freeze({
    radialVelocity,
    tangentialVelocity,
    specificAngularMomentum,
  });
}


// =============================================================================
// 5. SPECIFIC ORBITAL ENERGY
// =============================================================================

/**
 * Specific mechanical orbital energy:
 *
 *   epsilon =
 *     v^2 / 2
 *     - mu / r
 *
 * Interpretation:
 *
 *   epsilon < 0  -> bound elliptical/circular orbit
 *   epsilon = 0  -> parabolic escape boundary
 *   epsilon > 0  -> hyperbolic escape trajectory
 */
export function getSpecificOrbitalEnergy({
  position,
  velocity,
  mu = MU_EARTH,
}) {
  assertVector2(
    position,
    "position"
  );

  assertVector2(
    velocity,
    "velocity"
  );

  assertPositiveNumber(
    mu,
    "mu"
  );

  const radius =
    getOrbitalRadius(
      position
    );

  const speed =
    getVectorMagnitude(
      velocity
    );

  return (
    0.5 *
    speed *
    speed
    -
    mu /
    radius
  );
}


// =============================================================================
// 6. SPECIFIC ANGULAR MOMENTUM
// =============================================================================

/**
 * Planar specific angular momentum:
 *
 *   h = r x v
 *     = x*vy - y*vx
 *
 * The sign indicates orbital direction in the 2D plane.
 */
export function getSpecificAngularMomentum({
  position,
  velocity,
}) {
  return cross2(
    position,
    velocity
  );
}


// =============================================================================
// 7. ECCENTRICITY
// =============================================================================

/**
 * Orbital eccentricity magnitude:
 *
 *   e =
 *     sqrt(
 *       1 +
 *       2*epsilon*h^2 / mu^2
 *     )
 *
 * Numerical roundoff can make the expression slightly negative for an almost
 * perfectly circular orbit, so the radicand is clamped at zero.
 */
export function getOrbitalEccentricity({
  specificEnergy,
  specificAngularMomentum,
  mu = MU_EARTH,
}) {
  assertFiniteNumber(
    specificEnergy,
    "specificEnergy"
  );

  assertFiniteNumber(
    specificAngularMomentum,
    "specificAngularMomentum"
  );

  assertPositiveNumber(
    mu,
    "mu"
  );

  const radicand =
    1 +
    (
      2 *
      specificEnergy *
      specificAngularMomentum *
      specificAngularMomentum
    ) /
    (
      mu *
      mu
    );

  return Math.sqrt(
    Math.max(
      0,
      radicand
    )
  );
}


// =============================================================================
// 8. SEMI-MAJOR AXIS
// =============================================================================

/**
 * Semi-major axis:
 *
 *   a = -mu / (2*epsilon)
 *
 * For:
 *   epsilon < 0 -> positive a, bound ellipse
 *   epsilon > 0 -> negative a, hyperbola
 *   epsilon = 0 -> infinite a, parabola
 */
export function getSemiMajorAxis({
  specificEnergy,
  mu = MU_EARTH,
  zeroTolerance = 1e-12,
}) {
  assertFiniteNumber(
    specificEnergy,
    "specificEnergy"
  );

  assertPositiveNumber(
    mu,
    "mu"
  );

  assertNonNegativeNumber(
    zeroTolerance,
    "zeroTolerance"
  );

  if (
    Math.abs(
      specificEnergy
    ) <= zeroTolerance
  ) {
    return Infinity;
  }

  return (
    -mu /
    (
      2 *
      specificEnergy
    )
  );
}


// =============================================================================
// 9. PERIAPSIS / APOAPSIS
// =============================================================================

/**
 * Periapsis radius.
 *
 * For an ellipse:
 *
 *   rp = a(1-e)
 *
 * More generally, using angular momentum:
 *
 *   p = h^2 / mu
 *
 *   rp = p / (1 + e)
 *
 * The p-form also works cleanly for hyperbolic trajectories.
 */
export function getPeriapsisRadius({
  specificAngularMomentum,
  eccentricity,
  mu = MU_EARTH,
}) {
  assertFiniteNumber(
    specificAngularMomentum,
    "specificAngularMomentum"
  );

  assertNonNegativeNumber(
    eccentricity,
    "eccentricity"
  );

  assertPositiveNumber(
    mu,
    "mu"
  );

  const semiLatusRectum =
    (
      specificAngularMomentum *
      specificAngularMomentum
    ) /
    mu;

  return (
    semiLatusRectum /
    (
      1 +
      eccentricity
    )
  );
}


/**
 * Apoapsis radius exists only for a bound orbit:
 *
 *   ra = a(1+e)
 *
 * For parabolic/hyperbolic trajectories there is no finite apoapsis.
 */
export function getApoapsisRadius({
  semiMajorAxis,
  eccentricity,
  specificEnergy,
}) {
  assertFiniteNumber(
    eccentricity,
    "eccentricity"
  );

  assertFiniteNumber(
    specificEnergy,
    "specificEnergy"
  );

  if (
    specificEnergy >= 0
  ) {
    return Infinity;
  }

  assertPositiveNumber(
    semiMajorAxis,
    "semiMajorAxis"
  );

  return (
    semiMajorAxis *
    (
      1 +
      eccentricity
    )
  );
}


// =============================================================================
// 10. ORBITAL PERIOD
// =============================================================================

/**
 * Orbital period for a bound elliptical orbit:
 *
 *   T =
 *     2*pi *
 *     sqrt(a^3 / mu)
 *
 * Returns Infinity for unbound trajectories.
 */
export function getOrbitalPeriod({
  semiMajorAxis,
  specificEnergy,
  mu = MU_EARTH,
}) {
  assertFiniteNumber(
    specificEnergy,
    "specificEnergy"
  );

  assertPositiveNumber(
    mu,
    "mu"
  );

  if (
    specificEnergy >= 0
  ) {
    return Infinity;
  }

  assertPositiveNumber(
    semiMajorAxis,
    "semiMajorAxis"
  );

  return (
    2 *
    Math.PI *
    Math.sqrt(
      (
        semiMajorAxis *
        semiMajorAxis *
        semiMajorAxis
      ) /
      mu
    )
  );
}


// =============================================================================
// 11. CIRCULAR / ESCAPE SPEED
// =============================================================================

/**
 * Circular-orbit speed at radius r:
 *
 *   v_c = sqrt(mu/r)
 */
export function getCircularSpeed({
  radius,
  mu = MU_EARTH,
}) {
  assertPositiveNumber(
    radius,
    "radius"
  );

  assertPositiveNumber(
    mu,
    "mu"
  );

  return Math.sqrt(
    mu /
    radius
  );
}


/**
 * Escape speed at radius r:
 *
 *   v_e = sqrt(2*mu/r)
 */
export function getEscapeSpeed({
  radius,
  mu = MU_EARTH,
}) {
  assertPositiveNumber(
    radius,
    "radius"
  );

  assertPositiveNumber(
    mu,
    "mu"
  );

  return Math.sqrt(
    (
      2 *
      mu
    ) /
    radius
  );
}


// =============================================================================
// 12. VIS-VIVA
// =============================================================================

/**
 * Speed predicted by the vis-viva equation:
 *
 *   v^2 =
 *     mu *
 *     (
 *       2/r - 1/a
 *     )
 *
 * Useful mainly for verification.
 */
export function getVisVivaSpeed({
  radius,
  semiMajorAxis,
  mu = MU_EARTH,
}) {
  assertPositiveNumber(
    radius,
    "radius"
  );

  assertPositiveNumber(
    mu,
    "mu"
  );

  if (
    semiMajorAxis === Infinity
  ) {
    return Math.sqrt(
      2 *
      mu /
      radius
    );
  }

  assertFiniteNumber(
    semiMajorAxis,
    "semiMajorAxis"
  );

  const speedSquared =
    mu *
    (
      2 /
      radius
      -
      1 /
      semiMajorAxis
    );

  if (
    speedSquared < 0
  ) {
    throw new RangeError(
      "Vis-viva calculation produced negative speed squared."
    );
  }

  return Math.sqrt(
    speedSquared
  );
}


// =============================================================================
// 13. COMPLETE ORBITAL STATE
// =============================================================================

/**
 * Main orbital-analysis function.
 *
 * Intended use:
 *
 *   const orbit = getOrbitFromState({
 *     position: {x, y},
 *     velocity: {x: vx, y: vy}
 *   });
 */
export function getOrbitFromState({
  position,
  velocity,
  mu = MU_EARTH,
  bodyRadius = R_EARTH,
}) {
  assertVector2(
    position,
    "position"
  );

  assertVector2(
    velocity,
    "velocity"
  );

  assertPositiveNumber(
    mu,
    "mu"
  );

  assertPositiveNumber(
    bodyRadius,
    "bodyRadius"
  );

  const radius =
    getOrbitalRadius(
      position
    );

  const altitude =
    radius -
    bodyRadius;

  const speed =
    getVectorMagnitude(
      velocity
    );

  const {
    radialVelocity,
    tangentialVelocity,
    specificAngularMomentum,
  } =
    getOrbitalVelocityComponents({
      position,
      velocity,
    });

  const specificEnergy =
    getSpecificOrbitalEnergy({
      position,
      velocity,
      mu,
    });

  const eccentricity =
    getOrbitalEccentricity({
      specificEnergy,
      specificAngularMomentum,
      mu,
    });

  const semiMajorAxis =
    getSemiMajorAxis({
      specificEnergy,
      mu,
    });

  const periapsisRadius =
    getPeriapsisRadius({
      specificAngularMomentum,
      eccentricity,
      mu,
    });

  const apoapsisRadius =
    getApoapsisRadius({
      semiMajorAxis,
      eccentricity,
      specificEnergy,
    });

  const periapsisAltitude =
    periapsisRadius -
    bodyRadius;

  const apoapsisAltitude =
    apoapsisRadius === Infinity
      ? Infinity
      : apoapsisRadius -
        bodyRadius;

  const orbitalPeriod =
    getOrbitalPeriod({
      semiMajorAxis,
      specificEnergy,
      mu,
    });

  const circularSpeed =
    getCircularSpeed({
      radius,
      mu,
    });

  const escapeSpeed =
    getEscapeSpeed({
      radius,
      mu,
    });

  const isBound =
    specificEnergy < 0;

  const isEscape =
    specificEnergy >= 0;

  const intersectsBody =
    periapsisRadius <
    bodyRadius;

  return Object.freeze({
    model:
      "TWO_BODY_PLANAR_KEPLERIAN",

    position:
      freezeVector(position),

    velocity:
      freezeVector(velocity),

    radius,
    altitude,
    speed,

    radialVelocity,
    tangentialVelocity,

    specificEnergy,
    specificAngularMomentum,

    eccentricity,
    semiMajorAxis,

    periapsisRadius,
    periapsisAltitude,

    apoapsisRadius,
    apoapsisAltitude,

    orbitalPeriod,

    circularSpeed,
    escapeSpeed,

    isBound,
    isEscape,
    intersectsBody,
  });
}


// =============================================================================
// 14. ORBIT CLASSIFICATION
// =============================================================================

/**
 * Generic qualitative orbit classification.
 *
 * This does NOT yet judge a specific mission target.
 *
 * Categories:
 *
 *   "ESCAPE"
 *   "SUBORBITAL"
 *   "BOUND_ORBIT"
 */
export function classifyOrbit(
  orbit,
  bodyRadius = R_EARTH
) {
  assertObject(
    orbit,
    "orbit"
  );

  assertPositiveNumber(
    bodyRadius,
    "bodyRadius"
  );

  if (
    orbit.specificEnergy >= 0
  ) {
    return "ESCAPE";
  }

  if (
    orbit.periapsisRadius <
    bodyRadius
  ) {
    return "SUBORBITAL";
  }

  return "BOUND_ORBIT";
}


// =============================================================================
// 15. TARGET-ORBIT VALIDATION
// =============================================================================

/**
 * Compare an achieved orbit with a target periapsis / apoapsis band.
 *
 * Example target:
 *
 *   {
 *     periapsisAltitude: 200_000,
 *     apoapsisAltitude: 200_000,
 *     altitudeTolerance: 20_000
 *   }
 *
 * A circular target is represented simply by equal periapsis and apoapsis.
 *
 * This is deliberately based on ORBIT GEOMETRY, not a scalar mission Δv.
 */
export function evaluateTargetOrbit({
  orbit,

  targetPeriapsisAltitude,
  targetApoapsisAltitude,

  altitudeTolerance = 10_000,

  bodyRadius = R_EARTH,
}) {
  assertObject(
    orbit,
    "orbit"
  );

  assertFiniteNumber(
    targetPeriapsisAltitude,
    "targetPeriapsisAltitude"
  );

  assertFiniteNumber(
    targetApoapsisAltitude,
    "targetApoapsisAltitude"
  );

  assertNonNegativeNumber(
    altitudeTolerance,
    "altitudeTolerance"
  );

  assertPositiveNumber(
    bodyRadius,
    "bodyRadius"
  );

  const basicClass =
    classifyOrbit(
      orbit,
      bodyRadius
    );

  if (
    basicClass === "ESCAPE"
  ) {
    return Object.freeze({
      classification:
        "ESCAPE",

      reachedTarget:
        false,

      periapsisError:
        null,

      apoapsisError:
        null,
    });
  }

  if (
    basicClass === "SUBORBITAL"
  ) {
    return Object.freeze({
      classification:
        "SUBORBITAL",

      reachedTarget:
        false,

      periapsisError:
        orbit.periapsisAltitude -
        targetPeriapsisAltitude,

      apoapsisError:
        orbit.apoapsisAltitude -
        targetApoapsisAltitude,
    });
  }

  const periapsisError =
    orbit.periapsisAltitude -
    targetPeriapsisAltitude;

  const apoapsisError =
    orbit.apoapsisAltitude -
    targetApoapsisAltitude;

  const periapsisWithinTolerance =
    Math.abs(
      periapsisError
    ) <=
    altitudeTolerance;

  const apoapsisWithinTolerance =
    Math.abs(
      apoapsisError
    ) <=
    altitudeTolerance;

  const reachedTarget =
    periapsisWithinTolerance &&
    apoapsisWithinTolerance;

  let classification;

  if (
    reachedTarget
  ) {
    classification =
      "TARGET_ORBIT";
  } else if (
    periapsisWithinTolerance ||
    apoapsisWithinTolerance
  ) {
    classification =
      "NEAR_TARGET";
  } else {
    classification =
      "BOUND_OFF_TARGET";
  }

  return Object.freeze({
    classification,
    reachedTarget,

    targetPeriapsisAltitude,
    targetApoapsisAltitude,
    altitudeTolerance,

    achievedPeriapsisAltitude:
      orbit.periapsisAltitude,

    achievedApoapsisAltitude:
      orbit.apoapsisAltitude,

    periapsisError,
    apoapsisError,

    periapsisWithinTolerance,
    apoapsisWithinTolerance,
  });
}


// =============================================================================
// 16. FULL ORBIT REPORT
// =============================================================================

/**
 * Convenience wrapper:
 *
 * state:
 *
 *   {
 *     x,
 *     y,
 *     vx,
 *     vy
 *   }
 *
 * optional target:
 *
 *   {
 *     periapsisAltitude,
 *     apoapsisAltitude,
 *     altitudeTolerance
 *   }
 */
export function createOrbitReport({
  state,
  target = null,
  mu = MU_EARTH,
  bodyRadius = R_EARTH,
}) {
  assertObject(
    state,
    "state"
  );

  const position = {
    x: state.x,
    y: state.y,
  };

  const velocity = {
    x: state.vx,
    y: state.vy,
  };

  const orbit =
    getOrbitFromState({
      position,
      velocity,
      mu,
      bodyRadius,
    });

  const basicClassification =
    classifyOrbit(
      orbit,
      bodyRadius
    );

  let targetEvaluation = null;

  if (target !== null) {
    assertObject(
      target,
      "target"
    );

    targetEvaluation =
      evaluateTargetOrbit({
        orbit,

        targetPeriapsisAltitude:
          target.periapsisAltitude,

        targetApoapsisAltitude:
          target.apoapsisAltitude,

        altitudeTolerance:
          target.altitudeTolerance ??
          10_000,

        bodyRadius,
      });
  }

  return Object.freeze({
    orbit,

    basicClassification,

    targetEvaluation,
  });
}
