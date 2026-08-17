/**
 * @file result-adapter.js
 * @description Converts raw simulation output into stable UI, chart, report,
 * and export structures. This module performs presentation transformations only;
 * it does not recompute trajectories or redefine mission/orbit classification.
 */
export const RESULT_SCHEMA_VERSION = 1;


// =============================================================================
// 1. VALIDATION
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


function assertArray(value, name) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${name} must be an array.`);
  }
}


function finiteOrNull(value) {
  return Number.isFinite(value)
    ? value
    : null;
}


function freezeArray(array) {
  return Object.freeze([...array]);
}


// =============================================================================
// 2. PRESENTATION CONVERSIONS
// =============================================================================

const M_TO_KM = 1 / 1000;
const MPS_TO_KMPS = 1 / 1000;
const PA_TO_KPA = 1 / 1000;

function metresToKilometres(value) {
  if (value === Infinity) return Infinity;
  return Number.isFinite(value)
    ? value * M_TO_KM
    : null;
}


function metresPerSecondToKilometresPerSecond(value) {
  return Number.isFinite(value)
    ? value * MPS_TO_KMPS
    : null;
}


function pascalsToKilopascals(value) {
  return Number.isFinite(value)
    ? value * PA_TO_KPA
    : null;
}


function radiansToDegrees(value) {
  return Number.isFinite(value)
    ? value * 180 / Math.PI
    : null;
}


// =============================================================================
// 3. NUMBER FORMATTING
// =============================================================================

export function formatEngineeringValue(
  value,
  {
    maximumFractionDigits = 2,
    fallback = "—",
  } = {}
) {
  if (value === Infinity) return "∞";
  if (value === -Infinity) return "−∞";
  if (!Number.isFinite(value)) return fallback;

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
  }).format(value);
}


// =============================================================================
// 4. STATUS
// =============================================================================

function createResultStatus(orbitReport) {
  assertObject(orbitReport, "simulationResult.orbitReport");

  const basic =
    orbitReport.basicClassification;

  const target =
    orbitReport.targetEvaluation;

  if (target !== null) {
    return Object.freeze({
      classification:
        target.classification,

      basicClassification:
        basic,

      reachedTarget:
        target.reachedTarget,

      tone:
        target.reachedTarget
          ? "success"
          : (
              target.classification === "NEAR_TARGET"
                ? "warning"
                : "neutral"
            ),
    });
  }

  return Object.freeze({
    classification:
      basic,

    basicClassification:
      basic,

    reachedTarget:
      null,

    tone:
      basic === "BOUND_ORBIT"
        ? "success"
        : (
            basic === "ESCAPE"
              ? "warning"
              : "neutral"
          ),
  });
}


// =============================================================================
// 5. SUMMARY CARDS
// =============================================================================

function metric({
  id,
  label,
  value,
  unit,
  displayValue,
  secondary = null,
}) {
  return Object.freeze({
    id,
    label,
    value,
    unit,
    displayValue,
    secondary,
  });
}


function maximumMetric(
  source,
  {
    id,
    label,
    transform = (value) => value,
    unit,
    digits = 2,
  }
) {
  if (source === null) {
    return metric({
      id,
      label,
      value: null,
      unit,
      displayValue: "—",
    });
  }

  const transformed =
    transform(source.value);

  return metric({
    id,
    label,
    value:
      transformed,

    unit,

    displayValue:
      formatEngineeringValue(
        transformed,
        {
          maximumFractionDigits:
            digits,
        }
      ),

    secondary:
      Object.freeze({
        timeS:
          source.time,

        altitudeKm:
          metresToKilometres(
            source.altitude
          ),

        activeStageIndex:
          source.activeStageIndex,
      }),
  });
}


function createSummaryCards(simulationResult) {
  const summary =
    simulationResult.summary;

  const orbit =
    simulationResult.orbitReport.orbit;

  return freezeArray([
    maximumMetric(
      summary.maxAltitude,
      {
        id: "max-altitude",
        label: "Maximum altitude",
        transform:
          metresToKilometres,
        unit: "km",
        digits: 1,
      }
    ),

    maximumMetric(
      summary.maxSpeed,
      {
        id: "max-speed",
        label: "Maximum speed",
        transform:
          metresPerSecondToKilometresPerSecond,
        unit: "km/s",
        digits: 3,
      }
    ),

    maximumMetric(
      summary.maxMach,
      {
        id: "max-mach",
        label: "Maximum Mach",
        unit: "",
        digits: 2,
      }
    ),

    maximumMetric(
      summary.maxQ,
      {
        id: "max-q",
        label: "Max-Q",
        transform:
          pascalsToKilopascals,
        unit: "kPa",
        digits: 2,
      }
    ),

    maximumMetric(
      summary.maxAcceleration,
      {
        id: "max-acceleration",
        label: "Maximum acceleration",
        unit: "m/s²",
        digits: 2,
      }
    ),

    maximumMetric(
      summary.maxThrustToWeightRatio,
      {
        id: "max-twr",
        label: "Maximum TWR",
        unit: "",
        digits: 2,
      }
    ),

    metric({
      id:
        "flight-time",

      label:
        "Simulation duration",

      value:
        summary.duration,

      unit:
        "s",

      displayValue:
        formatEngineeringValue(
          summary.duration,
          {
            maximumFractionDigits:
              2,
          }
        ),
    }),

    metric({
      id:
        "final-mass",

      label:
        "Final mass",

      value:
        summary.finalMass,

      unit:
        "kg",

      displayValue:
        formatEngineeringValue(
          summary.finalMass,
          {
            maximumFractionDigits:
              2,
          }
        ),
    }),

    metric({
      id:
        "periapsis",

      label:
        "Periapsis altitude",

      value:
        metresToKilometres(
          orbit.periapsisAltitude
        ),

      unit:
        "km",

      displayValue:
        formatEngineeringValue(
          metresToKilometres(
            orbit.periapsisAltitude
          ),
          {
            maximumFractionDigits:
              2,
          }
        ),
    }),

    metric({
      id:
        "apoapsis",

      label:
        "Apoapsis altitude",

      value:
        metresToKilometres(
          orbit.apoapsisAltitude
        ),

      unit:
        "km",

      displayValue:
        formatEngineeringValue(
          metresToKilometres(
            orbit.apoapsisAltitude
          ),
          {
            maximumFractionDigits:
              2,
          }
        ),
    }),
  ]);
}


// =============================================================================
// 6. CHART SERIES
// =============================================================================

function createSeries({
  id,
  label,
  xLabel = "Time",
  xUnit = "s",
  yLabel,
  yUnit,
  points,
}) {
  return Object.freeze({
    id,
    label,
    xLabel,
    xUnit,
    yLabel,
    yUnit,
    points:
      freezeArray(
        points.map(
          (point) =>
            Object.freeze({
              x: point.x,
              y: point.y,
            })
        )
      ),
  });
}


function getHistoryValue(
  sample,
  path
) {
  let value = sample;

  for (const key of path) {
    if (
      value === null ||
      value === undefined
    ) {
      return null;
    }

    value = value[key];
  }

  return value;
}


function createTimeSeries(
  history,
  {
    id,
    label,
    path,
    transform =
      (value) => value,
    yLabel,
    yUnit,
    includeNull = false,
  }
) {
  const points = [];

  for (const sample of history) {
    const raw =
      getHistoryValue(
        sample,
        path
      );

    const transformed =
      transform(raw);

    if (
      transformed === null ||
      transformed === undefined ||
      (
        !includeNull &&
        !Number.isFinite(
          transformed
        )
      )
    ) {
      continue;
    }

    points.push({
      x:
        sample.time,

      y:
        transformed,
    });
  }

  return createSeries({
    id,
    label,
    yLabel,
    yUnit,
    points,
  });
}


function downsampleHistory(
  history,
  stride = 1
) {
  if (
    !Number.isInteger(stride) ||
    stride <= 1 ||
    history.length <= 2
  ) {
    return history;
  }

  const sampled = [history[0]];

  for (
    let index = stride;
    index < history.length - 1;
    index += stride
  ) {
    sampled.push(
      history[index]
    );
  }

  const last =
    history[
      history.length - 1
    ];

  if (
    sampled[
      sampled.length - 1
    ] !== last
  ) {
    sampled.push(last);
  }

  return freezeArray(
    sampled
  );
}


function appendTerminalMassPoint({
  series,
  finalTime,
  finalMass,
}) {
  if (
    !Number.isFinite(finalTime) ||
    !Number.isFinite(finalMass)
  ) {
    return series;
  }

  const points = [
    ...series.points,
  ];

  const last =
    points[
      points.length - 1
    ] ?? null;

  if (
    last === null ||
    last.x !== finalTime ||
    last.y !== finalMass
  ) {
    points.push(
      Object.freeze({
        x: finalTime,
        y: finalMass,
      })
    );
  }

  return Object.freeze({
    ...series,
    points:
      freezeArray(points),
  });
}


function createChartSeries(
  history,
  {
    finalTime = null,
    finalState = null,
  } = {}
) {
  return Object.freeze({
    altitude:
      createTimeSeries(
        history,
        {
          id:
            "altitude-time",

          label:
            "Altitude vs time",

          path:
            [
              "diagnostics",
              "altitude",
            ],

          transform:
            metresToKilometres,

          yLabel:
            "Altitude",

          yUnit:
            "km",
        }
      ),

    speed:
      createTimeSeries(
        history,
        {
          id:
            "speed-time",

          label:
            "Speed vs time",

          path:
            [
              "diagnostics",
              "speed",
            ],

          transform:
            metresPerSecondToKilometresPerSecond,

          yLabel:
            "Speed",

          yUnit:
            "km/s",
        }
      ),

    mach:
      createTimeSeries(
        history,
        {
          id:
            "mach-time",

          label:
            "Mach vs time",

          path:
            [
              "diagnostics",
              "aerodynamics",
              "mach",
            ],

          yLabel:
            "Mach",

          yUnit:
            "",
        }
      ),

    dynamicPressure:
      createTimeSeries(
        history,
        {
          id:
            "q-time",

          label:
            "Dynamic pressure vs time",

          path:
            [
              "diagnostics",
              "aerodynamics",
              "dynamicPressure",
            ],

          transform:
            pascalsToKilopascals,

          yLabel:
            "Dynamic pressure",

          yUnit:
            "kPa",
        }
      ),

    mass:
      appendTerminalMassPoint({
        series:
          createTimeSeries(
            history,
            {
              id:
                "mass-time",

              label:
                "Vehicle mass vs time",

              path:
                [
                  "state",
                  "mass",
                ],

              yLabel:
                "Mass",

              yUnit:
                "kg",
            }
          ),

        finalTime,

        finalMass:
          finalState?.mass ??
          null,
      }),

    acceleration:
      createTimeSeries(
        history,
        {
          id:
            "acceleration-time",

          label:
            "Acceleration vs time",

          path:
            [
              "diagnostics",
              "accelerationMagnitude",
            ],

          yLabel:
            "Acceleration",

          yUnit:
            "m/s²",
        }
      ),

    thrustToWeightRatio:
      createTimeSeries(
        history,
        {
          id:
            "twr-time",

          label:
            "TWR vs time",

          path:
            [
              "diagnostics",
              "thrustToWeightRatio",
            ],

          yLabel:
            "TWR",

          yUnit:
            "",
        }
      ),

    thrust:
      createTimeSeries(
        history,
        {
          id:
            "thrust-time",

          label:
            "Thrust vs time",

          path:
            [
              "diagnostics",
              "propulsion",
              "thrust",
            ],

          transform:
            (value) =>
              Number.isFinite(value)
                ? value / 1000
                : null,

          yLabel:
            "Thrust",

          yUnit:
            "kN",
        }
      ),

    atmosphericDensity:
      createTimeSeries(
        history,
        {
          id:
            "density-time",

          label:
            "Atmospheric density vs time",

          path:
            [
              "diagnostics",
              "atmosphere",
              "density",
            ],

          yLabel:
            "Density",

          yUnit:
            "kg/m³",
        }
      ),
  });
}


// =============================================================================
// 7. TRAJECTORY
// =============================================================================

function normalizeAngleDifference(
  angle
) {
  let result =
    angle;

  while (
    result >
    Math.PI
  ) {
    result -=
      2 *
      Math.PI;
  }

  while (
    result <
    -Math.PI
  ) {
    result +=
      2 *
      Math.PI;
  }

  return result;
}


/**
 * Produce both:
 *
 * 1. Earth-centred coordinates for faithful geometry.
 * 2. downrange-altitude coordinates for a readable engineering chart.
 *
 * body radius is derived from:
 *
 *   radius - altitude
 *
 * in the first diagnostic sample. No Earth model is changed here.
 */
function createTrajectory(history) {
  if (history.length === 0) {
    return Object.freeze({
      earthCentered:
        freezeArray([]),

      downrangeAltitude:
        freezeArray([]),
    });
  }

  const first =
    history[0];

  const bodyRadius =
    first.diagnostics.radius -
    first.diagnostics.altitude;

  const firstAngle =
    Math.atan2(
      first.state.y,
      first.state.x
    );

  let previousAngle =
    firstAngle;

  let cumulativeAngle = 0;

  const earthCentered = [];
  const downrangeAltitude = [];

  for (const sample of history) {
    const angle =
      Math.atan2(
        sample.state.y,
        sample.state.x
      );

    const delta =
      normalizeAngleDifference(
        angle -
        previousAngle
      );

    cumulativeAngle +=
      delta;

    previousAngle =
      angle;

    earthCentered.push(
      Object.freeze({
        timeS:
          sample.time,

        xKm:
          metresToKilometres(
            sample.state.x
          ),

        yKm:
          metresToKilometres(
            sample.state.y
          ),

        altitudeKm:
          metresToKilometres(
            sample
              .diagnostics
              .altitude
          ),
      })
    );

    downrangeAltitude.push(
      Object.freeze({
        timeS:
          sample.time,

        downrangeKm:
          metresToKilometres(
            cumulativeAngle *
            bodyRadius
          ),

        altitudeKm:
          metresToKilometres(
            sample
              .diagnostics
              .altitude
          ),
      })
    );
  }

  return Object.freeze({
    bodyRadiusKm:
      metresToKilometres(
        bodyRadius
      ),

    earthCentered:
      freezeArray(
        earthCentered
      ),

    downrangeAltitude:
      freezeArray(
        downrangeAltitude
      ),
  });
}


// =============================================================================
// 8. EVENTS
// =============================================================================

function eventLabel(event) {
  switch (event.type) {
    case "simulationStart":
      return "Simulation start";

    case "stageBurnout":
      return "Stage burnout";

    case "stageSeparation":
      return "Stage separation";

    case "maxQ":
      return "Max-Q";

    case "bodyImpact":
      return "Body impact";

    case "simulationEnd":
      return "Simulation end";

    default:
      return event.type;
  }
}


function resolveStageForEvent(
  event,
  vehicle
) {
  if (
    vehicle === null
  ) {
    return null;
  }

  let index = null;

  if (
    Number.isInteger(
      event.stageIndex
    )
  ) {
    index =
      event.stageIndex;
  } else if (
    Number.isInteger(
      event.separatedStageIndex
    )
  ) {
    index =
      event.separatedStageIndex;
  } else if (
    Number.isInteger(
      event.activeStageIndex
    )
  ) {
    index =
      event.activeStageIndex;
  }

  if (
    index === null
  ) {
    return null;
  }

  const stage =
    vehicle.stages[
      index
    ] ?? null;

  if (
    stage === null
  ) {
    return null;
  }

  return Object.freeze({
    index,
    id:
      stage.id,

    name:
      stage.name,
  });
}


function createEventTimeline(
  events,
  vehicle
) {
  return freezeArray(
    events.map(
      (event) => {
        const stage =
          resolveStageForEvent(
            event,
            vehicle
          );

        const normalized =
          {
            type:
              event.type,

            label:
              eventLabel(
                event
              ),

            timeS:
              event.time ??
              null,

            stage,

            raw:
              event,
          };

        if (
          event.type ===
          "maxQ"
        ) {
          normalized.altitudeKm =
            metresToKilometres(
              event.altitude
            );

          normalized.dynamicPressureKPa =
            pascalsToKilopascals(
              event.dynamicPressure
            );
        }

        if (
          event.type ===
          "stageSeparation"
        ) {
          normalized.discardedMassKg =
            event.discardedMass;
        }

        if (
          event.type ===
          "simulationEnd"
        ) {
          normalized.terminationReason =
            event.terminationReason;
        }

        return Object.freeze(
          normalized
        );
      }
    )
  );
}


// =============================================================================
// 9. STAGE RESULTS
// =============================================================================

function findEvent(
  events,
  predicate
) {
  return (
    events.find(
      predicate
    ) ??
    null
  );
}


function createStageResults({
  simulationResult,
  vehicle,
}) {
  if (vehicle === null) {
    return freezeArray([]);
  }

  const runtime =
    simulationResult
      .finalStagingState;

  const events =
    simulationResult.events;

  const rows =
    vehicle.stages.map(
      (
        stage,
        stageIndex
      ) => {
        const burnout =
          findEvent(
            events,
            (event) =>
              event.type ===
                "stageBurnout" &&
              (
                event.stageIndex ===
                  stageIndex ||
                event.stageId ===
                  stage.id
              )
          );

        const separation =
          findEvent(
            events,
            (event) =>
              event.type ===
                "stageSeparation" &&
              (
                event
                  .separatedStageIndex ===
                  stageIndex ||
                event
                  .separatedStageId ===
                  stage.id
              )
          );

        const activationTime =
          stageIndex === 0
            ? 0
            : (
                findEvent(
                  events,
                  (event) =>
                    event.type ===
                      "stageSeparation" &&
                    event
                      .nextStageIndex ===
                      stageIndex
                )?.time ??
                null
              );

        const runtimeState =
          runtime
            .stageStates[
              stageIndex
            ] ??
          null;

        const usablePropellant =
          stage.masses
            .propellantMass -
          stage.masses
            .residualPropellantMass;

        const remainingUsable =
          runtimeState
            ?.remainingUsablePropellant ??
          usablePropellant;

        const consumedUsable =
          Math.max(
            0,
            usablePropellant -
            remainingUsable
          );

        return Object.freeze({
          stageIndex,

          stageId:
            stage.id,

          stageName:
            stage.name,

          activationTimeS:
            activationTime,

          burnoutTimeS:
            burnout?.time ??
            null,

          poweredDurationS:
            activationTime !== null &&
            burnout !== null
              ? burnout.time -
                activationTime
              : null,

          separationTimeS:
            separation?.time ??
            null,

          separationDelayS:
            burnout !== null &&
            separation !== null
              ? separation.time -
                burnout.time
              : null,

          dryMassKg:
            stage.masses
              .dryMass,

          propellantMassKg:
            stage.masses
              .propellantMass,

          residualPropellantMassKg:
            stage.masses
              .residualPropellantMass,

          usablePropellantMassKg:
            usablePropellant,

          usablePropellantConsumedKg:
            consumedUsable,

          remainingUsablePropellantKg:
            remainingUsable,

          discardedMassKg:
            separation
              ?.discardedMass ??
            null,

          burnedOut:
            runtimeState
              ?.burnedOut ??
            false,

          separated:
            runtimeState
              ?.separated ??
            false,
        });
      }
    );

  return freezeArray(
    rows
  );
}


// =============================================================================
// 10. ORBIT OUTPUT
// =============================================================================

function createOrbitOutput(
  orbitReport
) {
  const orbit =
    orbitReport.orbit;

  const target =
    orbitReport.targetEvaluation;

  return Object.freeze({
    basicClassification:
      orbitReport
        .basicClassification,

    targetEvaluation:
      target === null
        ? null
        : Object.freeze({
            ...target,

            targetPeriapsisAltitudeKm:
              metresToKilometres(
                target
                  .targetPeriapsisAltitude
              ),

            targetApoapsisAltitudeKm:
              metresToKilometres(
                target
                  .targetApoapsisAltitude
              ),

            altitudeToleranceKm:
              metresToKilometres(
                target
                  .altitudeTolerance
              ),

            achievedPeriapsisAltitudeKm:
              metresToKilometres(
                target
                  .achievedPeriapsisAltitude
              ),

            achievedApoapsisAltitudeKm:
              metresToKilometres(
                target
                  .achievedApoapsisAltitude
              ),

            periapsisErrorKm:
              metresToKilometres(
                target
                  .periapsisError
              ),

            apoapsisErrorKm:
              metresToKilometres(
                target
                  .apoapsisError
              ),
          }),

    values:
      Object.freeze({
        altitudeKm:
          metresToKilometres(
            orbit.altitude
          ),

        speedKmPerS:
          metresPerSecondToKilometresPerSecond(
            orbit.speed
          ),

        radialVelocityKmPerS:
          metresPerSecondToKilometresPerSecond(
            orbit.radialVelocity
          ),

        tangentialVelocityKmPerS:
          metresPerSecondToKilometresPerSecond(
            orbit.tangentialVelocity
          ),

        specificEnergyJPerKg:
          orbit.specificEnergy,

        specificAngularMomentumM2PerS:
          orbit
            .specificAngularMomentum,

        eccentricity:
          orbit.eccentricity,

        semiMajorAxisKm:
          metresToKilometres(
            orbit.semiMajorAxis
          ),

        periapsisAltitudeKm:
          metresToKilometres(
            orbit.periapsisAltitude
          ),

        apoapsisAltitudeKm:
          metresToKilometres(
            orbit.apoapsisAltitude
          ),

        orbitalPeriodS:
          orbit.orbitalPeriod,

        circularSpeedKmPerS:
          metresPerSecondToKilometresPerSecond(
            orbit.circularSpeed
          ),

        escapeSpeedKmPerS:
          metresPerSecondToKilometresPerSecond(
            orbit.escapeSpeed
          ),

        isBound:
          orbit.isBound,

        isEscape:
          orbit.isEscape,

        intersectsBody:
          orbit.intersectsBody,
      }),

    raw:
      orbitReport,
  });
}


// =============================================================================
// 11. WARNINGS / ASSUMPTIONS
// =============================================================================

function createWarnings({
  simulationResult,
  inputMetadata,
}) {
  const combined = [];

  if (
    inputMetadata !== null &&
    Array.isArray(
      inputMetadata.warnings
    )
  ) {
    for (
      const warning of
      inputMetadata.warnings
    ) {
      combined.push(
        Object.freeze({
          source:
            "input",

          code:
            warning.code ??
            "INPUT_WARNING",

          message:
            warning.message,
        })
      );
    }
  }

  for (
    const warning of
    simulationResult.warnings
  ) {
    combined.push(
      Object.freeze({
        source:
          "simulation",

        code:
          warning.code ??
          "SIMULATION_WARNING",

        message:
          warning.message,
      })
    );
  }

  if (
    simulationResult
      .summary
      .terminationReason ===
    "maxTime"
  ) {
    combined.push(
      Object.freeze({
        source:
          "result",

        code:
          "MAX_TIME_TERMINATION",

        message:
          "Simulation stopped because solver.maxTime was reached before a natural completion event.",
      })
    );
  }

  if (
    simulationResult
      .summary
      .terminationReason ===
    "maxSteps"
  ) {
    combined.push(
      Object.freeze({
        source:
          "result",

        code:
          "MAX_STEPS_TERMINATION",

        message:
          "Simulation stopped because solver.maxSteps was reached.",
      })
    );
  }

  if (
    simulationResult
      .summary
      .terminationReason ===
    "bodyImpact"
  ) {
    combined.push(
      Object.freeze({
        source:
          "result",

        code:
          "BODY_IMPACT",

        message:
          "The propagated vehicle state intersected the spherical Earth model.",
      })
    );
  }

  return freezeArray(
    combined
  );
}


// =============================================================================
// 12. EXPORT-FRIENDLY REPORT
// =============================================================================

function createExportData({
  status,
  summaryCards,
  stageResults,
  orbit,
  events,
  warnings,
  inputMetadata,
}) {
  return Object.freeze({
    schemaVersion:
      RESULT_SCHEMA_VERSION,

    generatedFrom:
      "Launch Vehicle Analyzer simulation result",

    status,

    summary:
      summaryCards,

    stages:
      stageResults,

    orbit,

    events,

    warnings,

    inputMetadata:
      inputMetadata ??
      null,
  });
}


// =============================================================================
// 13. MAIN ADAPTER
// =============================================================================

/**
 * Prepare one raw simulation result for the Analyzer UI.
 *
 * Parameters
 * ----------
 * simulationResult:
 *   Return value from runSimulation().
 *
 * simulationConfig:
 *   The config passed to runSimulation().
 *   Used only to add stage names and static stage values to output tables.
 *
 * inputMetadata:
 *   Optional metadata returned by prepareSimulationInput().
 *
 *
 * Return
 * ------
 * {
 *   schemaVersion,
 *   status,
 *   summaryCards,
 *   charts,
 *   trajectory,
 *   stages,
 *   events,
 *   orbit,
 *   warnings,
 *   exportData,
 *   raw
 * }
 */
export function prepareSimulationResult({
  simulationResult,
  simulationConfig = null,
  inputMetadata = null,
}) {
  assertObject(
    simulationResult,
    "simulationResult"
  );

  assertArray(
    simulationResult.history,
    "simulationResult.history"
  );

  assertArray(
    simulationResult.events,
    "simulationResult.events"
  );

  assertArray(
    simulationResult.warnings,
    "simulationResult.warnings"
  );

  assertObject(
    simulationResult.summary,
    "simulationResult.summary"
  );

  assertObject(
    simulationResult.orbitReport,
    "simulationResult.orbitReport"
  );

  if (
    simulationConfig !== null
  ) {
    assertObject(
      simulationConfig,
      "simulationConfig"
    );
  }

  if (
    inputMetadata !== null
  ) {
    assertObject(
      inputMetadata,
      "inputMetadata"
    );
  }

  const vehicle =
    simulationConfig
      ?.vehicle ??
    null;

  const status =
    createResultStatus(
      simulationResult
        .orbitReport
    );

  const summaryCards =
    createSummaryCards(
      simulationResult
    );

  const displayHistory =
    downsampleHistory(
      simulationResult.history,
      simulationConfig
        ?.solver
        ?.recordEveryNSteps ??
        1
    );

  const charts =
    createChartSeries(
      displayHistory,
      {
        finalTime:
          simulationResult.finalTime,

        finalState:
          simulationResult.finalState,
      }
    );

  const trajectory =
    createTrajectory(
      displayHistory
    );

  const stages =
    createStageResults({
      simulationResult,
      vehicle,
    });

  const events =
    createEventTimeline(
      simulationResult.events,
      vehicle
    );

  const orbit =
    createOrbitOutput(
      simulationResult
        .orbitReport
    );

  const warnings =
    createWarnings({
      simulationResult,
      inputMetadata,
    });

  const exportData =
    createExportData({
      status,
      summaryCards,
      stageResults:
        stages,
      orbit,
      events,
      warnings,
      inputMetadata,
    });

  return Object.freeze({
    schemaVersion:
      RESULT_SCHEMA_VERSION,

    status,

    summaryCards,

    charts,

    trajectory,

    stages,

    events,

    orbit,

    warnings,

    exportData,

    raw:
      simulationResult,
  });
}
