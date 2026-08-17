/**
 * @file input-adapter.js
 * @description Converts browser-facing Analyzer input into validated SI-domain
 * structures consumed by the simulation and physics modules. Parsing, unit
 * conversion, schema validation, and configuration assembly occur here; physics
 * equations remain defined in the physics/ modules.
 */
import {
  createStage,
  createVehicle,
  createProvenance,
  VALUE_ORIGIN,
  DATA_CONFIDENCE,
} from "../physics/vehicle-model.js";

import {
  createMachCdModel,
} from "../physics/aerodynamics.js";

import {
  createPitchProgram,
  createStageProgressPitchProgram,
  createGenericAssumedAscentGuidance,
  GUIDANCE_PROFILE_ORIGIN,
  PROFILE_COORDINATE,
  PROFILE_INTERPOLATION,
  getGuidanceProfileDescription,
} from "./guidance-profile.js";


// =============================================================================
// 1. PUBLIC CONSTANTS
// =============================================================================

export const ANALYZER_INPUT_SCHEMA_VERSION = 1;

export const GUIDANCE_INPUT_TYPE =
  Object.freeze({
    GENERIC_ASSUMED:
      "genericAssumed",

    PITCH_PROGRAM:
      "pitchProgram",

    STAGE_PROGRESS:
      "stageProgress",
  });

export const SUPPORTED_UNITS =
  Object.freeze({
    MASS:
      Object.freeze([
        "kg",
        "t",
      ]),

    LENGTH:
      Object.freeze([
        "m",
        "km",
      ]),

    AREA:
      Object.freeze([
        "m2",
      ]),

    THRUST:
      Object.freeze([
        "N",
        "kN",
        "MN",
      ]),

    VELOCITY:
      Object.freeze([
        "m/s",
        "km/s",
      ]),

    TIME:
      Object.freeze([
        "s",
      ]),

    SPECIFIC_IMPULSE:
      Object.freeze([
        "s",
      ]),
  });


// =============================================================================
// 2. INTERNAL VALIDATION HELPERS
// =============================================================================

function assertObject(
  value,
  name
) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new TypeError(
      `${name} must be an object.`
    );
  }
}


function assertArray(
  value,
  name
) {
  if (!Array.isArray(value)) {
    throw new TypeError(
      `${name} must be an array.`
    );
  }
}


function assertNonEmptyString(
  value,
  name
) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new TypeError(
      `${name} must be a non-empty string.`
    );
  }
}


function isBlank(
  value
) {
  return (
    value === null ||
    value === undefined ||
    (
      typeof value === "string" &&
      value.trim().length === 0
    )
  );
}


function parseFiniteNumber(
  value,
  name
) {
  if (isBlank(value)) {
    throw new TypeError(
      `${name} is required.`
    );
  }

  const number =
    typeof value === "number"
      ? value
      : Number(
          String(value).trim()
        );

  if (!Number.isFinite(number)) {
    throw new TypeError(
      `${name} must be a finite number.`
    );
  }

  return number;
}


function parseOptionalFiniteNumber(
  value,
  name,
  fallback = null
) {
  if (isBlank(value)) {
    return fallback;
  }

  return parseFiniteNumber(
    value,
    name
  );
}


function parsePositiveNumber(
  value,
  name
) {
  const number =
    parseFiniteNumber(
      value,
      name
    );

  if (number <= 0) {
    throw new RangeError(
      `${name} must be greater than 0.`
    );
  }

  return number;
}


function parseNonNegativeNumber(
  value,
  name
) {
  const number =
    parseFiniteNumber(
      value,
      name
    );

  if (number < 0) {
    throw new RangeError(
      `${name} cannot be negative.`
    );
  }

  return number;
}


function parseOptionalNonNegativeNumber(
  value,
  name,
  fallback = null
) {
  if (isBlank(value)) {
    return fallback;
  }

  return parseNonNegativeNumber(
    value,
    name
  );
}


function parsePositiveInteger(
  value,
  name
) {
  const number =
    parseFiniteNumber(
      value,
      name
    );

  if (
    !Number.isInteger(number) ||
    number <= 0
  ) {
    throw new RangeError(
      `${name} must be a positive integer.`
    );
  }

  return number;
}


function freezeObject(
  value
) {
  return Object.freeze({
    ...value,
  });
}


// =============================================================================
// 3. IDENTIFIERS
// =============================================================================

/**
 * Convert a user-facing name into a deterministic safe identifier.
 *
 * This is naming hygiene only; it does not change any physics quantity.
 */
export function slugifyIdentifier(
  value,
  fallback
) {
  const source =
    isBlank(value)
      ? fallback
      : String(value);

  const slug =
    source
      .trim()
      .toLowerCase()
      .replace(
        /[^a-z0-9]+/g,
        "-"
      )
      .replace(
        /^-+|-+$/g,
        ""
      );

  if (slug.length > 0) {
    return slug;
  }

  assertNonEmptyString(
    fallback,
    "fallback"
  );

  return fallback;
}


// =============================================================================
// 4. QUANTITY / UNIT PARSING
// =============================================================================

/**
 * UI values may be supplied either as:
 *
 *   1234
 *
 * meaning "already SI",
 *
 * or:
 *
 *   {
 *     value: 1234,
 *     unit: "kN"
 *   }
 *
 * where the unit is converted here before physics receives the value.
 */
function unpackQuantity(
  input,
  name,
  defaultUnit
) {
  if (
    input !== null &&
    typeof input === "object" &&
    !Array.isArray(input)
  ) {
    if (!("value" in input)) {
      throw new TypeError(
        `${name} quantity object must contain a value field.`
      );
    }

    return {
      value:
        parseFiniteNumber(
          input.value,
          `${name}.value`
        ),

      unit:
        isBlank(input.unit)
          ? defaultUnit
          : String(
              input.unit
            ).trim(),
    };
  }

  return {
    value:
      parseFiniteNumber(
        input,
        name
      ),

    unit:
      defaultUnit,
  };
}


function convertUnit({
  input,
  name,
  defaultUnit,
  factors,
}) {
  const {
    value,
    unit,
  } =
    unpackQuantity(
      input,
      name,
      defaultUnit
    );

  const factor =
    factors[unit];

  if (factor === undefined) {
    throw new RangeError(
      `${name} uses unsupported unit "${unit}". Supported units: ${Object.keys(factors).join(", ")}.`
    );
  }

  return (
    value *
    factor
  );
}


export function massToKg(
  input,
  name = "mass"
) {
  return convertUnit({
    input,
    name,

    defaultUnit:
      "kg",

    factors: {
      kg: 1,
      t: 1_000,
    },
  });
}


export function lengthToM(
  input,
  name = "length"
) {
  return convertUnit({
    input,
    name,

    defaultUnit:
      "m",

    factors: {
      m: 1,
      km: 1_000,
    },
  });
}


export function areaToM2(
  input,
  name = "area"
) {
  return convertUnit({
    input,
    name,

    defaultUnit:
      "m2",

    factors: {
      m2: 1,
    },
  });
}


export function thrustToN(
  input,
  name = "thrust"
) {
  return convertUnit({
    input,
    name,

    defaultUnit:
      "N",

    factors: {
      N: 1,
      kN: 1_000,
      MN: 1_000_000,
    },
  });
}


export function velocityToMps(
  input,
  name = "velocity"
) {
  return convertUnit({
    input,
    name,

    defaultUnit:
      "m/s",

    factors: {
      "m/s": 1,
      "km/s": 1_000,
    },
  });
}


export function timeToS(
  input,
  name = "time"
) {
  return convertUnit({
    input,
    name,

    defaultUnit:
      "s",

    factors: {
      s: 1,
    },
  });
}


/**
 * Specific impulse is intentionally represented in seconds in the existing
 * propulsion model.
 */
export function specificImpulseToS(
  input,
  name = "specificImpulse"
) {
  return convertUnit({
    input,
    name,

    defaultUnit:
      "s",

    factors: {
      s: 1,
    },
  });
}


// =============================================================================
// 5. PROVENANCE
// =============================================================================

function normalizeProvenance(
  raw,
  name
) {
  if (
    raw === null ||
    raw === undefined
  ) {
    return {};
  }

  assertObject(
    raw,
    name
  );

  /**
   * If the object looks like one canonical provenance record, validate it
   * through vehicle-model.js's existing createProvenance().
   *
   * Otherwise preserve the object as a field-keyed provenance map.
   */
  if ("origin" in raw) {
    return createProvenance({
      origin:
        raw.origin,

      source:
        raw.source ?? null,

      confidence:
        raw.confidence ?? null,

      note:
        raw.note ?? null,
    });
  }

  return {
    ...raw,
  };
}


// =============================================================================
// 6. AERODYNAMIC REFERENCE AREA
// =============================================================================

/**
 * Circular frontal reference area:
 *
 *   A = π d² / 4
 *
 * This is a UI/input convenience, not an aerodynamic physics change.
 *
 * The adapter returns a derivation record so the UI/report can disclose that
 * the area was derived rather than directly entered.
 */
export function referenceAreaFromDiameter(
  diameter
) {
  const diameterM =
    lengthToM(
      diameter,
      "diameter"
    );

  if (diameterM <= 0) {
    throw new RangeError(
      "diameter must be greater than 0."
    );
  }

  return (
    Math.PI *
    diameterM *
    diameterM /
    4
  );
}


function resolveReferenceArea({
  rawStage,
  stageIndex,
  derivations,
}) {
  if (
    !isBlank(
      rawStage.referenceArea
    )
  ) {
    const value =
      areaToM2(
        rawStage.referenceArea,
        `vehicle.stages[${stageIndex}].referenceArea`
      );

    if (value <= 0) {
      throw new RangeError(
        `vehicle.stages[${stageIndex}].referenceArea must be greater than 0.`
      );
    }

    return value;
  }

  if (
    !isBlank(
      rawStage.diameter
    )
  ) {
    const diameterM =
      lengthToM(
        rawStage.diameter,
        `vehicle.stages[${stageIndex}].diameter`
      );

    if (diameterM <= 0) {
      throw new RangeError(
        `vehicle.stages[${stageIndex}].diameter must be greater than 0.`
      );
    }

    const area =
      Math.PI *
      diameterM *
      diameterM /
      4;

    derivations.push(
      Object.freeze({
        type:
          "derivedInput",

        field:
          `vehicle.stages[${stageIndex}].referenceArea`,

        relation:
          "A = πd² / 4",

        sourceField:
          `vehicle.stages[${stageIndex}].diameter`,

        inputDiameterM:
          diameterM,

        resultM2:
          area,
      })
    );

    return area;
  }

  throw new TypeError(
    `vehicle.stages[${stageIndex}] requires either referenceArea or diameter.`
  );
}


// =============================================================================
// 7. STAGE ADAPTER
// =============================================================================

function adaptStage({
  rawStage,
  stageIndex,
  derivations,
}) {
  assertObject(
    rawStage,
    `vehicle.stages[${stageIndex}]`
  );

  const name =
    isBlank(rawStage.name)
      ? `Stage ${stageIndex + 1}`
      : String(rawStage.name).trim();

  const id =
    slugifyIdentifier(
      rawStage.id,
      `stage-${stageIndex + 1}`
    );

  const residualPropellantMass =
    isBlank(
      rawStage.residualPropellantMass
    )
      ? 0
      : massToKg(
          rawStage.residualPropellantMass,
          `vehicle.stages[${stageIndex}].residualPropellantMass`
        );

  const nominalBurnTime =
    isBlank(
      rawStage.nominalBurnTime
    )
      ? null
      : timeToS(
          rawStage.nominalBurnTime,
          `vehicle.stages[${stageIndex}].nominalBurnTime`
        );

  const separationDelay =
    isBlank(
      rawStage.separationDelay
    )
      ? 0
      : timeToS(
          rawStage.separationDelay,
          `vehicle.stages[${stageIndex}].separationDelay`
        );

  return createStage({
    id,
    name,

    masses: {
      dryMass:
        massToKg(
          rawStage.dryMass,
          `vehicle.stages[${stageIndex}].dryMass`
        ),

      propellantMass:
        massToKg(
          rawStage.propellantMass,
          `vehicle.stages[${stageIndex}].propellantMass`
        ),

      residualPropellantMass,
    },

    propulsion: {
      thrustSeaLevel:
        thrustToN(
          rawStage.thrustSeaLevel,
          `vehicle.stages[${stageIndex}].thrustSeaLevel`
        ),

      thrustVacuum:
        thrustToN(
          rawStage.thrustVacuum,
          `vehicle.stages[${stageIndex}].thrustVacuum`
        ),

      ispSeaLevel:
        specificImpulseToS(
          rawStage.ispSeaLevel,
          `vehicle.stages[${stageIndex}].ispSeaLevel`
        ),

      ispVacuum:
        specificImpulseToS(
          rawStage.ispVacuum,
          `vehicle.stages[${stageIndex}].ispVacuum`
        ),
    },

    aerodynamics: {
      referenceArea:
        resolveReferenceArea({
          rawStage,
          stageIndex,
          derivations,
        }),

      cdModelId:
        isBlank(
          rawStage.cdModelId
        )
          ? null
          : String(
              rawStage.cdModelId
            ).trim(),
    },

    nominalBurnTime,

    separationDelay,

    provenance:
      normalizeProvenance(
        rawStage.provenance,
        `vehicle.stages[${stageIndex}].provenance`
      ),
  });
}


// =============================================================================
// 8. VEHICLE ADAPTER
// =============================================================================

export function adaptVehicleInput(
  rawVehicle,
  derivations = []
) {
  assertObject(
    rawVehicle,
    "vehicle"
  );

  assertArray(
    rawVehicle.stages,
    "vehicle.stages"
  );

  const name =
    isBlank(rawVehicle.name)
      ? "Untitled Vehicle"
      : String(
          rawVehicle.name
        ).trim();

  const id =
    slugifyIdentifier(
      rawVehicle.id,
      slugifyIdentifier(
        name,
        "untitled-vehicle"
      )
    );

  const stages =
    rawVehicle.stages.map(
      (
        rawStage,
        stageIndex
      ) =>
        adaptStage({
          rawStage,
          stageIndex,
          derivations,
        })
    );

  return createVehicle({
    id,
    name,

    payloadMass:
      isBlank(
        rawVehicle.payloadMass
      )
        ? 0
        : massToKg(
            rawVehicle.payloadMass,
            "vehicle.payloadMass"
          ),

    initialAttachedHardwareMass:
      isBlank(
        rawVehicle.initialAttachedHardwareMass
      )
        ? 0
        : massToKg(
            rawVehicle.initialAttachedHardwareMass,
            "vehicle.initialAttachedHardwareMass"
          ),

    stages,

    provenance:
      normalizeProvenance(
        rawVehicle.provenance,
        "vehicle.provenance"
      ),
  });
}


// =============================================================================
// 9. MACH-CD MODEL ADAPTER
// =============================================================================

function adaptCdPoint(
  rawPoint,
  modelIndex,
  pointIndex
) {
  assertObject(
    rawPoint,
    `aerodynamics.models[${modelIndex}].points[${pointIndex}]`
  );

  return {
    mach:
      parseNonNegativeNumber(
        rawPoint.mach,
        `aerodynamics.models[${modelIndex}].points[${pointIndex}].mach`
      ),

    cd:
      parseNonNegativeNumber(
        rawPoint.cd,
        `aerodynamics.models[${modelIndex}].points[${pointIndex}].cd`
      ),
  };
}


export function adaptCdModels(
  rawAerodynamics = {}
) {
  assertObject(
    rawAerodynamics,
    "aerodynamics"
  );

  const rawModels =
    rawAerodynamics.models ?? [];

  assertArray(
    rawModels,
    "aerodynamics.models"
  );

  const models =
    {};

  for (
    let modelIndex = 0;
    modelIndex <
      rawModels.length;
    modelIndex += 1
  ) {
    const rawModel =
      rawModels[
        modelIndex
      ];

    assertObject(
      rawModel,
      `aerodynamics.models[${modelIndex}]`
    );

    const id =
      slugifyIdentifier(
        rawModel.id,
        `cd-model-${modelIndex + 1}`
      );

    if (
      models[id] !== undefined
    ) {
      throw new RangeError(
        `Duplicate Cd model id "${id}".`
      );
    }

    assertArray(
      rawModel.points,
      `aerodynamics.models[${modelIndex}].points`
    );

    const model =
      createMachCdModel({
        id,

        name:
          isBlank(
            rawModel.name
          )
            ? null
            : String(
                rawModel.name
              ).trim(),

        points:
          rawModel.points.map(
            (
              rawPoint,
              pointIndex
            ) =>
              adaptCdPoint(
                rawPoint,
                modelIndex,
                pointIndex
              )
          ),

        outsideRange:
          rawModel.outsideRange ??
          "clamp",

        provenance:
          rawModel.provenance ??
          null,
      });

    models[id] =
      model;
  }

  const defaultCdModelId =
    isBlank(
      rawAerodynamics
        .defaultCdModelId
    )
      ? null
      : String(
          rawAerodynamics
            .defaultCdModelId
        ).trim();

  let defaultCdModel =
    null;

  if (
    defaultCdModelId !== null
  ) {
    defaultCdModel =
      models[
        defaultCdModelId
      ] ?? null;

    if (
      defaultCdModel ===
      null
    ) {
      throw new RangeError(
        `aerodynamics.defaultCdModelId "${defaultCdModelId}" does not match a supplied Cd model.`
      );
    }
  }

  return Object.freeze({
    cdModels:
      Object.freeze({
        ...models,
      }),

    defaultCdModel,

    defaultCdModelId,
  });
}


// =============================================================================
// 10. GUIDANCE ADAPTER
// =============================================================================

function adaptPitchPoints(
  rawPoints,
  name
) {
  assertArray(
    rawPoints,
    name
  );

  return rawPoints.map(
    (
      point,
      index
    ) => {
      assertObject(
        point,
        `${name}[${index}]`
      );

      return {
        value:
          parseFiniteNumber(
            point.value,
            `${name}[${index}].value`
          ),

        pitchDegrees:
          parseFiniteNumber(
            point.pitchDegrees,
            `${name}[${index}].pitchDegrees`
          ),
      };
    }
  );
}


export function adaptGuidanceInput(
  rawGuidance = {}
) {
  assertObject(
    rawGuidance,
    "guidance"
  );

  const type =
    rawGuidance.type ??
    GUIDANCE_INPUT_TYPE
      .GENERIC_ASSUMED;

  const progradeSign =
    isBlank(
      rawGuidance.progradeSign
    )
      ? 1
      : parseFiniteNumber(
          rawGuidance.progradeSign,
          "guidance.progradeSign"
        );

  let guidanceProvider;

  switch (type) {
    case GUIDANCE_INPUT_TYPE.GENERIC_ASSUMED:
      guidanceProvider =
        createGenericAssumedAscentGuidance({
          progradeSign,
        });
      break;

    case GUIDANCE_INPUT_TYPE.PITCH_PROGRAM:
      guidanceProvider =
        createPitchProgram({
          id:
            slugifyIdentifier(
              rawGuidance.id,
              "user-pitch-program"
            ),

          origin:
            GUIDANCE_PROFILE_ORIGIN
              .USER_DEFINED,

          coordinate:
            rawGuidance.coordinate ??
            PROFILE_COORDINATE
              .ALTITUDE,

          interpolation:
            rawGuidance.interpolation ??
            PROFILE_INTERPOLATION
              .SMOOTHSTEP,

          progradeSign,

          points:
            adaptPitchPoints(
              rawGuidance.points,
              "guidance.points"
            ),
        });
      break;

    case GUIDANCE_INPUT_TYPE.STAGE_PROGRESS: {
      assertObject(
        rawGuidance.stageProfiles,
        "guidance.stageProfiles"
      );

      const stageProfiles =
        {};

      for (
        const [
          stageKey,
          rawPoints,
        ]
        of Object.entries(
          rawGuidance.stageProfiles
        )
      ) {
        stageProfiles[
          stageKey
        ] =
          adaptPitchPoints(
            rawPoints,
            `guidance.stageProfiles.${stageKey}`
          );
      }

      guidanceProvider =
        createStageProgressPitchProgram({
          id:
            slugifyIdentifier(
              rawGuidance.id,
              "user-stage-progress-profile"
            ),

          origin:
            GUIDANCE_PROFILE_ORIGIN
              .USER_DEFINED,

          interpolation:
            rawGuidance.interpolation ??
            PROFILE_INTERPOLATION
              .SMOOTHSTEP,

          progradeSign,

          stageProfiles,
        });
      break;
    }

    default:
      throw new RangeError(
        `Unknown guidance.type "${type}".`
      );
  }

  return Object.freeze({
    type,

    guidanceProvider,

    profile:
      getGuidanceProfileDescription(
        guidanceProvider
      ),
  });
}


// =============================================================================
// 11. INITIAL CONDITIONS
// =============================================================================

export function adaptInitialConditions(
  rawInitialConditions = {}
) {
  assertObject(
    rawInitialConditions,
    "initialConditions"
  );

  const launchAltitude =
    isBlank(
      rawInitialConditions
        .launchAltitude
    )
      ? 0
      : lengthToM(
          rawInitialConditions
            .launchAltitude,
          "initialConditions.launchAltitude"
        );

  if (
    launchAltitude < 0
  ) {
    throw new RangeError(
      "initialConditions.launchAltitude cannot be negative in the Analyzer input model."
    );
  }

  const velocityX =
    isBlank(
      rawInitialConditions
        .velocityX
    )
      ? 0
      : velocityToMps(
          rawInitialConditions
            .velocityX,
          "initialConditions.velocityX"
        );

  const velocityY =
    isBlank(
      rawInitialConditions
        .velocityY
    )
      ? 0
      : velocityToMps(
          rawInitialConditions
            .velocityY,
          "initialConditions.velocityY"
        );

  return Object.freeze({
    launchAltitude,

    velocity:
      Object.freeze({
        x:
          velocityX,

        y:
          velocityY,
      }),
  });
}


// =============================================================================
// 12. TARGET ORBIT
// =============================================================================

export function adaptTargetOrbit(
  rawMission = {}
) {
  assertObject(
    rawMission,
    "mission"
  );

  const periapsisMissing =
    isBlank(
      rawMission
        .targetPeriapsisAltitude
    );

  const apoapsisMissing =
    isBlank(
      rawMission
        .targetApoapsisAltitude
    );

  if (
    periapsisMissing &&
    apoapsisMissing
  ) {
    return null;
  }

  if (
    periapsisMissing !==
    apoapsisMissing
  ) {
    throw new TypeError(
      "mission target requires both targetPeriapsisAltitude and targetApoapsisAltitude."
    );
  }

  const periapsisAltitude =
    lengthToM(
      rawMission
        .targetPeriapsisAltitude,
      "mission.targetPeriapsisAltitude"
    );

  const apoapsisAltitude =
    lengthToM(
      rawMission
        .targetApoapsisAltitude,
      "mission.targetApoapsisAltitude"
    );

  if (
    periapsisAltitude < 0 ||
    apoapsisAltitude < 0
  ) {
    throw new RangeError(
      "Target periapsis and apoapsis altitude cannot be negative."
    );
  }

  if (
    apoapsisAltitude <
    periapsisAltitude
  ) {
    throw new RangeError(
      "mission.targetApoapsisAltitude cannot be lower than targetPeriapsisAltitude."
    );
  }

  const altitudeTolerance =
    isBlank(
      rawMission
        .altitudeTolerance
    )
      ? 10_000
      : lengthToM(
          rawMission
            .altitudeTolerance,
          "mission.altitudeTolerance"
        );

  if (
    altitudeTolerance < 0
  ) {
    throw new RangeError(
      "mission.altitudeTolerance cannot be negative."
    );
  }

  return Object.freeze({
    periapsisAltitude,

    apoapsisAltitude,

    altitudeTolerance,
  });
}


// =============================================================================
// 13. SOLVER CONFIGURATION
// =============================================================================

export function adaptSolverInput(
  rawSolver = {}
) {
  assertObject(
    rawSolver,
    "solver"
  );

  const result =
    {};

  if (
    !isBlank(
      rawSolver.dt
    )
  ) {
    result.dt =
      timeToS(
        rawSolver.dt,
        "solver.dt"
      );

    if (
      result.dt <= 0
    ) {
      throw new RangeError(
        "solver.dt must be greater than 0."
      );
    }
  }

  if (
    !isBlank(
      rawSolver.maxTime
    )
  ) {
    result.maxTime =
      timeToS(
        rawSolver.maxTime,
        "solver.maxTime"
      );

    if (
      result.maxTime <= 0
    ) {
      throw new RangeError(
        "solver.maxTime must be greater than 0."
      );
    }
  }

  if (
    !isBlank(
      rawSolver.maxSteps
    )
  ) {
    result.maxSteps =
      parsePositiveInteger(
        rawSolver.maxSteps,
        "solver.maxSteps"
      );
  }

  if (
    !isBlank(
      rawSolver.recordEveryNSteps
    )
  ) {
    result.recordEveryNSteps =
      parsePositiveInteger(
        rawSolver
          .recordEveryNSteps,
        "solver.recordEveryNSteps"
      );
  }

  if (
    !isBlank(
      rawSolver
        .burnoutMassTolerance
    )
  ) {
    result.burnoutMassTolerance =
      parseNonNegativeNumber(
        rawSolver
          .burnoutMassTolerance,
        "solver.burnoutMassTolerance"
      );
  }

  if (
    !isBlank(
      rawSolver
        .eventTimeTolerance
    )
  ) {
    result.eventTimeTolerance =
      parsePositiveNumber(
        rawSolver
          .eventTimeTolerance,
        "solver.eventTimeTolerance"
      );
  }

  if (
    !isBlank(
      rawSolver.method
    )
  ) {
    const method =
      String(
        rawSolver.method
      ).trim();

    if (
      method !== "rk4" &&
      method !== "euler"
    ) {
      throw new RangeError(
        'solver.method must be "rk4" or "euler".'
      );
    }

    result.method =
      method;
  }

  return Object.freeze(
    result
  );
}


// =============================================================================
// 14. PROPULSION / AIR / ATMOSPHERE OPTIONS
// =============================================================================

export function adaptPropulsionCommand(
  rawPropulsion = {}
) {
  assertObject(
    rawPropulsion,
    "propulsion"
  );

  const throttle =
    isBlank(
      rawPropulsion.throttle
    )
      ? 1
      : parseFiniteNumber(
          rawPropulsion.throttle,
          "propulsion.throttle"
        );

  if (
    throttle < 0 ||
    throttle > 1
  ) {
    throw new RangeError(
      "propulsion.throttle must lie in [0,1]."
    );
  }

  return Object.freeze({
    engineOn:
      rawPropulsion.engineOn ===
      undefined
        ? true
        : Boolean(
            rawPropulsion.engineOn
          ),

    throttle,
  });
}


export function adaptAirVelocity(
  rawAir = {}
) {
  assertObject(
    rawAir,
    "air"
  );

  return Object.freeze({
    x:
      isBlank(rawAir.velocityX)
        ? 0
        : velocityToMps(
            rawAir.velocityX,
            "air.velocityX"
          ),

    y:
      isBlank(rawAir.velocityY)
        ? 0
        : velocityToMps(
            rawAir.velocityY,
            "air.velocityY"
          ),
  });
}


export function adaptAtmosphereOptions(
  rawAtmosphere = {}
) {
  assertObject(
    rawAtmosphere,
    "atmosphere"
  );

  const aboveModel =
    rawAtmosphere.aboveModel ??
    "vacuum";

  if (
    aboveModel !== "vacuum" &&
    aboveModel !== "error"
  ) {
    throw new RangeError(
      'atmosphere.aboveModel must be "vacuum" or "error".'
    );
  }

  return Object.freeze({
    aboveModel,
  });
}


// =============================================================================
// 15. CROSS-CONFIGURATION VALIDATION
// =============================================================================

function validateCdAssignments({
  vehicle,
  cdModels,
  defaultCdModel,
}) {
  for (
    let stageIndex = 0;
    stageIndex <
      vehicle.stages.length;
    stageIndex += 1
  ) {
    const stage =
      vehicle.stages[
        stageIndex
      ];

    const id =
      stage
        .aerodynamics
        .cdModelId;

    if (
      id === null
    ) {
      if (
        defaultCdModel ===
        null
      ) {
        throw new RangeError(
          `Stage "${stage.id}" has no cdModelId and no default Cd model was selected.`
        );
      }

      continue;
    }

    if (
      cdModels[id] ===
      undefined
    ) {
      throw new RangeError(
        `Stage "${stage.id}" refers to missing Cd model "${id}".`
      );
    }
  }
}


// =============================================================================
// 16. MAIN ADAPTER
// =============================================================================

/**
 * Convert raw Analyzer-facing input into a runSimulation() configuration.
 *
 * Expected top-level shape:
 *
 * {
 *   vehicle,
 *   aerodynamics?,
 *   guidance?,
 *   initialConditions?,
 *   mission?,
 *   solver?,
 *   propulsion?,
 *   air?,
 *   atmosphere?
 * }
 *
 *
 * RETURN
 * ------
 * {
 *   simulationConfig,
 *   metadata
 * }
 *
 * where simulationConfig can be passed directly to:
 *
 *   runSimulation(simulationConfig)
 */
export function prepareSimulationInput(
  rawInput
) {
  assertObject(
    rawInput,
    "rawInput"
  );

  const derivations = [];

  const vehicle =
    adaptVehicleInput(
      rawInput.vehicle,
      derivations
    );

  const {
    cdModels,
    defaultCdModel,
    defaultCdModelId,
  } =
    adaptCdModels(
      rawInput.aerodynamics ??
      {}
    );

  validateCdAssignments({
    vehicle,
    cdModels,
    defaultCdModel,
  });

  const guidanceResult =
    adaptGuidanceInput(
      rawInput.guidance ??
      {}
    );

  const initialConditions =
    adaptInitialConditions(
      rawInput.initialConditions ??
      {}
    );

  const targetOrbit =
    adaptTargetOrbit(
      rawInput.mission ??
      {}
    );

  const solver =
    adaptSolverInput(
      rawInput.solver ??
      {}
    );

  const propulsion =
    adaptPropulsionCommand(
      rawInput.propulsion ??
      {}
    );

  const airVelocity =
    adaptAirVelocity(
      rawInput.air ??
      {}
    );

  const atmosphereOptions =
    adaptAtmosphereOptions(
      rawInput.atmosphere ??
      {}
    );

  const warnings = [];

  if (
    guidanceResult.type ===
    GUIDANCE_INPUT_TYPE
      .GENERIC_ASSUMED
  ) {
    warnings.push(
      Object.freeze({
        code:
          "ASSUMED_GUIDANCE_PROFILE",

        message:
          "The generic ascent guidance profile is an explicit modeling assumption and is not calibrated to a real launch vehicle.",
      })
    );
  }

  if (
    defaultCdModel !== null
  ) {
    const stagesUsingDefault =
      vehicle.stages
        .filter(
          (stage) =>
            stage
              .aerodynamics
              .cdModelId ===
            null
        )
        .map(
          (stage) =>
            stage.id
        );

    if (
      stagesUsingDefault.length > 0
    ) {
      warnings.push(
        Object.freeze({
          code:
            "DEFAULT_CD_MODEL_USED",

          message:
            `Default Cd model "${defaultCdModelId}" will be used by: ${stagesUsingDefault.join(", ")}.`,
        })
      );
    }
  }

  return Object.freeze({
    simulationConfig:
      Object.freeze({
        vehicle,

        cdModels,

        defaultCdModel,

        guidanceProvider:
          guidanceResult
            .guidanceProvider,

        propulsion,

        airVelocity,

        initialConditions,

        targetOrbit,

        solver,

        atmosphereOptions,
      }),

    metadata:
      Object.freeze({
        schemaVersion:
          ANALYZER_INPUT_SCHEMA_VERSION,

        derivations:
          Object.freeze([
            ...derivations,
          ]),

        guidanceProfile:
          guidanceResult.profile,

        warnings:
          Object.freeze([
            ...warnings,
          ]),
      }),
  });
}


// =============================================================================
// 17. ERROR NORMALIZATION FOR UI
// =============================================================================

/**
 * Convert a thrown validation/model error into a small stable object that the
 * Analyzer UI can display without depending on browser-specific Error fields.
 */
export function normalizeInputError(
  error
) {
  if (
    error instanceof Error
  ) {
    return Object.freeze({
      name:
        error.name,

      message:
        error.message,
    });
  }

  return Object.freeze({
    name:
      "Error",

    message:
      String(
        error
      ),
  });
}
