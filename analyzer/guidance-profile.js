/**
 * @file guidance-profile.js
 * @description Open-loop ascent guidance schedules used by the Analyzer layer.
 * Converts pitch-program definitions into commands consumed by physics/guidance.js.
 * Built-in profiles are educational assumptions, not vehicle-specific or
 * flight-certified guidance laws.
 */
import {
  altitudeFromPosition,
} from "../physics/gravity.js";

import {
  getStageUsablePropellantMass,
} from "../physics/vehicle-model.js";


// =============================================================================
// 1. CONSTANTS
// =============================================================================

export const GUIDANCE_PROFILE_MODEL =
  "OPEN_LOOP_2D_PITCH_PROGRAM";

export const GUIDANCE_PROFILE_ORIGIN =
  Object.freeze({
    USER_DEFINED:
      "userDefined",

    GENERIC_ASSUMED:
      "genericAssumed",
  });

export const PROFILE_COORDINATE =
  Object.freeze({
    TIME:
      "time",

    ALTITUDE:
      "altitude",

    STAGE_PROGRESS:
      "stageProgress",
  });

export const PROFILE_INTERPOLATION =
  Object.freeze({
    LINEAR:
      "linear",

    SMOOTHSTEP:
      "smoothstep",
  });


// =============================================================================
// 2. INTERNAL VALIDATION
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


function assertFiniteNumber(
  value,
  name
) {
  if (!Number.isFinite(value)) {
    throw new TypeError(
      `${name} must be a finite number.`
    );
  }
}


function assertNonNegativeNumber(
  value,
  name
) {
  assertFiniteNumber(
    value,
    name
  );

  if (value < 0) {
    throw new RangeError(
      `${name} cannot be negative.`
    );
  }
}


function assertPitchDegrees(
  value,
  name = "pitchDegrees"
) {
  assertFiniteNumber(
    value,
    name
  );

  if (
    value < 0 ||
    value > 90
  ) {
    throw new RangeError(
      `${name} must be between 0 and 90 degrees for the current prograde-only 2D profile model.`
    );
  }
}


function assertProgradeSign(
  value
) {
  if (
    value !== 1 &&
    value !== -1
  ) {
    throw new RangeError(
      "progradeSign must be either +1 or -1."
    );
  }
}


function assertInterpolation(
  value
) {
  if (
    value !==
      PROFILE_INTERPOLATION.LINEAR &&
    value !==
      PROFILE_INTERPOLATION.SMOOTHSTEP
  ) {
    throw new RangeError(
      `Unknown profile interpolation: "${value}".`
    );
  }
}


function assertCoordinate(
  value
) {
  if (
    value !==
      PROFILE_COORDINATE.TIME &&
    value !==
      PROFILE_COORDINATE.ALTITUDE &&
    value !==
      PROFILE_COORDINATE.STAGE_PROGRESS
  ) {
    throw new RangeError(
      `Unknown profile coordinate: "${value}".`
    );
  }
}


function assertProviderContext(
  context
) {
  assertObject(
    context,
    "guidance context"
  );

  assertFiniteNumber(
    context.time,
    "guidance context.time"
  );

  assertObject(
    context.state,
    "guidance context.state"
  );

  assertFiniteNumber(
    context.state.x,
    "guidance context.state.x"
  );

  assertFiniteNumber(
    context.state.y,
    "guidance context.state.y"
  );
}


// =============================================================================
// 3. NUMERICAL HELPERS
// =============================================================================

function clamp(
  value,
  minimum,
  maximum
) {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      value
    )
  );
}


function lerp(
  a,
  b,
  fraction
) {
  return (
    a +
    (
      b -
      a
    ) *
    fraction
  );
}


/**
 * Cubic smoothstep:
 *
 *   s(x) = 3x^2 - 2x^3
 *
 * with x clamped to [0,1].
 *
 * It keeps the interpolation continuous and gives zero slope at each
 * control-point boundary.
 */
function smoothstep(
  fraction
) {
  const x =
    clamp(
      fraction,
      0,
      1
    );

  return (
    x *
    x *
    (
      3 -
      2 *
      x
    )
  );
}


function getInterpolationFraction(
  fraction,
  interpolation
) {
  switch (
    interpolation
  ) {
    case PROFILE_INTERPOLATION.LINEAR:
      return clamp(
        fraction,
        0,
        1
      );

    case PROFILE_INTERPOLATION.SMOOTHSTEP:
      return smoothstep(
        fraction
      );

    default:
      throw new RangeError(
        `Unknown interpolation method: "${interpolation}".`
      );
  }
}


// =============================================================================
// 4. PITCH ↔ GUIDANCE.JS BLEND FACTOR
// =============================================================================

/**
 * Convert desired local pitch angle to the radialTangentialBlend factor used
 * by physics/guidance.js.
 *
 * guidance.js constructs:
 *
 *   v_raw =
 *     (1-b) * radial
 *     + b   * tangential
 *
 * then normalizes it.
 *
 * Our local pitch convention is:
 *
 *   pitch = atan2(radialComponent, tangentialComponent)
 *
 * Therefore:
 *
 *   tan(pitch) =
 *     (1-b) / b
 *
 * and:
 *
 *   b =
 *     1 / (1 + tan(pitch))
 *
 *
 * Endpoints are handled explicitly:
 *
 *   90 deg -> b = 0
 *    0 deg -> b = 1
 */
export function pitchDegreesToBlendFactor(
  pitchDegrees
) {
  assertPitchDegrees(
    pitchDegrees
  );

  if (
    pitchDegrees === 90
  ) {
    return 0;
  }

  if (
    pitchDegrees === 0
  ) {
    return 1;
  }

  const radians =
    pitchDegrees *
    Math.PI /
    180;

  return (
    1 /
    (
      1 +
      Math.tan(
        radians
      )
    )
  );
}


/**
 * Reverse conversion, useful for reporting / UI inspection.
 */
export function blendFactorToPitchDegrees(
  blendFactor
) {
  assertFiniteNumber(
    blendFactor,
    "blendFactor"
  );

  if (
    blendFactor < 0 ||
    blendFactor > 1
  ) {
    throw new RangeError(
      "blendFactor must be between 0 and 1."
    );
  }

  if (
    blendFactor === 0
  ) {
    return 90;
  }

  if (
    blendFactor === 1
  ) {
    return 0;
  }

  const radialComponent =
    1 -
    blendFactor;

  const tangentialComponent =
    blendFactor;

  return (
    Math.atan2(
      radialComponent,
      tangentialComponent
    ) *
    180 /
    Math.PI
  );
}


// =============================================================================
// 5. CONTROL POINTS
// =============================================================================

/**
 * Validate and freeze a monotonically increasing set of control points.
 *
 * For time / altitude:
 *
 *   {
 *     value: number,
 *     pitchDegrees: number
 *   }
 *
 * For stageProgress:
 *
 *   value lies in [0,1].
 */
export function createPitchControlPoints({
  points,
  coordinate,
}) {
  assertCoordinate(
    coordinate
  );

  if (
    !Array.isArray(points) ||
    points.length < 2
  ) {
    throw new RangeError(
      "points must contain at least two guidance control points."
    );
  }

  const validated =
    points.map(
      (
        point,
        index
      ) => {
        assertObject(
          point,
          `points[${index}]`
        );

        assertFiniteNumber(
          point.value,
          `points[${index}].value`
        );

        assertPitchDegrees(
          point.pitchDegrees,
          `points[${index}].pitchDegrees`
        );

        if (
          coordinate ===
            PROFILE_COORDINATE.TIME ||
          coordinate ===
            PROFILE_COORDINATE.ALTITUDE
        ) {
          if (
            point.value < 0
          ) {
            throw new RangeError(
              `points[${index}].value cannot be negative for ${coordinate}.`
            );
          }
        }

        if (
          coordinate ===
          PROFILE_COORDINATE.STAGE_PROGRESS
        ) {
          if (
            point.value < 0 ||
            point.value > 1
          ) {
            throw new RangeError(
              `points[${index}].value must lie in [0,1] for stageProgress.`
            );
          }
        }

        return Object.freeze({
          value:
            point.value,

          pitchDegrees:
            point.pitchDegrees,
        });
      }
    );

  for (
    let i = 1;
    i < validated.length;
    i += 1
  ) {
    if (
      validated[i].value <=
      validated[i - 1].value
    ) {
      throw new RangeError(
        "Guidance control-point values must be strictly increasing."
      );
    }
  }

  return Object.freeze(
    validated
  );
}


// =============================================================================
// 6. GENERIC PIECEWISE INTERPOLATION
// =============================================================================

export function evaluatePitchAtCoordinate({
  coordinateValue,

  points,

  interpolation =
    PROFILE_INTERPOLATION.SMOOTHSTEP,
}) {
  assertFiniteNumber(
    coordinateValue,
    "coordinateValue"
  );

  assertInterpolation(
    interpolation
  );

  if (
    !Array.isArray(points) ||
    points.length < 2
  ) {
    throw new RangeError(
      "points must contain at least two entries."
    );
  }

  const first =
    points[0];

  const last =
    points[
      points.length - 1
    ];

  if (
    coordinateValue <=
    first.value
  ) {
    return (
      first.pitchDegrees
    );
  }

  if (
    coordinateValue >=
    last.value
  ) {
    return (
      last.pitchDegrees
    );
  }

  for (
    let i = 0;
    i <
      points.length - 1;
    i += 1
  ) {
    const lower =
      points[i];

    const upper =
      points[
        i + 1
      ];

    if (
      coordinateValue >=
        lower.value &&
      coordinateValue <=
        upper.value
    ) {
      const rawFraction =
        (
          coordinateValue -
          lower.value
        ) /
        (
          upper.value -
          lower.value
        );

      const fraction =
        getInterpolationFraction(
          rawFraction,
          interpolation
        );

      return lerp(
        lower.pitchDegrees,
        upper.pitchDegrees,
        fraction
      );
    }
  }

  throw new Error(
    "Failed to resolve pitch from guidance control points."
  );
}


// =============================================================================
// 7. PROFILE COORDINATE FROM SIMULATION CONTEXT
// =============================================================================

function getAltitudeFromContext(
  context
) {
  return altitudeFromPosition({
    x:
      context.state.x,

    y:
      context.state.y,
  });
}


function getStageProgressFromContext(
  context
) {
  assertObject(
    context.activeStage,
    "guidance context.activeStage"
  );

  assertObject(
    context.activeStageState,
    "guidance context.activeStageState"
  );

  const usablePropellant =
    getStageUsablePropellantMass(
      context.activeStage
    );

  if (
    usablePropellant <= 0
  ) {
    return 1;
  }

  const remaining =
    context
      .activeStageState
      .remainingUsablePropellant;

  assertNonNegativeNumber(
    remaining,
    "remainingUsablePropellant"
  );

  return clamp(
    1 -
    remaining /
    usablePropellant,
    0,
    1
  );
}


export function getProfileCoordinateValue({
  coordinate,
  context,
}) {
  assertCoordinate(
    coordinate
  );

  assertProviderContext(
    context
  );

  switch (
    coordinate
  ) {
    case PROFILE_COORDINATE.TIME:
      return context.time;

    case PROFILE_COORDINATE.ALTITUDE:
      return Math.max(
        0,
        getAltitudeFromContext(
          context
        )
      );

    case PROFILE_COORDINATE.STAGE_PROGRESS:
      return getStageProgressFromContext(
        context
      );

    default:
      throw new RangeError(
        `Unknown profile coordinate: "${coordinate}".`
      );
  }
}


// =============================================================================
// 8. SINGLE GLOBAL PITCH PROGRAM
// =============================================================================

/**
 * Create a simulation.js-compatible guidanceProvider.
 *
 * Example:
 *
 *   const guidanceProvider =
 *     createPitchProgram({
 *       coordinate: "altitude",
 *       points: [
 *         { value: 0,      pitchDegrees: 90 },
 *         { value: 1_000,  pitchDegrees: 90 },
 *         { value: 20_000, pitchDegrees: 65 },
 *         { value: 80_000, pitchDegrees: 15 },
 *         { value: 120_000,pitchDegrees: 0  },
 *       ],
 *     });
 *
 * The numbers above are an EXAMPLE SHAPE only. They are not embedded defaults.
 */
export function createPitchProgram({
  coordinate =
    PROFILE_COORDINATE.ALTITUDE,

  points,

  interpolation =
    PROFILE_INTERPOLATION.SMOOTHSTEP,

  progradeSign = 1,

  id =
    "custom-pitch-program",

  origin =
    GUIDANCE_PROFILE_ORIGIN.USER_DEFINED,
}) {
  assertCoordinate(
    coordinate
  );

  assertInterpolation(
    interpolation
  );

  assertProgradeSign(
    progradeSign
  );

  if (
    typeof id !== "string" ||
    id.trim().length === 0
  ) {
    throw new TypeError(
      "id must be a non-empty string."
    );
  }

  const controlPoints =
    createPitchControlPoints({
      points,
      coordinate,
    });

  const profile =
    Object.freeze({
      model:
        GUIDANCE_PROFILE_MODEL,

      id:
        id.trim(),

      origin,

      coordinate,

      interpolation,

      progradeSign,

      controlPoints,
    });

  const provider =
    (
      context
    ) => {
      const coordinateValue =
        getProfileCoordinateValue({
          coordinate:
            profile.coordinate,

          context,
        });

      const pitchDegrees =
        evaluatePitchAtCoordinate({
          coordinateValue,

          points:
            profile.controlPoints,

          interpolation:
            profile.interpolation,
        });

      const blendFactor =
        pitchDegreesToBlendFactor(
          pitchDegrees
        );

      return Object.freeze({
        mode:
          "radialTangentialBlend",

        blendFactor,

        progradeSign:
          profile.progradeSign,
      });
    };

  Object.defineProperty(
    provider,
    "profile",
    {
      value:
        profile,

      enumerable:
        true,

      writable:
        false,

      configurable:
        false,
    }
  );

  return provider;
}


// =============================================================================
// 9. STAGE-SPECIFIC PITCH PROGRAM
// =============================================================================

/**
 * Create a stage-progress profile for each serial stage.
 *
 * stageProfiles may be keyed by:
 *
 *   stage.id
 *
 * or:
 *
 *   numeric stage index as a string
 *
 * Example:
 *
 *   {
 *     "stage-1": [
 *       { value: 0.0, pitchDegrees: 90 },
 *       { value: 1.0, pitchDegrees: 25 }
 *     ],
 *
 *     "stage-2": [
 *       { value: 0.0, pitchDegrees: 25 },
 *       { value: 1.0, pitchDegrees: 0 }
 *     ]
 *   }
 *
 * This is particularly useful when different stage durations make one global
 * time schedule awkward.
 */
export function createStageProgressPitchProgram({
  stageProfiles,

  interpolation =
    PROFILE_INTERPOLATION.SMOOTHSTEP,

  progradeSign = 1,

  id =
    "stage-progress-pitch-program",

  origin =
    GUIDANCE_PROFILE_ORIGIN.USER_DEFINED,
}) {
  assertObject(
    stageProfiles,
    "stageProfiles"
  );

  assertInterpolation(
    interpolation
  );

  assertProgradeSign(
    progradeSign
  );

  const validatedProfiles =
    {};

  for (
    const [
      key,
      points,
    ]
    of Object.entries(
      stageProfiles
    )
  ) {
    validatedProfiles[key] =
      createPitchControlPoints({
        points,

        coordinate:
          PROFILE_COORDINATE.STAGE_PROGRESS,
      });
  }

  if (
    Object.keys(
      validatedProfiles
    ).length === 0
  ) {
    throw new RangeError(
      "stageProfiles must define at least one stage profile."
    );
  }

  const profile =
    Object.freeze({
      model:
        GUIDANCE_PROFILE_MODEL,

      id:
        id.trim(),

      origin,

      coordinate:
        PROFILE_COORDINATE.STAGE_PROGRESS,

      interpolation,

      progradeSign,

      stageProfiles:
        Object.freeze({
          ...validatedProfiles,
        }),
    });

  const provider =
    (
      context
    ) => {
      assertProviderContext(
        context
      );

      const stage =
        context.activeStage;

      if (
        stage === null ||
        stage === undefined
      ) {
        return Object.freeze({
          mode:
            "velocityAligned",

          progradeSign:
            profile.progradeSign,
        });
      }

      const stageIndexKey =
        String(
          context
            .activeStageIndex
        );

      const stageIdKey =
        stage.id ?? null;

      const points =
        (
          stageIdKey !== null
            ? profile
                .stageProfiles[
                  stageIdKey
                ]
            : undefined
        ) ??
        profile
          .stageProfiles[
            stageIndexKey
          ];

      if (
        points === undefined
      ) {
        throw new RangeError(
          `No stage guidance profile was supplied for active stage "${stage.id ?? stageIndexKey}".`
        );
      }

      const stageProgress =
        getStageProgressFromContext(
          context
        );

      const pitchDegrees =
        evaluatePitchAtCoordinate({
          coordinateValue:
            stageProgress,

          points,

          interpolation:
            profile.interpolation,
        });

      return Object.freeze({
        mode:
          "radialTangentialBlend",

        blendFactor:
          pitchDegreesToBlendFactor(
            pitchDegrees
          ),

        progradeSign:
          profile.progradeSign,
      });
    };

  Object.defineProperty(
    provider,
    "profile",
    {
      value:
        profile,

      enumerable:
        true,

      writable:
        false,

      configurable:
        false,
    }
  );

  return provider;
}


// =============================================================================
// 10. GENERIC ASSUMED DEMONSTRATION PROFILE
// =============================================================================

/**
 * Create a deliberately generic, open-loop demonstration profile.
 *
 * MODEL STATUS:
 *   ASSUMED / EDUCATIONAL
 *
 * This preset is NOT calibrated to a real launch vehicle.
 *
 * It exists only so:
 * - the integrated simulator can be exercised,
 * - the Analyzer can have a clearly labelled default,
 * - the schedule can be replaced with documented vehicle-specific data.
 *
 * The default shape is:
 *
 *   0–1 km:
 *     nearly radial
 *
 *   1–20 km:
 *     begin turning
 *
 *   20–60 km:
 *     continue reducing pitch
 *
 *   60–120 km:
 *     approach near-tangential thrust
 *
 *   above 120 km:
 *     tangential
 *
 * These numbers are explicit modeling assumptions, NOT operational guidance.
 */
export function createGenericAssumedAscentGuidance({
  progradeSign = 1,
} = {}) {
  assertProgradeSign(
    progradeSign
  );

  return createPitchProgram({
    id:
      "generic-assumed-altitude-profile-v1",

    origin:
      GUIDANCE_PROFILE_ORIGIN.GENERIC_ASSUMED,

    coordinate:
      PROFILE_COORDINATE.ALTITUDE,

    interpolation:
      PROFILE_INTERPOLATION.SMOOTHSTEP,

    progradeSign,

    points: [
      {
        value:
          0,

        pitchDegrees:
          90,
      },

      {
        value:
          1_000,

        pitchDegrees:
          90,
      },

      {
        value:
          20_000,

        pitchDegrees:
          65,
      },

      {
        value:
          60_000,

        pitchDegrees:
          30,
      },

      {
        value:
          120_000,

        pitchDegrees:
          0,
      },
    ],
  });
}


// =============================================================================
// 11. PROFILE INSPECTION / REPORTING
// =============================================================================

/**
 * Return a serializable description for UI / methodology reporting.
 */
export function getGuidanceProfileDescription(
  guidanceProvider
) {
  if (
    typeof guidanceProvider !==
    "function"
  ) {
    throw new TypeError(
      "guidanceProvider must be a function."
    );
  }

  const profile =
    guidanceProvider.profile;

  if (
    profile === undefined
  ) {
    return Object.freeze({
      model:
        "UNKNOWN_GUIDANCE_PROVIDER",

      inspectable:
        false,
    });
  }

  return Object.freeze({
    model:
      profile.model,

    id:
      profile.id,

    origin:
      profile.origin,

    coordinate:
      profile.coordinate,

    interpolation:
      profile.interpolation,

    progradeSign:
      profile.progradeSign,

    inspectable:
      true,

    controlPoints:
      profile.controlPoints
        ? Object.freeze(
            profile.controlPoints.map(
              (point) =>
                Object.freeze({
                  ...point,
                })
            )
          )
        : null,

    stageProfiles:
      profile.stageProfiles ??
      null,
  });
}
