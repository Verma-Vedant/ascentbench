/**
 * @file simulation.js
 * @description Event-aware ascent simulation orchestrator. Coordinates the
 * validated physics modules, RK4 integration, stage events, trajectory history,
 * and final orbit reporting. No physical law is defined or altered here.
 */
import { R_EARTH } from "../physics/constants.js";
import { getVehicleInitialMass } from "../physics/vehicle-model.js";
import { evaluateDynamics } from "../physics/dynamics.js";
import { integrateStep, validateIntegratorState } from "../physics/integrator.js";
import {
  createInitialStagingState,
  getActiveStage,
  getActiveStageState,
  getRemainingUsablePropellant,
  isActiveStageBurnedOut,
  getBurnoutSafeStepSize,
  consumeActiveStagePropellant,
  separateActiveStage,
  getStagingSummary,
} from "../physics/staging.js";
import { createOrbitReport } from "../physics/orbit.js";

export const DEFAULT_SIMULATION_OPTIONS = Object.freeze({
  dt: 0.1,
  method: "rk4",
  maxTime: 2_000,
  maxSteps: 500_000,
  burnoutMassTolerance: 1e-8,
  eventTimeTolerance: 1e-8,
  atmosphereOptions: Object.freeze({ aboveModel: "vacuum" }),
});

function assertObject(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
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
  if (value <= 0) throw new RangeError(`${name} must be greater than 0.`);
}

function assertNonNegativeNumber(value, name) {
  assertFiniteNumber(value, name);
  if (value < 0) throw new RangeError(`${name} cannot be negative.`);
}

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
}

function assertVector2(value, name) {
  assertObject(value, name);
  assertFiniteNumber(value.x, `${name}.x`);
  assertFiniteNumber(value.y, `${name}.y`);
}

function freezeState(state) {
  return Object.freeze({
    x: state.x,
    y: state.y,
    vx: state.vx,
    vy: state.vy,
    mass: state.mass,
  });
}

/**
 * Construct the initial continuous state.
 *
 * Default frame:
 *   launch point = +x radial direction
 *   local prograde tangent = +y direction
 *
 * Initial mass is always derived from vehicle-model.js.
 */
export function createInitialSimulationState({
  vehicle,
  launchAltitude = 0,
  position = null,
  velocity = { x: 0, y: 0 },
}) {
  assertObject(vehicle, "vehicle");
  assertNonNegativeNumber(launchAltitude, "launchAltitude");
  assertVector2(velocity, "velocity");

  let resolvedPosition;

  if (position === null) {
    resolvedPosition = {
      x: R_EARTH + launchAltitude,
      y: 0,
    };
  } else {
    assertVector2(position, "position");
    resolvedPosition = { x: position.x, y: position.y };
  }

  const radius = Math.hypot(resolvedPosition.x, resolvedPosition.y);

  if (radius < R_EARTH) {
    throw new RangeError(
      "Initial position cannot be inside the spherical Earth model."
    );
  }

  const state = freezeState({
    x: resolvedPosition.x,
    y: resolvedPosition.y,
    vx: velocity.x,
    vy: velocity.y,
    mass: getVehicleInitialMass(vehicle),
  });

  validateIntegratorState(state);
  return state;
}

function getCdModelFromCollection(cdModels, id) {
  if (cdModels instanceof Map) return cdModels.get(id) ?? null;

  if (
    cdModels !== null &&
    typeof cdModels === "object" &&
    !Array.isArray(cdModels)
  ) {
    return cdModels[id] ?? null;
  }

  return null;
}

/**
 * Resolve a stage Cd model.
 *
 * No implicit "universal rocket Cd curve" is invented here.
 */
export function resolveStageCdModel({
  stage,
  cdModels = null,
  defaultCdModel = null,
}) {
  assertObject(stage, "stage");
  assertObject(stage.aerodynamics, "stage.aerodynamics");

  const id = stage.aerodynamics.cdModelId ?? null;

  if (id !== null) {
    const model = getCdModelFromCollection(cdModels, id);

    if (model === null) {
      throw new RangeError(
        `No Cd model was supplied for stage.aerodynamics.cdModelId "${id}".`
      );
    }

    return model;
  }

  if (defaultCdModel !== null) return defaultCdModel;

  throw new RangeError(
    `Stage "${stage.id ?? stage.name ?? "unknown"}" has no cdModelId and no defaultCdModel was supplied.`
  );
}

function createProviderContext({ time, state, vehicle, runtime, activeStage }) {
  return Object.freeze({
    time,
    state,
    vehicle,
    runtime,
    activeStage,
    activeStageIndex: runtime.allStagesComplete
      ? null
      : runtime.activeStageIndex,
    activeStageState: getActiveStageState(runtime),
  });
}

function resolveGuidance({ guidance, guidanceProvider, context }) {
  if (guidanceProvider !== null) {
    const result = guidanceProvider(context) ?? {};
    assertObject(result, "guidanceProvider result");
    return result;
  }

  if (guidance === null || guidance === undefined) return {};

  assertObject(guidance, "guidance");
  return guidance;
}

function resolvePropulsion({
  propulsion,
  propulsionProvider,
  context,
  forceEngineOff,
}) {
  const command =
    propulsionProvider !== null
      ? propulsionProvider(context) ?? {}
      : propulsion ?? {};

  assertObject(command, "propulsion command");

  if (forceEngineOff) {
    return { ...command, engineOn: false };
  }

  return command;
}

function resolveAirVelocity({
  airVelocity,
  airVelocityProvider,
  context,
}) {
  const value =
    airVelocityProvider !== null
      ? airVelocityProvider(context)
      : airVelocity;

  assertVector2(value, "airVelocity");
  return value;
}

/**
 * Evaluate the existing coupled physics for one state.
 */
function evaluateAt({
  time,
  state,
  vehicle,
  runtime,
  cdModels,
  defaultCdModel,
  guidance,
  guidanceProvider,
  propulsion,
  propulsionProvider,
  airVelocity,
  airVelocityProvider,
  atmosphereOptions,
  forceEngineOff = false,
}) {
  const activeStage = getActiveStage(vehicle, runtime);

  if (activeStage === null) {
    throw new RangeError(
      "Cannot evaluate ascent dynamics after all serial stages are complete."
    );
  }

  const context = createProviderContext({
    time,
    state,
    vehicle,
    runtime,
    activeStage,
  });

  const cdModel = resolveStageCdModel({
    stage: activeStage,
    cdModels,
    defaultCdModel,
  });

  return evaluateDynamics({
    time,
    state,
    stage: activeStage,
    cdModel,
    guidance: resolveGuidance({
      guidance,
      guidanceProvider,
      context,
    }),
    propulsion: resolvePropulsion({
      propulsion,
      propulsionProvider,
      context,
      forceEngineOff:
        forceEngineOff || isActiveStageBurnedOut(runtime),
    }),
    airVelocity: resolveAirVelocity({
      airVelocity,
      airVelocityProvider,
      context,
    }),
    atmosphereOptions,
  });
}

/**
 * Advance one continuous interval with the existing numerical integrator.
 * The derivative is re-evaluated at every RK sub-state.
 */
function integrateContinuousStep({
  time,
  state,
  dt,
  method,
  vehicle,
  runtime,
  cdModels,
  defaultCdModel,
  guidance,
  guidanceProvider,
  propulsion,
  propulsionProvider,
  airVelocity,
  airVelocityProvider,
  atmosphereOptions,
  forceEngineOff = false,
}) {
  const derivativeFunction = (derivativeTime, derivativeState) =>
    evaluateAt({
      time: derivativeTime,
      state: derivativeState,
      vehicle,
      runtime,
      cdModels,
      defaultCdModel,
      guidance,
      guidanceProvider,
      propulsion,
      propulsionProvider,
      airVelocity,
      airVelocityProvider,
      atmosphereOptions,
      forceEngineOff,
    }).derivatives;

  return integrateStep({
    derivativeFunction,
    time,
    state,
    dt,
    method,
  });
}

function integratedMassLoss(beforeState, afterState) {
  const loss = beforeState.mass - afterState.mass;

  if (loss < -1e-9) {
    throw new Error(
      "Continuous integration increased vehicle mass unexpectedly."
    );
  }

  return Math.max(0, loss);
}

/**
 * staging.js estimates burnout timing using the current mdot.
 *
 * RK4 can evaluate propulsion at changing atmospheric pressure inside the
 * step, so actual integrated mass loss can differ slightly from mdot_start*dt.
 *
 * If a proposed step would consume more usable propellant than remains,
 * retry the SAME existing physics/integrator with a smaller dt.
 */
function findBurnoutSafeIntegratedStep({
  proposedDt,
  remainingPropellant,
  burnoutMassTolerance,
  eventTimeTolerance,
  integrateCandidate,
  beforeState,
}) {
  const firstState = integrateCandidate(proposedDt);
  const firstLoss = integratedMassLoss(beforeState, firstState);

  if (firstLoss <= remainingPropellant + burnoutMassTolerance) {
    return Object.freeze({
      dt: proposedDt,
      state: firstState,
      consumedMass: firstLoss,
      reduced: false,
    });
  }

  let low = 0;
  let high = proposedDt;
  let lowState = beforeState;
  let lowLoss = 0;

  for (let i = 0; i < 80; i += 1) {
    const mid = 0.5 * (low + high);

    if (mid <= 0) break;

    const midState = integrateCandidate(mid);
    const midLoss = integratedMassLoss(beforeState, midState);

    if (midLoss <= remainingPropellant) {
      low = mid;
      lowState = midState;
      lowLoss = midLoss;
    } else {
      high = mid;
    }

    if (
      high - low <= eventTimeTolerance ||
      Math.abs(remainingPropellant - lowLoss) <= burnoutMassTolerance
    ) {
      break;
    }
  }

  if (low <= 0) {
    throw new RangeError(
      "Unable to find a positive continuous interval before stage burnout."
    );
  }

  return Object.freeze({
    dt: low,
    state: lowState,
    consumedMass: lowLoss,
    reduced: true,
  });
}

function createHistorySample({
  time,
  state,
  vehicle,
  runtime,
  evaluation,
}) {
  return Object.freeze({
    time,
    state: freezeState(state),
    staging: getStagingSummary({ vehicle, runtime }),
    diagnostics: evaluation.diagnostics,
  });
}

function findMaximumSample(history, selector) {
  let bestSample = null;
  let bestValue = -Infinity;

  for (const sample of history) {
    const value = selector(sample);

    if (value === null || value === undefined || !Number.isFinite(value)) {
      continue;
    }

    if (value > bestValue) {
      bestValue = value;
      bestSample = sample;
    }
  }

  if (bestSample === null) return null;

  return Object.freeze({
    value: bestValue,
    time: bestSample.time,
    altitude: bestSample.diagnostics.altitude,
    activeStageIndex: bestSample.staging.activeStageIndex,
  });
}

function createSummary({
  vehicle,
  history,
  events,
  finalState,
  finalTime,
  terminationReason,
  steps,
}) {
  return Object.freeze({
    terminationReason,
    duration: finalTime,
    integrationSteps: steps,
    initialMass: getVehicleInitialMass(vehicle),
    finalMass: finalState.mass,
    stageSeparationCount: events.filter(
      (event) => event.type === "stageSeparation"
    ).length,

    maxAltitude: findMaximumSample(
      history,
      (sample) => sample.diagnostics.altitude
    ),

    maxSpeed: findMaximumSample(
      history,
      (sample) => sample.diagnostics.speed
    ),

    maxMach: findMaximumSample(
      history,
      (sample) => sample.diagnostics.aerodynamics.mach
    ),

    maxQ: findMaximumSample(
      history,
      (sample) => sample.diagnostics.aerodynamics.dynamicPressure
    ),

    maxAcceleration: findMaximumSample(
      history,
      (sample) => sample.diagnostics.accelerationMagnitude
    ),

    maxThrustToWeightRatio: findMaximumSample(
      history,
      (sample) => sample.diagnostics.thrustToWeightRatio
    ),
  });
}

/**
 * Run one event-aware serial-stage ascent simulation.
 *
 * Required:
 *   vehicle
 *
 * Aerodynamics:
 *   cdModels or defaultCdModel
 *
 * Guidance:
 *   guidance (static) OR guidanceProvider(context)
 *
 * targetOrbit, when supplied, uses orbit.js's existing target shape:
 *   {
 *     periapsisAltitude,
 *     apoapsisAltitude,
 *     altitudeTolerance
 *   }
 */
export function runSimulation({
  vehicle,

  cdModels = null,
  defaultCdModel = null,

  guidance = null,
  guidanceProvider = null,

  propulsion = { engineOn: true, throttle: 1 },
  propulsionProvider = null,

  airVelocity = { x: 0, y: 0 },
  airVelocityProvider = null,

  initialConditions = {},
  targetOrbit = null,

  solver = {},
  atmosphereOptions = null,
}) {
  assertObject(vehicle, "vehicle");
  assertObject(initialConditions, "initialConditions");
  assertObject(solver, "solver");

  if (guidanceProvider !== null && typeof guidanceProvider !== "function") {
    throw new TypeError("guidanceProvider must be a function or null.");
  }

  if (
    propulsionProvider !== null &&
    typeof propulsionProvider !== "function"
  ) {
    throw new TypeError("propulsionProvider must be a function or null.");
  }

  if (
    airVelocityProvider !== null &&
    typeof airVelocityProvider !== "function"
  ) {
    throw new TypeError("airVelocityProvider must be a function or null.");
  }

  const dt = solver.dt ?? DEFAULT_SIMULATION_OPTIONS.dt;
  const method = solver.method ?? DEFAULT_SIMULATION_OPTIONS.method;
  const maxTime = solver.maxTime ?? DEFAULT_SIMULATION_OPTIONS.maxTime;
  const maxSteps = solver.maxSteps ?? DEFAULT_SIMULATION_OPTIONS.maxSteps;
  const burnoutMassTolerance =
    solver.burnoutMassTolerance ??
    DEFAULT_SIMULATION_OPTIONS.burnoutMassTolerance;
  const eventTimeTolerance =
    solver.eventTimeTolerance ??
    DEFAULT_SIMULATION_OPTIONS.eventTimeTolerance;

  assertPositiveNumber(dt, "solver.dt");
  assertPositiveNumber(maxTime, "solver.maxTime");
  assertPositiveInteger(maxSteps, "solver.maxSteps");
  assertNonNegativeNumber(
    burnoutMassTolerance,
    "solver.burnoutMassTolerance"
  );
  assertPositiveNumber(eventTimeTolerance, "solver.eventTimeTolerance");

  const resolvedAtmosphereOptions =
    atmosphereOptions ?? DEFAULT_SIMULATION_OPTIONS.atmosphereOptions;

  assertObject(resolvedAtmosphereOptions, "atmosphereOptions");

  let state = createInitialSimulationState({
    vehicle,
    launchAltitude: initialConditions.launchAltitude ?? 0,
    position: initialConditions.position ?? null,
    velocity: initialConditions.velocity ?? { x: 0, y: 0 },
  });

  let runtime = createInitialStagingState(vehicle);
  let time = 0;
  let steps = 0;
  let pendingSeparation = null;
  let terminationReason = null;

  const history = [];
  const events = [];
  const warnings = [];

  if (guidance === null && guidanceProvider === null) {
    warnings.push(
      Object.freeze({
        code: "DEFAULT_GUIDANCE",
        message:
          'No guidance was supplied. dynamics.js will use its existing "velocityAligned" default. This is not an orbital-insertion pitch program.',
      })
    );
  }

  const firstStage = getActiveStage(vehicle, runtime);

  resolveStageCdModel({
    stage: firstStage,
    cdModels,
    defaultCdModel,
  });

  const initialEvaluation = evaluateAt({
    time,
    state,
    vehicle,
    runtime,
    cdModels,
    defaultCdModel,
    guidance,
    guidanceProvider,
    propulsion,
    propulsionProvider,
    airVelocity,
    airVelocityProvider,
    atmosphereOptions: resolvedAtmosphereOptions,
  });

  history.push(
    createHistorySample({
      time,
      state,
      vehicle,
      runtime,
      evaluation: initialEvaluation,
    })
  );

  events.push(
    Object.freeze({
      type: "simulationStart",
      time: 0,
      activeStageIndex: runtime.activeStageIndex,
      mass: state.mass,
    })
  );

  if (initialEvaluation.diagnostics.thrustToWeightRatio <= 1) {
    warnings.push(
      Object.freeze({
        code: "INITIAL_TWR_NOT_ABOVE_ONE",
        message:
          "Initial TWR is not above 1. The current model has no launch-pad support force, so the vehicle may descend into the spherical Earth.",
      })
    );
  }

  while (terminationReason === null) {
    if (steps >= maxSteps) {
      terminationReason = "maxSteps";
      break;
    }

    if (time >= maxTime - eventTimeTolerance) {
      terminationReason = "maxTime";
      break;
    }

    if (
      time > 0 &&
      Math.hypot(state.x, state.y) < R_EARTH
    ) {
      terminationReason = "bodyImpact";

      events.push(
        Object.freeze({
          type: "bodyImpact",
          time,
          state: freezeState(state),
        })
      );

      break;
    }

    if (runtime.allStagesComplete) {
      terminationReason = "allStagesComplete";
      break;
    }

    const activeStage = getActiveStage(vehicle, runtime);

    // -----------------------------------------------------------------------
    // A. Burnout has occurred; coast through any configured separation delay.
    // -----------------------------------------------------------------------
    if (pendingSeparation !== null) {
      const remainingDelay = pendingSeparation.separationTime - time;

      if (remainingDelay <= eventTimeTolerance) {
        const separation = separateActiveStage({
          vehicle,
          runtime,
          state,
        });

        state = separation.state;
        runtime = separation.runtime;

        events.push(
          Object.freeze({
            ...separation.event,
            time,
          })
        );

        pendingSeparation = null;
        continue;
      }

      const coastDt = Math.min(dt, remainingDelay, maxTime - time);

      state = integrateContinuousStep({
        time,
        state,
        dt: coastDt,
        method,
        vehicle,
        runtime,
        cdModels,
        defaultCdModel,
        guidance,
        guidanceProvider,
        propulsion,
        propulsionProvider,
        airVelocity,
        airVelocityProvider,
        atmosphereOptions: resolvedAtmosphereOptions,
        forceEngineOff: true,
      });

      time += coastDt;
      steps += 1;

      const evaluation = evaluateAt({
        time,
        state,
        vehicle,
        runtime,
        cdModels,
        defaultCdModel,
        guidance,
        guidanceProvider,
        propulsion,
        propulsionProvider,
        airVelocity,
        airVelocityProvider,
        atmosphereOptions: resolvedAtmosphereOptions,
        forceEngineOff: true,
      });

      history.push(
        createHistorySample({
          time,
          state,
          vehicle,
          runtime,
          evaluation,
        })
      );

      continue;
    }

    // -----------------------------------------------------------------------
    // B. Handle a stage that starts the iteration already burned out.
    // -----------------------------------------------------------------------
    if (isActiveStageBurnedOut(runtime)) {
      events.push(
        Object.freeze({
          type: "stageBurnout",
          time,
          stageIndex: runtime.activeStageIndex,
          stageId: activeStage.id,
        })
      );

      pendingSeparation = Object.freeze({
        stageIndex: runtime.activeStageIndex,
        stageId: activeStage.id,
        burnoutTime: time,
        separationTime: time + activeStage.separationDelay,
      });

      continue;
    }

    // -----------------------------------------------------------------------
    // C. Powered continuous integration.
    // -----------------------------------------------------------------------
    const currentEvaluation = evaluateAt({
      time,
      state,
      vehicle,
      runtime,
      cdModels,
      defaultCdModel,
      guidance,
      guidanceProvider,
      propulsion,
      propulsionProvider,
      airVelocity,
      airVelocityProvider,
      atmosphereOptions: resolvedAtmosphereOptions,
    });

    const currentMassFlowRate =
      currentEvaluation.diagnostics.propulsion.massFlowRate;

    const remainingPropellant =
      getRemainingUsablePropellant(runtime);

    const proposedDt = Math.min(dt, maxTime - time);

    // First event-safe estimate from staging.js.
    const firstSafeDt = getBurnoutSafeStepSize({
      runtime,
      massFlowRate: currentMassFlowRate,
      proposedDt,
    });

    const integrateCandidate = (candidateDt) =>
      integrateContinuousStep({
        time,
        state,
        dt: candidateDt,
        method,
        vehicle,
        runtime,
        cdModels,
        defaultCdModel,
        guidance,
        guidanceProvider,
        propulsion,
        propulsionProvider,
        airVelocity,
        airVelocityProvider,
        atmosphereOptions: resolvedAtmosphereOptions,
      });

    // Verify actual RK-integrated mass loss before accepting the step.
    const poweredStep = findBurnoutSafeIntegratedStep({
      proposedDt: firstSafeDt,
      remainingPropellant,
      burnoutMassTolerance,
      eventTimeTolerance,
      integrateCandidate,
      beforeState: state,
    });

    const effectiveMassFlowRate =
      poweredStep.consumedMass / poweredStep.dt;

    const propellantUpdate = consumeActiveStagePropellant({
      runtime,
      massFlowRate: effectiveMassFlowRate,
      dt: poweredStep.dt,
    });

    state = poweredStep.state;
    runtime = propellantUpdate.runtime;
    time += poweredStep.dt;
    steps += 1;

    const reachedBurnout =
      propellantUpdate.reachedBurnout ||
      isActiveStageBurnedOut(runtime);

    const evaluation = evaluateAt({
      time,
      state,
      vehicle,
      runtime,
      cdModels,
      defaultCdModel,
      guidance,
      guidanceProvider,
      propulsion,
      propulsionProvider,
      airVelocity,
      airVelocityProvider,
      atmosphereOptions: resolvedAtmosphereOptions,
      forceEngineOff: reachedBurnout,
    });

    history.push(
      createHistorySample({
        time,
        state,
        vehicle,
        runtime,
        evaluation,
      })
    );

    if (reachedBurnout) {
      events.push(
        Object.freeze({
          type: "stageBurnout",
          time,
          stageIndex: runtime.activeStageIndex,
          stageId: activeStage.id,
        })
      );

      pendingSeparation = Object.freeze({
        stageIndex: runtime.activeStageIndex,
        stageId: activeStage.id,
        burnoutTime: time,
        separationTime: time + activeStage.separationDelay,
      });
    }
  }

  const orbitReport = createOrbitReport({
    state: {
      x: state.x,
      y: state.y,
      vx: state.vx,
      vy: state.vy,
    },
    target: targetOrbit,
  });

  const maxQ = findMaximumSample(
    history,
    (sample) => sample.diagnostics.aerodynamics.dynamicPressure
  );

  if (maxQ !== null) {
    events.push(
      Object.freeze({
        type: "maxQ",
        time: maxQ.time,
        altitude: maxQ.altitude,
        dynamicPressure: maxQ.value,
        activeStageIndex: maxQ.activeStageIndex,
      })
    );
  }

  events.push(
    Object.freeze({
      type: "simulationEnd",
      time,
      terminationReason,
      finalState: freezeState(state),
    })
  );

  events.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));

  const summary = createSummary({
    vehicle,
    history,
    events,
    finalState: state,
    finalTime: time,
    terminationReason,
    steps,
  });

  return Object.freeze({
    model: "EVENT_AWARE_SERIAL_STAGE_ASCENT",
    finalTime: time,
    finalState: freezeState(state),
    finalStagingState: runtime,
    history: Object.freeze([...history]),
    events: Object.freeze([...events]),
    orbitReport,
    summary,
    warnings: Object.freeze([...warnings]),
  });
}
