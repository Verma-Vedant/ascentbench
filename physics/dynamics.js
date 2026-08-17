/**
 * @file dynamics.js
 * @description Evaluates the continuous 2D launch-vehicle equations of motion.
 * The state is [x, y, vx, vy, mass]; derivatives combine gravity, thrust, drag,
 * and propellant mass flow. Time advancement is handled separately by the
 * numerical integrator.
 */
import {
  altitudeFromPosition,
  gravityVector,
  gravityMagnitudeAtRadius,
  radiusFromPosition,
} from "./gravity.js";

import { getAtmosphere } from "./atmosphere.js";
import { getPropulsionState } from "./propulsion.js";
import { getAerodynamicState } from "./aerodynamics.js";
import { getGuidanceState } from "./guidance.js";

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
    throw new RangeError(`${name} must be greater than 0.`);
  }
}

function assertNonNegativeNumber(value, name) {
  assertFiniteNumber(value, name);
  if (value < 0) {
    throw new RangeError(`${name} cannot be negative.`);
  }
}

function assertVector2(vector, name) {
  assertObject(vector, name);
  assertFiniteNumber(vector.x, `${name}.x`);
  assertFiniteNumber(vector.y, `${name}.y`);
}

function freezeVector(vector) {
  return Object.freeze({
    x: vector.x,
    y: vector.y,
  });
}

/** Validate the translational rocket state. */
export function validateDynamicsState(state) {
  assertObject(state, "state");

  assertFiniteNumber(state.x, "state.x");
  assertFiniteNumber(state.y, "state.y");
  assertFiniteNumber(state.vx, "state.vx");
  assertFiniteNumber(state.vy, "state.vy");
  assertPositiveNumber(state.mass, "state.mass");

  if (state.x === 0 && state.y === 0) {
    throw new RangeError(
      "Rocket state cannot be located at Earth's centre."
    );
  }

  return true;
}

/** Return Earth-centred position vector. */
export function getStatePosition(state) {
  validateDynamicsState(state);
  return freezeVector({ x: state.x, y: state.y });
}

/** Return velocity vector. */
export function getStateVelocity(state) {
  validateDynamicsState(state);
  return freezeVector({ x: state.vx, y: state.vy });
}

/** Convert scalar thrust into a vector: T_vec = T * T_hat */
export function getThrustVector(thrust, thrustDirection) {
  assertNonNegativeNumber(thrust, "thrust");
  assertVector2(thrustDirection, "thrustDirection");

  const magnitude = Math.hypot(
    thrustDirection.x,
    thrustDirection.y
  );

  if (Math.abs(magnitude - 1) > 1e-9) {
    throw new RangeError(
      "thrustDirection must be a unit vector."
    );
  }

  return freezeVector({
    x: thrust * thrustDirection.x,
    y: thrust * thrustDirection.y,
  });
}

/** Convert force to acceleration: a = F / m */
export function forceToAcceleration(force, mass) {
  assertVector2(force, "force");
  assertPositiveNumber(mass, "mass");

  return freezeVector({
    x: force.x / mass,
    y: force.y / mass,
  });
}

/** Sum any number of 2D vectors. */
export function sumVectors(...vectors) {
  let x = 0;
  let y = 0;

  for (let i = 0; i < vectors.length; i += 1) {
    assertVector2(vectors[i], `vectors[${i}]`);
    x += vectors[i].x;
    y += vectors[i].y;
  }

  return freezeVector({ x, y });
}

/** Local thrust-to-weight ratio: TWR = T / (m*g_local) */
export function getThrustToWeightRatio({
  thrust,
  mass,
  localGravity,
}) {
  assertNonNegativeNumber(thrust, "thrust");
  assertPositiveNumber(mass, "mass");
  assertPositiveNumber(localGravity, "localGravity");

  return thrust / (mass * localGravity);
}

/**
 * Main continuous dynamics evaluation.
 *
 * INPUT:
 * - state: {x, y, vx, vy, mass}
 * - stage: active stage definition
 * - cdModel: current Mach-Cd model
 * - guidance: abstract guidance config
 * - propulsion: {engineOn, throttle}
 * - airVelocity: local air velocity vector
 *
 * OUTPUT:
 * - derivatives: what RK4 needs
 * - diagnostics: what telemetry/debugging needs
 */
export function evaluateDynamics({
  time = 0,
  state,
  stage,
  cdModel,
  guidance = {},
  propulsion = {},
  airVelocity = { x: 0, y: 0 },
  atmosphereOptions = {},
}) {
  assertNonNegativeNumber(time, "time");
  validateDynamicsState(state);

  assertObject(stage, "stage");
  assertObject(stage.aerodynamics, "stage.aerodynamics");
  assertPositiveNumber(
    stage.aerodynamics.referenceArea,
    "stage.aerodynamics.referenceArea"
  );

  assertVector2(airVelocity, "airVelocity");
  assertObject(guidance, "guidance");
  assertObject(propulsion, "propulsion");
  assertObject(atmosphereOptions, "atmosphereOptions");

  // A. State geometry
  const position = getStatePosition(state);
  const velocity = getStateVelocity(state);

  const radius = radiusFromPosition(position);
  const altitude = altitudeFromPosition(position);

  const speed = Math.hypot(
    velocity.x,
    velocity.y
  );

  // B. Gravity
  const gravityAcceleration = gravityVector(position);
  const localGravity = gravityMagnitudeAtRadius(radius);

  // C. Atmosphere
  const atmosphere = getAtmosphere(
    altitude,
    atmosphereOptions
  );

  // D. Guidance
  const guidanceState = getGuidanceState({
    position,
    velocity,
    mode: guidance.mode ?? "velocityAligned",
    blendFactor: guidance.blendFactor ?? 0,
    progradeSign: guidance.progradeSign ?? 1,
  });

  // E. Propulsion
  const propulsionState = getPropulsionState(
    stage,
    atmosphere.pressure,
    {
      throttle: propulsion.throttle ?? 1,
      engineOn: propulsion.engineOn ?? true,
    }
  );

  const thrustVector = getThrustVector(
    propulsionState.thrust,
    guidanceState.thrustDirection
  );

  const thrustAcceleration = forceToAcceleration(
    thrustVector,
    state.mass
  );

  // F. Aerodynamics
  const aerodynamicState = getAerodynamicState({
    vehicleVelocity: velocity,
    atmosphere,
    referenceArea: stage.aerodynamics.referenceArea,
    cdModel,
    airVelocity,
  });

  const dragAcceleration = forceToAcceleration(
    aerodynamicState.dragVector,
    state.mass
  );

  // G. Total acceleration
  const totalAcceleration = sumVectors(
    gravityAcceleration,
    thrustAcceleration,
    dragAcceleration
  );

  const accelerationMagnitude = Math.hypot(
    totalAcceleration.x,
    totalAcceleration.y
  );

  // H. Mass derivative: dm/dt = -mdot
  const massDerivative = -propulsionState.massFlowRate;

  // I. State derivative
  const derivatives = Object.freeze({
    dxdt: state.vx,
    dydt: state.vy,
    dvxdt: totalAcceleration.x,
    dvydt: totalAcceleration.y,
    dmdt: massDerivative,
  });

  // J. Diagnostics
  const thrustToWeightRatio = getThrustToWeightRatio({
    thrust: propulsionState.thrust,
    mass: state.mass,
    localGravity,
  });

  const diagnostics = Object.freeze({
    time,
    radius,
    altitude,
    speed,
    mass: state.mass,
    position,
    velocity,
    localGravity,
    gravityAcceleration,
    atmosphere,
    guidance: guidanceState,
    propulsion: propulsionState,
    aerodynamics: aerodynamicState,
    thrustVector,
    thrustAcceleration,
    dragAcceleration,
    totalAcceleration,
    accelerationMagnitude,
    thrustToWeightRatio,
  });

  return Object.freeze({
    derivatives,
    diagnostics,
  });
}

/** Convenience wrapper for numerical integrators: f(t,state) -> derivatives */
export function getStateDerivatives(config) {
  return evaluateDynamics(config).derivatives;
}
