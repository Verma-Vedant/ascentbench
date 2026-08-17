/**
 * @file vehicle-model.js
 * @description Canonical validated vehicle and stage data structures for
 * AscentBench. Centralizes mass, propulsion, geometry, provenance, and serial-stage
 * configuration so downstream physics modules receive consistent SI-domain data.
 */
export const VALUE_ORIGIN = Object.freeze({
  PUBLISHED: "published",
  DERIVED: "derived",
  ESTIMATED: "estimated",
  ASSUMED: "assumed",
});

export const DATA_CONFIDENCE = Object.freeze({
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
});

function assertObject(value, name) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${name} must be an object.`);
  }
}

function assertNonEmptyString(value, name) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new TypeError(`${name} must be a non-empty string.`);
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

function assertNullablePositiveNumber(value, name) {
  if (value === null || value === undefined) {
    return;
  }

  assertPositiveNumber(value, name);
}

function deepFreeze(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  Object.freeze(value);

  for (const child of Object.values(value)) {
    deepFreeze(child);
  }

  return value;
}

export function createProvenance({
  origin,
  source = null,
  confidence = null,
  note = null,
} = {}) {
  if (!Object.values(VALUE_ORIGIN).includes(origin)) {
    throw new RangeError(
      `origin must be one of: ${Object.values(VALUE_ORIGIN).join(", ")}`
    );
  }

  if (source !== null && typeof source !== "string") {
    throw new TypeError("source must be a string or null.");
  }

  if (
    confidence !== null &&
    !Object.values(DATA_CONFIDENCE).includes(confidence)
  ) {
    throw new RangeError(
      `confidence must be one of: ${Object.values(DATA_CONFIDENCE).join(", ")}`
    );
  }

  if (note !== null && typeof note !== "string") {
    throw new TypeError("note must be a string or null.");
  }

  return deepFreeze({
    origin,
    source,
    confidence,
    note,
  });
}

export function createStage({
  id,
  name,
  masses,
  propulsion,
  aerodynamics,
  nominalBurnTime = null,
  separationDelay = 0,
  provenance = {},
}) {
  assertNonEmptyString(id, "stage.id");
  assertNonEmptyString(name, "stage.name");

  assertObject(masses, "stage.masses");
  assertObject(propulsion, "stage.propulsion");
  assertObject(aerodynamics, "stage.aerodynamics");

  assertPositiveNumber(
    masses.dryMass,
    "stage.masses.dryMass"
  );

  assertPositiveNumber(
    masses.propellantMass,
    "stage.masses.propellantMass"
  );

  const residualPropellantMass =
    masses.residualPropellantMass ?? 0;

  assertNonNegativeNumber(
    residualPropellantMass,
    "stage.masses.residualPropellantMass"
  );

  if (
    residualPropellantMass >
    masses.propellantMass
  ) {
    throw new RangeError(
      "stage.masses.residualPropellantMass cannot exceed propellantMass."
    );
  }

  assertPositiveNumber(
    propulsion.thrustSeaLevel,
    "stage.propulsion.thrustSeaLevel"
  );

  assertPositiveNumber(
    propulsion.thrustVacuum,
    "stage.propulsion.thrustVacuum"
  );

  assertPositiveNumber(
    propulsion.ispSeaLevel,
    "stage.propulsion.ispSeaLevel"
  );

  assertPositiveNumber(
    propulsion.ispVacuum,
    "stage.propulsion.ispVacuum"
  );

  if (
    propulsion.thrustVacuum <
    propulsion.thrustSeaLevel
  ) {
    throw new RangeError(
      "stage.propulsion.thrustVacuum should not be less than thrustSeaLevel."
    );
  }

  if (
    propulsion.ispVacuum <
    propulsion.ispSeaLevel
  ) {
    throw new RangeError(
      "stage.propulsion.ispVacuum should not be less than ispSeaLevel."
    );
  }

  assertPositiveNumber(
    aerodynamics.referenceArea,
    "stage.aerodynamics.referenceArea"
  );

  const cdModelId =
    aerodynamics.cdModelId ?? null;

  if (
    cdModelId !== null &&
    typeof cdModelId !== "string"
  ) {
    throw new TypeError(
      "stage.aerodynamics.cdModelId must be a string or null."
    );
  }

  assertNullablePositiveNumber(
    nominalBurnTime,
    "stage.nominalBurnTime"
  );

  assertNonNegativeNumber(
    separationDelay,
    "stage.separationDelay"
  );

  assertObject(provenance, "stage.provenance");

  return deepFreeze({
    id: id.trim(),
    name: name.trim(),

    masses: {
      dryMass: masses.dryMass,
      propellantMass: masses.propellantMass,
      residualPropellantMass,
    },

    propulsion: {
      thrustSeaLevel:
        propulsion.thrustSeaLevel,
      thrustVacuum:
        propulsion.thrustVacuum,
      ispSeaLevel:
        propulsion.ispSeaLevel,
      ispVacuum:
        propulsion.ispVacuum,
    },

    aerodynamics: {
      referenceArea:
        aerodynamics.referenceArea,
      cdModelId,
    },

    nominalBurnTime,
    separationDelay,

    provenance: { ...provenance },
  });
}

export function createVehicle({
  id,
  name,
  payloadMass,
  stages,
  initialAttachedHardwareMass = 0,
  provenance = {},
}) {
  assertNonEmptyString(id, "vehicle.id");
  assertNonEmptyString(name, "vehicle.name");

  assertNonNegativeNumber(
    payloadMass,
    "vehicle.payloadMass"
  );

  assertNonNegativeNumber(
    initialAttachedHardwareMass,
    "vehicle.initialAttachedHardwareMass"
  );

  if (!Array.isArray(stages)) {
    throw new TypeError("vehicle.stages must be an array.");
  }

  if (stages.length < 1 || stages.length > 3) {
    throw new RangeError(
      "vehicle.stages must contain between 1 and 3 serial stages."
    );
  }

  const stageIds = new Set();

  for (const [index, stage] of stages.entries()) {
    assertObject(
      stage,
      `vehicle.stages[${index}]`
    );

    assertNonEmptyString(
      stage.id,
      `vehicle.stages[${index}].id`
    );

    if (stageIds.has(stage.id)) {
      throw new RangeError(
        `Duplicate stage id "${stage.id}" in vehicle.`
      );
    }

    stageIds.add(stage.id);
  }

  assertObject(provenance, "vehicle.provenance");

  return deepFreeze({
    id: id.trim(),
    name: name.trim(),
    payloadMass,
    initialAttachedHardwareMass,
    stages: [...stages],
    provenance: { ...provenance },
  });
}

export function getStageWetMass(stage) {
  assertObject(stage, "stage");

  return (
    stage.masses.dryMass +
    stage.masses.propellantMass
  );
}

export function getStageUsablePropellantMass(stage) {
  assertObject(stage, "stage");

  return (
    stage.masses.propellantMass -
    stage.masses.residualPropellantMass
  );
}

export function getStageBurnoutOwnMass(stage) {
  assertObject(stage, "stage");

  return (
    stage.masses.dryMass +
    stage.masses.residualPropellantMass
  );
}

export function getVehicleInitialMass(vehicle) {
  assertObject(vehicle, "vehicle");

  const stageMass =
    vehicle.stages.reduce(
      (sum, stage) =>
        sum + getStageWetMass(stage),
      0
    );

  return (
    vehicle.payloadMass +
    vehicle.initialAttachedHardwareMass +
    stageMass
  );
}

export function getSerialStackMassFromStage(
  vehicle,
  stageIndex,
  extraAttachedMass = 0
) {
  assertObject(vehicle, "vehicle");

  if (
    !Number.isInteger(stageIndex) ||
    stageIndex < 0 ||
    stageIndex >= vehicle.stages.length
  ) {
    throw new RangeError(
      "stageIndex must refer to an existing vehicle stage."
    );
  }

  assertNonNegativeNumber(
    extraAttachedMass,
    "extraAttachedMass"
  );

  let mass =
    vehicle.payloadMass +
    extraAttachedMass;

  for (
    let i = stageIndex;
    i < vehicle.stages.length;
    i += 1
  ) {
    mass +=
      getStageWetMass(
        vehicle.stages[i]
      );
  }

  return mass;
}

export function getStackBurnoutMassBeforeSeparation(
  vehicle,
  stageIndex,
  extraAttachedMass = 0
) {
  assertObject(vehicle, "vehicle");

  if (
    !Number.isInteger(stageIndex) ||
    stageIndex < 0 ||
    stageIndex >= vehicle.stages.length
  ) {
    throw new RangeError(
      "stageIndex must refer to an existing vehicle stage."
    );
  }

  assertNonNegativeNumber(
    extraAttachedMass,
    "extraAttachedMass"
  );

  const activeStage =
    vehicle.stages[stageIndex];

  let mass =
    vehicle.payloadMass +
    extraAttachedMass +
    getStageBurnoutOwnMass(activeStage);

  for (
    let i = stageIndex + 1;
    i < vehicle.stages.length;
    i += 1
  ) {
    mass +=
      getStageWetMass(
        vehicle.stages[i]
      );
  }

  return mass;
}

export function createBlankStageTemplate() {
  return {
    id: "",
    name: "",

    masses: {
      dryMass: null,
      propellantMass: null,
      residualPropellantMass: 0,
    },

    propulsion: {
      thrustSeaLevel: null,
      thrustVacuum: null,
      ispSeaLevel: null,
      ispVacuum: null,
    },

    aerodynamics: {
      referenceArea: null,
      cdModelId: null,
    },

    nominalBurnTime: null,
    separationDelay: 0,

    provenance: {},
  };
}

export function createBlankVehicleTemplate() {
  return {
    id: "",
    name: "",

    payloadMass: 0,

    initialAttachedHardwareMass: 0,

    stages: [],

    provenance: {},
  };
}
