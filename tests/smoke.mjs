/**
 * @file smoke.mjs
 * @description Fast regression checks for key AscentBench module interfaces and
 * end-to-end simulation behavior. Intended to catch obvious integration failures
 * before deeper validation scripts are run.
 */

import assert from "node:assert/strict";

import {
  MU_EARTH,
  P0,
  R_EARTH,
  T0,
} from "../physics/constants.js";

import {
  gravityVector,
  circularOrbitSpeedAtAltitude,
} from "../physics/gravity.js";

import {
  getAtmosphere,
  getStandardAtmosphere,
} from "../physics/atmosphere.js";

import {
  createStage,
} from "../physics/vehicle-model.js";

import {
  getAmbientThrust,
} from "../physics/propulsion.js";

import {
  rk4Step,
} from "../physics/integrator.js";

import {
  createOrbitReport,
} from "../physics/orbit.js";

import {
  prepareSimulationInput,
} from "../analyzer/input-adapter.js";

import {
  runSimulation,
} from "../analyzer/simulation.js";

import {
  prepareSimulationResult,
} from "../analyzer/result-adapter.js";

function approximatelyEqual(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} ± ${tolerance}, received ${actual}`
  );
}

function createExampleRawInput(recordEveryNSteps = 1) {
  return {
    vehicle: {
      name: "Example Two-Stage Vehicle",
      payloadMass: { value: 5000, unit: "kg" },
      stages: [
        {
          name: "Stage 1",
          dryMass: 25_000,
          propellantMass: 400_000,
          residualPropellantMass: 0,
          thrustSeaLevel: { value: 7_600, unit: "kN" },
          thrustVacuum: { value: 8_200, unit: "kN" },
          ispSeaLevel: 282,
          ispVacuum: 311,
          diameter: { value: 3.7, unit: "m" },
          cdModelId: "default-cd",
          separationDelay: { value: 2, unit: "s" },
        },
        {
          name: "Stage 2",
          dryMass: 4_000,
          propellantMass: 60_000,
          residualPropellantMass: 0,
          thrustSeaLevel: { value: 900, unit: "kN" },
          thrustVacuum: { value: 1_000, unit: "kN" },
          ispSeaLevel: 320,
          ispVacuum: 348,
          diameter: { value: 3.7, unit: "m" },
          cdModelId: "default-cd",
          separationDelay: { value: 0, unit: "s" },
        },
      ],
    },
    aerodynamics: {
      models: [
        {
          id: "default-cd",
          name: "Analyzer Cd model",
          points: [
            { mach: 0.0, cd: 0.25 },
            { mach: 0.8, cd: 0.28 },
            { mach: 1.0, cd: 0.50 },
            { mach: 1.2, cd: 0.42 },
            { mach: 2.0, cd: 0.30 },
            { mach: 5.0, cd: 0.25 },
            { mach: 10.0, cd: 0.22 },
          ],
          outsideRange: "clamp",
          provenance: {
            origin: "assumed",
            note: "Smoke-test copy of the Analyzer default Cd table.",
          },
        },
      ],
    },
    guidance: {
      type: "genericAssumed",
      progradeSign: 1,
    },
    initialConditions: {
      launchAltitude: { value: 0, unit: "m" },
      velocityX: 0,
      velocityY: { value: 0, unit: "m/s" },
    },
    mission: {
      targetPeriapsisAltitude: { value: 200, unit: "km" },
      targetApoapsisAltitude: { value: 200, unit: "km" },
      altitudeTolerance: { value: 20, unit: "km" },
    },
    solver: {
      method: "rk4",
      dt: { value: 0.2, unit: "s" },
      maxTime: { value: 900, unit: "s" },
      recordEveryNSteps,
    },
    propulsion: {
      engineOn: true,
      throttle: 1,
    },
    air: {
      velocityX: { value: 0, unit: "m/s" },
      velocityY: { value: 0, unit: "m/s" },
    },
    atmosphere: {
      aboveModel: "vacuum",
    },
  };
}

// Atmosphere anchors and explicit upper-model behavior.
{
  const seaLevel = getStandardAtmosphere(0);
  approximatelyEqual(seaLevel.temperature, T0, 1e-12, "sea-level temperature");
  approximatelyEqual(seaLevel.pressure, P0, 1e-9, "sea-level pressure");
  approximatelyEqual(seaLevel.density, 1.225, 5e-4, "sea-level density");

  const upper = getAtmosphere(86_001);
  assert.equal(upper.isVacuumApproximation, true);
  assert.equal(upper.pressure, 0);
  assert.equal(upper.density, 0);
  assert.equal(upper.speedOfSound, null);
}

// Propulsion interpolation must reproduce its two supplied thrust anchors.
{
  const stage = createStage({
    id: "test-stage",
    name: "Test stage",
    masses: {
      dryMass: 10_000,
      propellantMass: 100_000,
      residualPropellantMass: 0,
    },
    propulsion: {
      thrustSeaLevel: 1_000_000,
      thrustVacuum: 1_100_000,
      ispSeaLevel: 280,
      ispVacuum: 310,
    },
    aerodynamics: {
      referenceArea: 10,
      cdModelId: null,
    },
  });

  approximatelyEqual(getAmbientThrust(stage, P0), 1_000_000, 1e-9, "sea-level thrust anchor");
  approximatelyEqual(getAmbientThrust(stage, 0), 1_100_000, 1e-9, "vacuum thrust anchor");
}

// Circular 200 km reference orbit.
{
  const altitude = 200_000;
  const radius = R_EARTH + altitude;
  const circularSpeed = circularOrbitSpeedAtAltitude(altitude);
  const expectedPeriod = 2 * Math.PI * Math.sqrt((radius ** 3) / MU_EARTH);

  approximatelyEqual(circularSpeed, 7_788.49, 1, "200 km circular speed");
  approximatelyEqual(expectedPeriod, 5_301.0, 2, "200 km orbital period");

  const report = createOrbitReport({
    state: {
      x: radius,
      y: 0,
      vx: 0,
      vy: circularSpeed,
    },
  });

  assert.equal(report.basicClassification, "BOUND_ORBIT");
  approximatelyEqual(report.orbit.periapsisAltitude, altitude, 1e-3, "circular periapsis");
  approximatelyEqual(report.orbit.apoapsisAltitude, altitude, 1e-3, "circular apoapsis");
}

// RK4 vacuum two-body energy conservation over 100 steps.
{
  const radius = R_EARTH + 200_000;
  const speed = Math.sqrt(MU_EARTH / radius);
  let time = 0;
  let state = {
    x: radius,
    y: 0,
    vx: 0,
    vy: speed,
    mass: 1,
  };

  const specificEnergy = (sample) =>
    0.5 * (sample.vx ** 2 + sample.vy ** 2) -
    MU_EARTH / Math.hypot(sample.x, sample.y);

  const initialEnergy = specificEnergy(state);

  for (let index = 0; index < 100; index += 1) {
    state = rk4Step({
      derivativeFunction: (_t, sample) => {
        const acceleration = gravityVector({ x: sample.x, y: sample.y });
        return {
          dxdt: sample.vx,
          dydt: sample.vy,
          dvxdt: acceleration.x,
          dvydt: acceleration.y,
          dmdt: 0,
        };
      },
      time,
      state,
      dt: 10,
    });
    time += 10;
  }

  const finalEnergy = specificEnergy(state);
  const relativeDrift = Math.abs((finalEnergy - initialEnergy) / initialEnergy);
  assert.ok(relativeDrift < 1e-4, `RK4 energy drift too large: ${relativeDrift}`);
}

// Full Analyzer pipeline, including result sampling and terminal separation mass.
{
  const prepared = prepareSimulationInput(createExampleRawInput(10));
  assert.equal(prepared.simulationConfig.vehicle.id, "example-two-stage-vehicle");

  const simulation = runSimulation(prepared.simulationConfig);
  assert.equal(simulation.summary.terminationReason, "allStagesComplete");
  assert.ok(simulation.history.length > 100);
  assert.ok(Number.isFinite(simulation.finalState.mass));

  const result = prepareSimulationResult({
    simulationResult: simulation,
    simulationConfig: prepared.simulationConfig,
    inputMetadata: prepared.metadata,
  });

  assert.ok(result.trajectory.downrangeAltitude.length < simulation.history.length);
  assert.equal(
    result.charts.mass.points.at(-1).y,
    simulation.finalState.mass,
    "mass chart must include terminal stage-separation mass"
  );
  assert.ok(result.events.some((event) => event.type === "maxQ"));
}

console.log("LVA smoke tests: PASS");
