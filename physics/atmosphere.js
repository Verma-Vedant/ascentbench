/**
 * @file atmosphere.js
 * @description U.S. Standard Atmosphere 1976-style lower-atmosphere model used
 * by AscentBench. Geometric altitude is converted to geopotential altitude before
 * piecewise temperature, pressure, density, and speed-of-sound evaluation.
 *
 * Model scope: lower atmosphere through 86 km geometric altitude; dry air,
 * constant gamma for speed of sound, and no weather, humidity, winds, or
 * thermosphere/exosphere model. Above the model ceiling, callers may request the
 * explicit vacuum approximation or an error.
 */
import {
  G0,
  P0,
  T0,
  R_AIR,
  GAMMA_AIR,
} from "./constants.js";


// =============================================================================
// 1. MODEL CONSTANTS
// =============================================================================

/**
 * Geopotential reference radius used by the U.S. Standard Atmosphere
 * lower-atmosphere altitude conversion.
 *
 * NOTE:
 * This is NOT the same quantity as the mean spherical Earth radius used
 * by gravity.js. It belongs specifically to the standard-atmosphere
 * geopotential-height definition.
 *
 * Unit: m
 */
export const GEOPOTENTIAL_REFERENCE_RADIUS = 6_356_766;

/**
 * The simple lower-atmosphere formulation ends at approximately
 * 84.852 km geopotential altitude, corresponding to 86 km geometric.
 */
export const STANDARD_ATMOSPHERE_TOP_GEOMETRIC = 86_000;

/**
 * Compute the geopotential equivalent of the 86 km geometric model top
 * using the SAME conversion used by the runtime.
 *
 * This avoids a tiny but annoying boundary mismatch caused by rounding
 * 84.852045... km to the commonly quoted 84.852 km.
 */
export const STANDARD_ATMOSPHERE_TOP_GEOPOTENTIAL =
  (
    GEOPOTENTIAL_REFERENCE_RADIUS *
    STANDARD_ATMOSPHERE_TOP_GEOMETRIC
  ) /
  (
    GEOPOTENTIAL_REFERENCE_RADIUS +
    STANDARD_ATMOSPHERE_TOP_GEOMETRIC
  );

/**
 * The published lower atmosphere can be extended below sea level.
 * The model permits geometric altitude down to -5 km for below-sea-level
 * boundary handling.
 */
export const STANDARD_ATMOSPHERE_MIN_GEOMETRIC = -5_000;


// =============================================================================
// 2. RAW LAYER DEFINITION
// =============================================================================

/**
 * Each entry defines the BASE geopotential altitude of a layer and the
 * temperature lapse rate inside that layer.
 *
 * Pressure and temperature are not hard-coded at every
 * boundary. They are propagated continuously from sea level using the
 * hydrostatic + ideal-gas equations.
 *
 * That gives us:
 *   - one source of truth,
 *   - continuity between layers,
 *   - fewer unexplained "magic" pressure constants.
 */
const RAW_LAYERS = Object.freeze([
  Object.freeze({
    name: "Troposphere",
    baseGeopotentialAltitude: 0,
    lapseRate: -0.0065, // K/m
  }),

  Object.freeze({
    name: "Tropopause / Isothermal Layer",
    baseGeopotentialAltitude: 11_000,
    lapseRate: 0,
  }),

  Object.freeze({
    name: "Lower Stratosphere",
    baseGeopotentialAltitude: 20_000,
    lapseRate: 0.0010,
  }),

  Object.freeze({
    name: "Upper Stratosphere",
    baseGeopotentialAltitude: 32_000,
    lapseRate: 0.0028,
  }),

  Object.freeze({
    name: "Stratopause / Isothermal Layer",
    baseGeopotentialAltitude: 47_000,
    lapseRate: 0,
  }),

  Object.freeze({
    name: "Lower Mesosphere",
    baseGeopotentialAltitude: 51_000,
    lapseRate: -0.0028,
  }),

  Object.freeze({
    name: "Upper Mesosphere",
    baseGeopotentialAltitude: 71_000,
    lapseRate: -0.0020,
  }),
]);


// =============================================================================
// 3. INPUT VALIDATION
// =============================================================================

function assertFiniteNumber(value, name) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number.`);
  }
}


// =============================================================================
// 4. GEOMETRIC ↔ GEOPOTENTIAL ALTITUDE
// =============================================================================

/**
 * Convert geometric altitude z to geopotential altitude H.
 *
 * Why this exists:
 * ----------------
 * gravity weakens with geometric altitude, while the standard-atmosphere
 * hydrostatic equations are written using a constant reference gravity.
 * Geopotential altitude is defined so that gravitational potential change
 * can be represented using that constant reference gravity.
 *
 * Formula:
 *
 *          r0 * z
 *   H = ------------
 *          r0 + z
 *
 * where r0 is the standard-atmosphere geopotential reference radius.
 *
 * At low altitude, H ≈ z.
 * At 86 km geometric, H ≈ 84.852 km.
 *
 * @param {number} geometricAltitude - Geometric altitude [m].
 * @returns {number} Geopotential altitude [m].
 */
export function geometricToGeopotentialAltitude(geometricAltitude) {
  assertFiniteNumber(geometricAltitude, "geometricAltitude");

  const denominator =
    GEOPOTENTIAL_REFERENCE_RADIUS + geometricAltitude;

  if (denominator <= 0) {
    throw new RangeError(
      "geometricAltitude is outside the valid geometric domain."
    );
  }

  return (
    GEOPOTENTIAL_REFERENCE_RADIUS * geometricAltitude
  ) / denominator;
}


/**
 * Convert geopotential altitude H back to geometric altitude z.
 *
 * Rearranging:
 *
 *          r0 * H
 *   z = ------------
 *          r0 - H
 *
 * @param {number} geopotentialAltitude - Geopotential altitude [m].
 * @returns {number} Geometric altitude [m].
 */
export function geopotentialToGeometricAltitude(geopotentialAltitude) {
  assertFiniteNumber(geopotentialAltitude, "geopotentialAltitude");

  const denominator =
    GEOPOTENTIAL_REFERENCE_RADIUS - geopotentialAltitude;

  if (denominator <= 0) {
    throw new RangeError(
      "geopotentialAltitude is outside the valid geometric domain."
    );
  }

  return (
    GEOPOTENTIAL_REFERENCE_RADIUS * geopotentialAltitude
  ) / denominator;
}


// =============================================================================
// 5. HYDROSTATIC LAYER EQUATIONS
// =============================================================================

/**
 * Temperature inside a constant-lapse-rate layer:
 *
 *   T = Tb + L(H - Hb)
 *
 * where:
 *   Tb = layer-base temperature
 *   L  = lapse rate
 *   H  = current geopotential altitude
 *   Hb = layer-base geopotential altitude
 */
function temperatureInLayer(
  baseTemperature,
  lapseRate,
  geopotentialDelta
) {
  return baseTemperature + lapseRate * geopotentialDelta;
}


/**
 * Pressure change through a layer with NON-ZERO lapse rate.
 *
 * Starting with:
 *
 *   dP/dH = -rho * g0
 *
 * and:
 *
 *   rho = P / (R*T)
 *
 * gives:
 *
 *   dP/P = -(g0 / (R*T)) dH
 *
 * With:
 *
 *   T = Tb + L(H-Hb)
 *
 * integration produces:
 *
 *                  -g0/(R*L)
 *   P = Pb (T/Tb)
 *
 * This is why each layer needs its own lapse rate.
 */
function pressureWithLapse(
  basePressure,
  baseTemperature,
  temperature,
  lapseRate
) {
  return (
    basePressure *
    Math.pow(
      temperature / baseTemperature,
      -G0 / (R_AIR * lapseRate)
    )
  );
}


/**
 * Pressure change through an ISOTHERMAL layer (L = 0).
 *
 * If temperature is constant, integrating hydrostatic equilibrium gives:
 *
 *   P = Pb * exp[-g0(H-Hb)/(R*Tb)]
 */
function pressureIsothermal(
  basePressure,
  baseTemperature,
  geopotentialDelta
) {
  return (
    basePressure *
    Math.exp(
      (-G0 * geopotentialDelta) /
      (R_AIR * baseTemperature)
    )
  );
}


// =============================================================================
// 6. BUILD CONTINUOUS LAYER BASE STATES
// =============================================================================

/**
 * Build each layer's base temperature and pressure by propagating the
 * previous layer to the next boundary.
 *
 * This prevents discontinuities caused by independently rounded
 * hard-coded base pressures.
 */
function buildLayerTable() {
  const layers = [];

  let baseTemperature = T0;
  let basePressure = P0;

  for (let i = 0; i < RAW_LAYERS.length; i += 1) {
    const raw = RAW_LAYERS[i];

    layers.push({
      index: i,
      name: raw.name,
      baseGeopotentialAltitude:
        raw.baseGeopotentialAltitude,
      lapseRate: raw.lapseRate,
      baseTemperature,
      basePressure,
    });

    const next = RAW_LAYERS[i + 1];

    if (!next) {
      break;
    }

    const deltaH =
      next.baseGeopotentialAltitude -
      raw.baseGeopotentialAltitude;

    if (raw.lapseRate === 0) {
      basePressure = pressureIsothermal(
        basePressure,
        baseTemperature,
        deltaH
      );

      // Temperature remains unchanged in an isothermal layer.
    } else {
      const nextTemperature = temperatureInLayer(
        baseTemperature,
        raw.lapseRate,
        deltaH
      );

      basePressure = pressureWithLapse(
        basePressure,
        baseTemperature,
        nextTemperature,
        raw.lapseRate
      );

      baseTemperature = nextTemperature;
    }
  }

  return Object.freeze(
    layers.map((layer) => Object.freeze(layer))
  );
}

/**
 * Final continuous layer table used by all calculations.
 */
export const ATMOSPHERE_LAYERS = buildLayerTable();


// =============================================================================
// 7. LAYER LOOKUP
// =============================================================================

/**
 * Return the atmospheric layer containing a geopotential altitude.
 *
 * Select the highest layer whose base altitude is <= H.
 */
export function getAtmosphereLayerFromGeopotentialAltitude(
  geopotentialAltitude
) {
  assertFiniteNumber(
    geopotentialAltitude,
    "geopotentialAltitude"
  );

  if (
    geopotentialAltitude >
    STANDARD_ATMOSPHERE_TOP_GEOPOTENTIAL
  ) {
    throw new RangeError(
      `Lower standard-atmosphere model ends at ` +
      `${STANDARD_ATMOSPHERE_TOP_GEOPOTENTIAL} m geopotential altitude.`
    );
  }

  // Negative altitudes use the first layer extrapolated downward.
  let selected = ATMOSPHERE_LAYERS[0];

  for (const layer of ATMOSPHERE_LAYERS) {
    if (
      geopotentialAltitude >=
      layer.baseGeopotentialAltitude
    ) {
      selected = layer;
    } else {
      break;
    }
  }

  return selected;
}


// =============================================================================
// 8. STANDARD-ATMOSPHERE STATE FROM GEOPOTENTIAL ALTITUDE
// =============================================================================

/**
 * Evaluate the lower standard atmosphere directly using geopotential
 * altitude.
 *
 * Most simulation code should use getStandardAtmosphere() instead, because
 * trajectory altitude is geometric. This function is exported mainly for
 * verification and educational transparency.
 *
 * @param {number} geopotentialAltitude - Geopotential altitude [m].
 * @returns {object} Atmospheric state.
 */
export function getAtmosphereFromGeopotentialAltitude(
  geopotentialAltitude
) {
  assertFiniteNumber(
    geopotentialAltitude,
    "geopotentialAltitude"
  );

  if (
    geopotentialAltitude >
    STANDARD_ATMOSPHERE_TOP_GEOPOTENTIAL
  ) {
    throw new RangeError(
      `geopotentialAltitude exceeds the lower-atmosphere model limit of ` +
      `${STANDARD_ATMOSPHERE_TOP_GEOPOTENTIAL} m.`
    );
  }

  const layer =
    getAtmosphereLayerFromGeopotentialAltitude(
      geopotentialAltitude
    );

  const deltaH =
    geopotentialAltitude -
    layer.baseGeopotentialAltitude;

  let temperature;
  let pressure;

  if (layer.lapseRate === 0) {
    temperature = layer.baseTemperature;

    pressure = pressureIsothermal(
      layer.basePressure,
      layer.baseTemperature,
      deltaH
    );
  } else {
    temperature = temperatureInLayer(
      layer.baseTemperature,
      layer.lapseRate,
      deltaH
    );

    pressure = pressureWithLapse(
      layer.basePressure,
      layer.baseTemperature,
      temperature,
      layer.lapseRate
    );
  }

  /**
   * Ideal-gas density:
   *
   *   P = rho R T
   *
   * therefore:
   *
   *   rho = P / (R T)
   */
  const density =
    pressure / (R_AIR * temperature);

  /**
   * Local speed of sound for the simplified calorically-perfect dry-air
   * model:
   *
   *   a = sqrt(gamma R T)
   *
   * Notice that pressure does not appear explicitly.
   */
  const speedOfSound =
    Math.sqrt(
      GAMMA_AIR *
      R_AIR *
      temperature
    );

  return Object.freeze({
    model: "US_STANDARD_ATMOSPHERE_1976_LOWER_APPROX",

    layerIndex: layer.index,
    layerName: layer.name,

    geopotentialAltitude,

    temperature,
    pressure,
    density,
    speedOfSound,

    lapseRate: layer.lapseRate,

    continuumModelValid: true,
    isVacuumApproximation: false,
  });
}


// =============================================================================
// 9. STANDARD ATMOSPHERE FROM GEOMETRIC ALTITUDE
// =============================================================================

/**
 * Strict lower-atmosphere calculation from GEOMETRIC altitude.
 *
 * This is the correct entry point when the rocket trajectory provides:
 *
 *   altitude = |position| - EarthRadius
 *
 * The function converts geometric altitude to geopotential altitude before
 * selecting and evaluating the atmospheric layer.
 *
 * Valid project range:
 *   -5 km <= geometric altitude <= 86 km
 *
 * @param {number} geometricAltitude - Geometric altitude [m].
 * @returns {object} Atmospheric state.
 */
export function getStandardAtmosphere(
  geometricAltitude
) {
  assertFiniteNumber(
    geometricAltitude,
    "geometricAltitude"
  );

  if (
    geometricAltitude <
    STANDARD_ATMOSPHERE_MIN_GEOMETRIC
  ) {
    throw new RangeError(
      `geometricAltitude is below the supported lower limit of ` +
      `${STANDARD_ATMOSPHERE_MIN_GEOMETRIC} m.`
    );
  }

  if (
    geometricAltitude >
    STANDARD_ATMOSPHERE_TOP_GEOMETRIC
  ) {
    throw new RangeError(
      `geometricAltitude exceeds the lower standard-atmosphere ` +
      `model limit of ${STANDARD_ATMOSPHERE_TOP_GEOMETRIC} m.`
    );
  }

  const geopotentialAltitude =
    geometricToGeopotentialAltitude(
      geometricAltitude
    );

  const state =
    getAtmosphereFromGeopotentialAltitude(
      geopotentialAltitude
    );

  return Object.freeze({
    ...state,
    geometricAltitude,
  });
}


// =============================================================================
// 10. ASCENT-SIMULATION WRAPPER
// =============================================================================

/**
 * Atmosphere entry point intended for the full ascent simulation.
 *
 * Below / at 86 km:
 *   → full lower standard-atmosphere calculation.
 *
 * Above 86 km:
 *   → explicit vacuum approximation by default.
 *
 * WHY NOT CONTINUE THE SAME FORMULA ABOVE 86 KM?
 * ----------------------------------------------
 * Because the upper atmosphere requires different physics and composition
 * treatment. Continuing the lower-atmosphere lapse-rate equations would
 * create false precision.
 *
 * For the current launch model, aerodynamic density above this boundary is
 * tiny compared with the dense lower atmosphere. Treating it as vacuum is
 * a deliberate documented simplification.
 *
 * AERODYNAMICS INTERFACE:
 * When `isVacuumApproximation === true`:
 *
 *   - pressure = 0
 *   - density = 0
 *   - speedOfSound = null
 *   - Mach number should therefore be reported as null / not applicable
 *   - drag should be 0
 *
 * Options:
 *   aboveModel: "vacuum" (default)
 *   aboveModel: "error"
 *
 * @param {number} geometricAltitude - Geometric altitude [m].
 * @param {{aboveModel?: "vacuum"|"error"}} [options]
 * @returns {object} Atmospheric state.
 */
export function getAtmosphere(
  geometricAltitude,
  options = {}
) {
  assertFiniteNumber(
    geometricAltitude,
    "geometricAltitude"
  );

  const {
    aboveModel = "vacuum",
  } = options;

  if (
    geometricAltitude <=
    STANDARD_ATMOSPHERE_TOP_GEOMETRIC
  ) {
    return getStandardAtmosphere(
      geometricAltitude
    );
  }

  if (aboveModel === "error") {
    throw new RangeError(
      `No upper-atmosphere model is implemented above ` +
      `${STANDARD_ATMOSPHERE_TOP_GEOMETRIC} m geometric altitude.`
    );
  }

  if (aboveModel !== "vacuum") {
    throw new RangeError(
      `Unknown aboveModel option: "${aboveModel}".`
    );
  }

  const geopotentialAltitude =
    geometricToGeopotentialAltitude(
      geometricAltitude
    );

  return Object.freeze({
    model: "VACUUM_APPROXIMATION_ABOVE_86_KM",

    layerIndex: null,
    layerName: "Near-vacuum approximation",

    geometricAltitude,
    geopotentialAltitude,

    temperature: null,
    pressure: 0,
    density: 0,
    speedOfSound: null,

    lapseRate: null,

    continuumModelValid: false,
    isVacuumApproximation: true,
  });
}


// =============================================================================
// 11. CONVENIENCE RATIOS
// =============================================================================

/**
 * Dimensionless atmospheric ratios relative to standard sea level.
 *
 * theta = T / T0
 * delta = P / P0
 * sigma = rho / rho0
 *
 * Density reference is derived from the SAME constants used by the model:
 *
 *   rho0 = P0 / (R*T0)
 *
 * This avoids mixing a rounded tabulated 1.225 kg/m^3 value into ratio
 * calculations.
 */
export function getAtmosphereRatios(
  geometricAltitude
) {
  const state =
    getStandardAtmosphere(
      geometricAltitude
    );

  const seaLevelDensity =
    P0 / (R_AIR * T0);

  return Object.freeze({
    temperatureRatio:
      state.temperature / T0,

    pressureRatio:
      state.pressure / P0,

    densityRatio:
      state.density / seaLevelDensity,
  });
}


// =============================================================================
// 12. EXPLANATORY / DEBUG TABLE
// =============================================================================

/**
 * Return a copy of the internally generated layer-base table.
 *
 * Useful for:
 *   - documentation,
 *   - debug output,
 *   - verification tests,
 *   - methodology pages.
 *
 * This exposes the base pressure/temperature values that were generated
 * continuously from sea-level conditions.
 */
export function getAtmosphereLayerTable() {
  return ATMOSPHERE_LAYERS.map(
    (layer) => ({ ...layer })
  );
}
