/**
 * @file atmosphere-validation.js
 * @description Independent reference comparison for physics/atmosphere.js at
 * selected geometric altitudes from 0 to 86 km. Reference values are hard-coded
 * from a separate U.S. Standard Atmosphere 1976 calculation so the model under
 * test does not generate its own expected values.
 *
 * Primary reference: U.S. Standard Atmosphere, 1976, NASA NTRS 19770009539
 * https://ntrs.nasa.gov/citations/19770009539
 */
import {
  getStandardAtmosphere,
} from "../physics/atmosphere.js";


// =============================================================================
// 1. VALIDATION CONFIGURATION
// =============================================================================

/**
 * Reporting threshold, not a physics constant.
 *
 * The current project uses R_air = 287.05 J/(kg K), while the independent
 * USSA reference below uses R_star / M0 = 287.053072... J/(kg K). Tiny differences
 * are therefore expected and should be measured rather than hidden.
 */
const REPORTING_TOLERANCE_PERCENT = 0.05;


// =============================================================================
// 2. INDEPENDENT REFERENCE MATRIX
// =============================================================================

const REFERENCE_CASES = Object.freeze([
  Object.freeze({
    altitudeM: 0,
    temperatureK: 288.150000000,
    pressurePa: 101325.000000000,
    densityKgM3: 1.2249991559,
  }),
  Object.freeze({
    altitudeM: 5_000,
    temperatureK: 255.675543222,
    pressurePa: 54_048.2861463,
    densityKgM3: 0.7364284208,
  }),
  Object.freeze({
    altitudeM: 11_000,
    temperatureK: 216.773512704,
    pressurePa: 22_699.9607392,
    densityKgM3: 0.3648015640,
  }),
  Object.freeze({
    altitudeM: 20_000,
    temperatureK: 216.650000000,
    pressurePa: 5_529.3118929,
    densityKgM3: 0.0889099158,
  }),
  Object.freeze({
    altitudeM: 32_000,
    temperatureK: 228.489718656,
    pressurePa: 889.0644169,
    densityKgM3: 0.0135551512,
  }),
  Object.freeze({
    altitudeM: 47_000,
    temperatureK: 269.684130854,
    pressurePa: 115.8511140,
    densityKgM3: 0.0014965203,
  }),
  Object.freeze({
    altitudeM: 51_000,
    temperatureK: 270.650000000,
    pressurePa: 70.4580090,
    densityKgM3: 0.0009069015,
  }),
  Object.freeze({
    altitudeM: 71_000,
    temperatureK: 216.845910679,
    pressurePa: 4.4795630,
    densityKgM3: 0.0000719652,
  }),
  Object.freeze({
    altitudeM: 86_000,
    temperatureK: 186.945908310,
    pressurePa: 0.3733803,
    densityKgM3: 0.00000695782,
  }),
]);


// =============================================================================
// 3. NUMERICAL HELPERS
// =============================================================================

function percentError(modelValue, referenceValue) {
  if (!Number.isFinite(modelValue) || !Number.isFinite(referenceValue)) {
    throw new TypeError("percentError requires finite numeric values.");
  }

  if (referenceValue === 0) {
    return modelValue === 0 ? 0 : Infinity;
  }

  return (
    Math.abs(modelValue - referenceValue) /
    Math.abs(referenceValue)
  ) * 100;
}


function formatNumber(value, digits = 6) {
  if (!Number.isFinite(value)) return String(value);

  const abs = Math.abs(value);

  if (abs !== 0 && (abs < 0.001 || abs >= 1_000_000)) {
    return value.toExponential(digits);
  }

  return value.toFixed(digits);
}


function formatError(value) {
  if (value < 0.000001) {
    return `${value.toExponential(3)}%`;
  }

  return `${value.toFixed(6)}%`;
}


// =============================================================================
// 4. RUN VALIDATION
// =============================================================================

function runAtmosphereValidation() {
  const results = [];

  for (const reference of REFERENCE_CASES) {
    const model = getStandardAtmosphere(reference.altitudeM);

    const temperatureErrorPercent = percentError(
      model.temperature,
      reference.temperatureK
    );

    const pressureErrorPercent = percentError(
      model.pressure,
      reference.pressurePa
    );

    const densityErrorPercent = percentError(
      model.density,
      reference.densityKgM3
    );

    results.push(Object.freeze({
      altitudeKm: reference.altitudeM / 1000,
      geopotentialAltitudeKm: model.geopotentialAltitude / 1000,
      layerName: model.layerName,

      temperature: Object.freeze({
        model: model.temperature,
        reference: reference.temperatureK,
        errorPercent: temperatureErrorPercent,
      }),

      pressure: Object.freeze({
        model: model.pressure,
        reference: reference.pressurePa,
        errorPercent: pressureErrorPercent,
      }),

      density: Object.freeze({
        model: model.density,
        reference: reference.densityKgM3,
        errorPercent: densityErrorPercent,
      }),
    }));
  }

  return Object.freeze(results);
}


function maximumError(results, key) {
  return Math.max(
    ...results.map((result) => result[key].errorPercent)
  );
}


// =============================================================================
// 5. REPORT
// =============================================================================

function printDetailedTable(results) {
  console.log("\nU.S. STANDARD ATMOSPHERE 1976 VALIDATION");
  console.log("========================================");
  console.log("Input altitude convention: GEOMETRIC altitude");
  console.log("Model under test: physics/atmosphere.js\n");

  for (const result of results) {
    console.log(
      `${String(result.altitudeKm).padStart(5)} km geometric` +
      `  ->  ${result.geopotentialAltitudeKm.toFixed(3)} km geopotential`
    );
    console.log(`Layer: ${result.layerName}`);

    console.log(
      `  Temperature  model=${formatNumber(result.temperature.model, 6)} K` +
      `  ref=${formatNumber(result.temperature.reference, 6)} K` +
      `  error=${formatError(result.temperature.errorPercent)}`
    );

    console.log(
      `  Pressure     model=${formatNumber(result.pressure.model, 9)} Pa` +
      `  ref=${formatNumber(result.pressure.reference, 9)} Pa` +
      `  error=${formatError(result.pressure.errorPercent)}`
    );

    console.log(
      `  Density      model=${formatNumber(result.density.model, 9)} kg/m^3` +
      `  ref=${formatNumber(result.density.reference, 9)} kg/m^3` +
      `  error=${formatError(result.density.errorPercent)}`
    );

    console.log("");
  }
}


function printSummary(results) {
  const maxTemperatureError = maximumError(results, "temperature");
  const maxPressureError = maximumError(results, "pressure");
  const maxDensityError = maximumError(results, "density");

  const overallMaximum = Math.max(
    maxTemperatureError,
    maxPressureError,
    maxDensityError
  );

  const pass = overallMaximum <= REPORTING_TOLERANCE_PERCENT;

  console.log("SUMMARY");
  console.log("=======");
  console.log(`Cases tested: ${results.length}`);
  console.log(`Maximum temperature error: ${formatError(maxTemperatureError)}`);
  console.log(`Maximum pressure error:    ${formatError(maxPressureError)}`);
  console.log(`Maximum density error:     ${formatError(maxDensityError)}`);
  console.log(`Reporting tolerance:       ${REPORTING_TOLERANCE_PERCENT}%`);
  console.log(`Result: ${pass ? "PASS" : "REVIEW REQUIRED"}`);

  return pass;
}


// =============================================================================
// 6. ENTRY POINT
// =============================================================================

const results = runAtmosphereValidation();
printDetailedTable(results);
const passed = printSummary(results);

if (!passed) {
  process.exitCode = 1;
}
