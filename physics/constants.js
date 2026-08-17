/**
 * @file constants.js
 * @description Shared physical and reference constants for AscentBench.
 * Constants use SI units and are intentionally separated from vehicle-specific
 * data, solver settings, and atmosphere layer tables. The current trajectory
 * model uses a spherical Earth approximation.
 */
// -----------------------------------------------------------------------------
// Physical reference constants
// -----------------------------------------------------------------------------

export const PHYSICS = Object.freeze({
  /**
   * Standard acceleration of gravity, g0.
   * Used in relations such as:
   * Unit: m/s^2
   */
  STANDARD_GRAVITY: 9.80665,
});


// -----------------------------------------------------------------------------
// Earth model
// -----------------------------------------------------------------------------

export const EARTH = Object.freeze({
  /**
   * Standard gravitational parameter of Earth, μ = GM.
   *
   * Use μ directly for orbital/gravity calculations:
   *   g(r) = μ / r^2
   *   vCircular(r) = sqrt(μ / r)
   *
   * Unit: m^3/s^2
   */
  MU: 3.986004418e14,

  /**
   * Mean Earth radius used by the current spherical-Earth model.
   *
   * This is a MODEL APPROXIMATION. Earth is not a perfect sphere.
   *
   * Unit: m
   */
  MEAN_RADIUS: 6_371_000,

  /**
   * Earth angular rotation rate.
   *
   * Not required for the first non-rotating 2D ascent solver,
   * and retained for future rotating-frame extensions.
   *
   * Unit: rad/s
   */
  ROTATION_RATE: 7.292115e-5,
});


// -----------------------------------------------------------------------------
// Standard-atmosphere reference values
// -----------------------------------------------------------------------------

export const ATMOSPHERE = Object.freeze({
  /**
   * Standard sea-level temperature.
   * Unit: K
   */
  SEA_LEVEL_TEMPERATURE: 288.15,

  /**
   * Standard sea-level pressure.
   * Unit: Pa
   */
  SEA_LEVEL_PRESSURE: 101_325,

  /**
   * Reference sea-level density.
   *
   * Prefer deriving density inside atmosphere.js using:
   *   rho = P / (R * T)
   *
   * Keep this value mainly for verification tests.
   *
   * Unit: kg/m^3
   */
  SEA_LEVEL_DENSITY_REFERENCE: 1.225,

  /**
   * Specific gas constant for dry air.
   * Unit: J/(kg*K)
   */
  GAS_CONSTANT_DRY_AIR: 287.05,

  /**
   * Ratio of specific heats for the simplified calorically-perfect
   * dry-air model.
   *
   * Dimensionless.
   */
  GAMMA_DRY_AIR: 1.4,
});


// -----------------------------------------------------------------------------
// Derived mathematical conversion constants
// -----------------------------------------------------------------------------

export const MATH = Object.freeze({
  DEG_TO_RAD: Math.PI / 180,
  RAD_TO_DEG: 180 / Math.PI,
});


// -----------------------------------------------------------------------------
// Convenience named exports
// -----------------------------------------------------------------------------
//
// These keep equations readable in physics modules:
//
//   import { MU_EARTH, R_EARTH, G0 } from "./constants.js";
//
// instead of:
//
//   import { EARTH, PHYSICS } from "./constants.js";
// -----------------------------------------------------------------------------

export const G0 = PHYSICS.STANDARD_GRAVITY;

export const MU_EARTH = EARTH.MU;
export const R_EARTH = EARTH.MEAN_RADIUS;
export const OMEGA_EARTH = EARTH.ROTATION_RATE;

export const T0 = ATMOSPHERE.SEA_LEVEL_TEMPERATURE;
export const P0 = ATMOSPHERE.SEA_LEVEL_PRESSURE;
export const R_AIR = ATMOSPHERE.GAS_CONSTANT_DRY_AIR;
export const GAMMA_AIR = ATMOSPHERE.GAMMA_DRY_AIR;