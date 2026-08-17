/**
 * @file gravity.js
 * @description Spherical-Earth gravity and orbital-speed utilities for AscentBench.
 * Gravity is central and follows the inverse-square law using Earth's gravitational
 * parameter. J2, oblateness, third-body gravity, terrain, and local anomalies are
 * outside the current model. Units are SI.
 */
import { MU_EARTH, R_EARTH } from "./constants.js";


// -----------------------------------------------------------------------------
// Internal validation helpers
// -----------------------------------------------------------------------------

function assertFiniteNumber(value, name) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number.`);
  }
}

function assertPositiveRadius(radius) {
  assertFiniteNumber(radius, "radius");

  if (radius <= 0) {
    throw new RangeError("radius must be greater than 0 m.");
  }
}

function assertPosition(position) {
  if (
    !position ||
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y)
  ) {
    throw new TypeError(
      "position must be an object with finite numeric x and y values."
    );
  }

  const radius = Math.hypot(position.x, position.y);

  if (radius <= 0) {
    throw new RangeError("position cannot be at Earth's centre.");
  }

  return radius;
}


// -----------------------------------------------------------------------------
// Geometry helpers
// -----------------------------------------------------------------------------

/**
 * Converts altitude above the spherical reference Earth to geocentric radius.
 *
 * r = R_E + h
 *
 * @param {number} altitude - Altitude above reference Earth radius [m].
 * @returns {number} Geocentric radius [m].
 */
export function radiusFromAltitude(altitude) {
  assertFiniteNumber(altitude, "altitude");

  const radius = R_EARTH + altitude;

  if (radius <= 0) {
    throw new RangeError(
      `altitude must be greater than ${-R_EARTH} m for this Earth model.`
    );
  }

  return radius;
}


/**
 * Returns altitude above the spherical reference Earth from a 2D
 * Earth-centred position.
 *
 * h = |r| - R_E
 *
 * @param {{x: number, y: number}} position - Earth-centred position [m].
 * @returns {number} Altitude [m].
 */
export function altitudeFromPosition(position) {
  const radius = assertPosition(position);
  return radius - R_EARTH;
}


/**
 * Returns geocentric distance from a 2D Earth-centred position.
 *
 * r = sqrt(x^2 + y^2)
 *
 * @param {{x: number, y: number}} position - Earth-centred position [m].
 * @returns {number} Radius [m].
 */
export function radiusFromPosition(position) {
  return assertPosition(position);
}


// -----------------------------------------------------------------------------
// Gravity
// -----------------------------------------------------------------------------

/**
 * Magnitude of gravitational acceleration at geocentric radius r.
 *
 * g(r) = μ / r^2
 *
 * @param {number} radius - Distance from Earth's centre [m].
 * @returns {number} Gravitational acceleration magnitude [m/s^2].
 */
export function gravityMagnitudeAtRadius(radius) {
  assertPositiveRadius(radius);
  return MU_EARTH / (radius * radius);
}


/**
 * Magnitude of gravitational acceleration at altitude h.
 *
 * g(h) = μ / (R_E + h)^2
 *
 * @param {number} altitude - Altitude above reference Earth radius [m].
 * @returns {number} Gravitational acceleration magnitude [m/s^2].
 */
export function gravityMagnitudeAtAltitude(altitude) {
  const radius = radiusFromAltitude(altitude);
  return gravityMagnitudeAtRadius(radius);
}


/**
 * Gravitational acceleration vector at a 2D Earth-centred position.
 *
 * a_g = -(μ / |r|^3) r
 *
 * Gravity always points toward Earth's centre.
 *
 * @param {{x: number, y: number}} position - Earth-centred position [m].
 * @returns {{x: number, y: number}} Acceleration vector [m/s^2].
 */
export function gravityVector(position) {
  const radius = assertPosition(position);

  const factor = -MU_EARTH / (radius * radius * radius);

  return {
    x: factor * position.x,
    y: factor * position.y,
  };
}


// -----------------------------------------------------------------------------
// Useful orbital reference speeds
// -----------------------------------------------------------------------------

/**
 * Ideal circular-orbit speed at geocentric radius r.
 *
 * v_c = sqrt(μ / r)
 *
 * This is a reference calculation, NOT a mission-success test by itself.
 *
 * @param {number} radius - Geocentric radius [m].
 * @returns {number} Circular orbital speed [m/s].
 */
export function circularOrbitSpeedAtRadius(radius) {
  assertPositiveRadius(radius);
  return Math.sqrt(MU_EARTH / radius);
}


/**
 * Ideal circular-orbit speed at altitude h.
 *
 * @param {number} altitude - Altitude above reference Earth radius [m].
 * @returns {number} Circular orbital speed [m/s].
 */
export function circularOrbitSpeedAtAltitude(altitude) {
  return circularOrbitSpeedAtRadius(radiusFromAltitude(altitude));
}


/**
 * Ideal two-body escape speed at geocentric radius r.
 *
 * v_esc = sqrt(2μ / r)
 *
 * @param {number} radius - Geocentric radius [m].
 * @returns {number} Escape speed [m/s].
 */
export function escapeSpeedAtRadius(radius) {
  assertPositiveRadius(radius);
  return Math.sqrt((2 * MU_EARTH) / radius);
}


/**
 * Ideal two-body escape speed at altitude h.
 *
 * @param {number} altitude - Altitude above reference Earth radius [m].
 * @returns {number} Escape speed [m/s].
 */
export function escapeSpeedAtAltitude(altitude) {
  return escapeSpeedAtRadius(radiusFromAltitude(altitude));
}

