/**
 * @file analyzer.js
 * @description Browser controller for the AscentBench analyzer interface.
 * Collects UI input, invokes the simulation pipeline, and renders engineering
 * results without implementing physics directly.
 */

import {
  prepareSimulationInput,
  normalizeInputError,
} from "./input-adapter.js";

import {
  runSimulation,
} from "./simulation.js";

import {
  prepareSimulationResult,
  formatEngineeringValue,
} from "./result-adapter.js";


// =============================================================================
// 1. EXAMPLE DATA
// =============================================================================

const EXAMPLE_STAGES = [
  {
    name: "Stage 1",
    dryMass: 25_000,
    propellantMass: 400_000,
    residualPropellantMass: 0,
    thrustSeaLevel: 7_600,
    thrustVacuum: 8_200,
    ispSeaLevel: 282,
    ispVacuum: 311,
    diameter: 3.7,
    separationDelay: 2,
  },
  {
    name: "Stage 2",
    dryMass: 4_000,
    propellantMass: 60_000,
    residualPropellantMass: 0,
    thrustSeaLevel: 900,
    thrustVacuum: 1_000,
    ispSeaLevel: 320,
    ispVacuum: 348,
    diameter: 3.7,
    separationDelay: 0,
  },
  {
    name: "Stage 3",
    dryMass: 1_200,
    propellantMass: 14_000,
    residualPropellantMass: 0,
    thrustSeaLevel: 180,
    thrustVacuum: 230,
    ispSeaLevel: 320,
    ispVacuum: 355,
    diameter: 2.4,
    separationDelay: 0,
  },
];

const EXAMPLE_CD_POINTS = [
  [0.0, 0.25],
  [0.8, 0.28],
  [1.0, 0.50],
  [1.2, 0.42],
  [2.0, 0.30],
  [5.0, 0.25],
  [10.0, 0.22],
];

const EXAMPLE_GUIDANCE_POINTS = [
  [0, 90],
  [1, 90],
  [20, 65],
  [60, 30],
  [120, 0],
];


// =============================================================================
// 2. DOM
// =============================================================================

const form = document.querySelector("#analyzer-form");
const stageCount = document.querySelector("#stage-count");
const stagesContainer = document.querySelector("#stages-container");
const stageTemplate = document.querySelector("#stage-template");
const tableRowTemplate = document.querySelector("#table-row-template");

const cdTableBody = document.querySelector("#cd-table-body");
const guidanceTableBody = document.querySelector("#guidance-table-body");

const guidanceType = document.querySelector("#guidance-type");
const guidanceCoordinate = document.querySelector("#guidance-coordinate");
const customGuidance = document.querySelector("#custom-guidance");
const genericGuidanceNote = document.querySelector("#generic-guidance-note");
const guidanceCoordinateLabel = document.querySelector("#guidance-coordinate-label");

const runButton = document.querySelector("#run-simulation");
const runStatus = document.querySelector("#run-status");
const errorSummary = document.querySelector("#error-summary");
const errorMessage = document.querySelector("#error-message");

const trajectorySvg = document.querySelector("#trajectory-svg");
const trajectoryEmpty = document.querySelector("#trajectory-empty");

const metricGrid = document.querySelector("#metric-grid");
const resultClassification = document.querySelector("#result-classification");
const resultStatusDetail = document.querySelector("#result-status-detail");

const chartSvg = document.querySelector("#chart-svg");
const chartTitle = document.querySelector("#chart-title");
const chartUnit = document.querySelector("#chart-unit");
const chartToolbar = document.querySelector("#chart-toolbar");

const stageResultsBody = document.querySelector("#stage-results-body");
const orbitClassification = document.querySelector("#orbit-classification");
const orbitTargetResult = document.querySelector("#orbit-target-result");
const orbitGrid = document.querySelector("#orbit-grid");

const eventList = document.querySelector("#event-list");
const warningList = document.querySelector("#warning-list");
const exportButton = document.querySelector("#export-result");

const headline = {
  status: document.querySelector("#headline-status"),
  altitude: document.querySelector("#headline-altitude"),
  speed: document.querySelector("#headline-speed"),
  q: document.querySelector("#headline-q"),
  mass: document.querySelector("#headline-mass"),
};

let currentResult = null;
let activeChart = "altitude";


// =============================================================================
// 3. FORM BUILDERS
// =============================================================================

function stageField(stageElement, key) {
  return stageElement.querySelector(`[data-field="${key}"]`);
}

function captureStageEditorValues() {
  return [...stagesContainer.querySelectorAll("[data-stage]")].map(
    (stage, index) => ({
      name: stageField(stage, "name").value.trim() || `Stage ${index + 1}`,
      dryMass: stageField(stage, "dryMass").value,
      propellantMass: stageField(stage, "propellantMass").value,
      residualPropellantMass: stageField(stage, "residualPropellantMass").value,
      thrustSeaLevel: stageField(stage, "thrustSeaLevel").value,
      thrustVacuum: stageField(stage, "thrustVacuum").value,
      ispSeaLevel: stageField(stage, "ispSeaLevel").value,
      ispVacuum: stageField(stage, "ispVacuum").value,
      diameter: stageField(stage, "diameter").value,
      separationDelay: stageField(stage, "separationDelay").value,
    })
  );
}


function renderStages(count, values = EXAMPLE_STAGES) {
  stagesContainer.replaceChildren();

  for (let index = 0; index < count; index += 1) {
    const node = stageTemplate.content.cloneNode(true);
    const stage = node.querySelector("[data-stage]");
    const data = values[index] ?? EXAMPLE_STAGES[index];

    stage.dataset.stageIndex = String(index);
    stage.querySelector("[data-stage-code]").textContent = `STAGE ${index + 1}`;
    stage.querySelector("[data-stage-title]").textContent = data?.name ?? `Stage ${index + 1}`;

    const idPrefix = `stage-${index + 1}`;

    for (const input of stage.querySelectorAll("input")) {
      const key = input.dataset.field;
      input.id = `${idPrefix}-${key}`;
      const label = input.closest("label");
      if (label) label.htmlFor = input.id;
      if (data && key in data) input.value = data[key];
    }

    stagesContainer.append(node);
  }
}


function addNumericTableRow({
  body,
  x,
  y,
  xLabel,
  yLabel,
}) {
  const node = tableRowTemplate.content.cloneNode(true);
  const row = node.querySelector("tr");
  const xInput = row.querySelector('[data-column="x"]');
  const yInput = row.querySelector('[data-column="y"]');

  xInput.value = x;
  yInput.value = y;
  xInput.setAttribute("aria-label", xLabel);
  yInput.setAttribute("aria-label", yLabel);

  row.querySelector(".remove-row").addEventListener("click", () => {
    if (body.children.length <= 2) return;
    row.remove();
  });

  body.append(row);
}


function renderCdPoints(points = EXAMPLE_CD_POINTS) {
  cdTableBody.replaceChildren();

  for (const [mach, cd] of points) {
    addNumericTableRow({
      body: cdTableBody,
      x: mach,
      y: cd,
      xLabel: "Mach number",
      yLabel: "Drag coefficient",
    });
  }
}


function renderGuidancePoints(points = EXAMPLE_GUIDANCE_POINTS) {
  guidanceTableBody.replaceChildren();

  for (const [coordinate, pitch] of points) {
    addNumericTableRow({
      body: guidanceTableBody,
      x: coordinate,
      y: pitch,
      xLabel: "Guidance schedule coordinate",
      yLabel: "Pitch angle in degrees",
    });
  }
}


function updateGuidanceVisibility() {
  const custom = guidanceType.value === "pitchProgram";
  customGuidance.hidden = !custom;
  genericGuidanceNote.hidden = custom;
}


function updateGuidanceCoordinateLabel() {
  guidanceCoordinateLabel.textContent =
    guidanceCoordinate.value === "altitude"
      ? "Altitude (km)"
      : "Time (s)";
}


function loadExample() {
  document.querySelector("#vehicle-name").value = "Example Two-Stage Vehicle";
  document.querySelector("#payload-mass").value = "5000";
  stageCount.value = "2";
  renderStages(2);
  renderCdPoints();

  guidanceType.value = "genericAssumed";
  guidanceCoordinate.value = "altitude";
  document.querySelector("#guidance-interpolation").value = "smoothstep";
  renderGuidancePoints();
  updateGuidanceVisibility();
  updateGuidanceCoordinateLabel();

  document.querySelector("#launch-altitude").value = "0";
  document.querySelector("#initial-vy").value = "0";
  document.querySelector("#target-periapsis").value = "200";
  document.querySelector("#target-apoapsis").value = "200";
  document.querySelector("#target-tolerance").value = "20";
  document.querySelector("#solver-dt").value = "0.2";
  document.querySelector("#solver-max-time").value = "900";
  document.querySelector("#solver-record-every").value = "1";
  document.querySelector("#air-vx").value = "0";
  document.querySelector("#air-vy").value = "0";
  document.querySelector("#above-atmosphere").value = "vacuum";

  hideError();
}


// =============================================================================
// 4. RAW INPUT COLLECTION
// =============================================================================

function numberValue(selector) {
  const element = typeof selector === "string"
    ? document.querySelector(selector)
    : selector;

  return element.value.trim();
}


function collectStages() {
  return [...stagesContainer.querySelectorAll("[data-stage]")].map(
    (stage, index) => ({
      name: stageField(stage, "name").value.trim() || `Stage ${index + 1}`,
      dryMass: numberValue(stageField(stage, "dryMass")),
      propellantMass: numberValue(stageField(stage, "propellantMass")),
      residualPropellantMass: numberValue(stageField(stage, "residualPropellantMass")),
      thrustSeaLevel: {
        value: numberValue(stageField(stage, "thrustSeaLevel")),
        unit: "kN",
      },
      thrustVacuum: {
        value: numberValue(stageField(stage, "thrustVacuum")),
        unit: "kN",
      },
      ispSeaLevel: numberValue(stageField(stage, "ispSeaLevel")),
      ispVacuum: numberValue(stageField(stage, "ispVacuum")),
      diameter: {
        value: numberValue(stageField(stage, "diameter")),
        unit: "m",
      },
      cdModelId: "default-cd",
      separationDelay: {
        value: numberValue(stageField(stage, "separationDelay")),
        unit: "s",
      },
    })
  );
}


function collectCdPoints() {
  return [...cdTableBody.querySelectorAll("tr")].map((row) => ({
    mach: numberValue(row.querySelector('[data-column="x"]')),
    cd: numberValue(row.querySelector('[data-column="y"]')),
  }));
}


function collectGuidance() {
  if (guidanceType.value === "genericAssumed") {
    return {
      type: "genericAssumed",
      progradeSign: 1,
    };
  }

  const coordinate = guidanceCoordinate.value;

  const points = [...guidanceTableBody.querySelectorAll("tr")].map((row) => {
    let value = Number(numberValue(row.querySelector('[data-column="x"]')));

    if (coordinate === "altitude") {
      value *= 1000;
    }

    return {
      value,
      pitchDegrees: numberValue(row.querySelector('[data-column="y"]')),
    };
  });

  return {
    type: "pitchProgram",
    coordinate,
    interpolation: document.querySelector("#guidance-interpolation").value,
    progradeSign: 1,
    points,
  };
}


function collectMission() {
  const periapsis = numberValue("#target-periapsis");
  const apoapsis = numberValue("#target-apoapsis");
  const tolerance = numberValue("#target-tolerance");

  if (periapsis === "" && apoapsis === "") return {};

  return {
    targetPeriapsisAltitude: { value: periapsis, unit: "km" },
    targetApoapsisAltitude: { value: apoapsis, unit: "km" },
    altitudeTolerance: { value: tolerance || 10, unit: "km" },
  };
}


function collectRawInput() {
  return {
    vehicle: {
      name: document.querySelector("#vehicle-name").value.trim(),
      payloadMass: {
        value: numberValue("#payload-mass"),
        unit: "kg",
      },
      stages: collectStages(),
    },

    aerodynamics: {
      models: [{
        id: "default-cd",
        name: "Analyzer Cd model",
        points: collectCdPoints(),
        outsideRange: "clamp",
        provenance: {
          origin: "assumed",
          note: "User-editable Analyzer Mach-Cd table.",
        },
      }],
    },

    guidance: collectGuidance(),

    initialConditions: {
      launchAltitude: {
        value: numberValue("#launch-altitude"),
        unit: "m",
      },
      velocityX: 0,
      velocityY: {
        value: numberValue("#initial-vy"),
        unit: "m/s",
      },
    },

    mission: collectMission(),

    solver: {
      method: "rk4",
      dt: {
        value: numberValue("#solver-dt"),
        unit: "s",
      },
      maxTime: {
        value: numberValue("#solver-max-time"),
        unit: "s",
      },
      recordEveryNSteps: numberValue("#solver-record-every"),
    },

    propulsion: {
      engineOn: true,
      throttle: 1,
    },

    air: {
      velocityX: {
        value: numberValue("#air-vx"),
        unit: "m/s",
      },
      velocityY: {
        value: numberValue("#air-vy"),
        unit: "m/s",
      },
    },

    atmosphere: {
      aboveModel: document.querySelector("#above-atmosphere").value,
    },
  };
}


// =============================================================================
// 5. STATUS / ERRORS
// =============================================================================

function setRunStatus(state, label) {
  const dot = runStatus.querySelector(".status-dot");
  dot.className = `status-dot ${state}`;
  runStatus.querySelector("strong").textContent = label;
}


function showError(error) {
  const normalized = normalizeInputError(error);
  errorMessage.textContent = normalized.message;
  errorSummary.hidden = false;
  errorSummary.focus();
  setRunStatus("error", "Error");
}


function hideError() {
  errorSummary.hidden = true;
  errorMessage.textContent = "";
}


// =============================================================================
// 6. SVG PLOTTING HELPERS
// =============================================================================

const SVG_NS = "http://www.w3.org/2000/svg";

function svgElement(name, attributes = {}, text = null) {
  const el = document.createElementNS(SVG_NS, name);

  for (const [key, value] of Object.entries(attributes)) {
    el.setAttribute(key, String(value));
  }

  if (text !== null) el.textContent = text;
  return el;
}


function extent(values) {
  let min = Infinity;
  let max = -Infinity;

  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [0, 1];
  }

  if (min === max) {
    const pad = Math.abs(min) > 1e-9 ? Math.abs(min) * 0.1 : 1;
    return [min - pad, max + pad];
  }

  return [min, max];
}


function paddedExtent(values, fraction = 0.08, includeZero = false) {
  let [min, max] = extent(values);

  if (includeZero) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }

  const span = max - min || 1;
  return [min - span * fraction, max + span * fraction];
}


function scaleLinear(domainMin, domainMax, rangeMin, rangeMax) {
  const span = domainMax - domainMin || 1;

  return (value) =>
    rangeMin + ((value - domainMin) / span) * (rangeMax - rangeMin);
}


function niceTickValues(min, max, count = 5) {
  const span = max - min;

  if (!Number.isFinite(span) || span <= 0) return [min];

  const rawStep = span / Math.max(1, count - 1);
  const power = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / power;
  const nice = normalized <= 1 ? 1
    : normalized <= 2 ? 2
    : normalized <= 5 ? 5
    : 10;

  const step = nice * power;
  const start = Math.ceil(min / step) * step;
  const ticks = [];

  for (let value = start; value <= max + step * 0.1; value += step) {
    ticks.push(value);
  }

  return ticks.length ? ticks : [min, max];
}


function compact(value) {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);

  if (abs >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `${(value / 1000).toFixed(1)}k`;
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  return value.toFixed(2);
}


function renderAxes(svg, {
  xScale,
  yScale,
  xDomain,
  yDomain,
  xLabel,
  yLabel,
  width = 900,
  height = 430,
  margins = { left: 70, right: 24, top: 24, bottom: 54 },
}) {
  const plotLeft = margins.left;
  const plotRight = width - margins.right;
  const plotTop = margins.top;
  const plotBottom = height - margins.bottom;

  const xTicks = niceTickValues(xDomain[0], xDomain[1], 6);
  const yTicks = niceTickValues(yDomain[0], yDomain[1], 6);

  for (const tick of yTicks) {
    const y = yScale(tick);
    svg.append(svgElement("line", {
      x1: plotLeft,
      x2: plotRight,
      y1: y,
      y2: y,
      class: "plot-gridline",
    }));
    svg.append(svgElement("text", {
      x: plotLeft - 10,
      y: y + 3,
      "text-anchor": "end",
      class: "plot-tick",
    }, compact(tick)));
  }

  for (const tick of xTicks) {
    const x = xScale(tick);
    svg.append(svgElement("line", {
      x1: x,
      x2: x,
      y1: plotTop,
      y2: plotBottom,
      class: "plot-gridline",
    }));
    svg.append(svgElement("text", {
      x,
      y: plotBottom + 20,
      "text-anchor": "middle",
      class: "plot-tick",
    }, compact(tick)));
  }

  svg.append(svgElement("line", {
    x1: plotLeft,
    x2: plotRight,
    y1: plotBottom,
    y2: plotBottom,
    class: "plot-axis",
  }));

  svg.append(svgElement("line", {
    x1: plotLeft,
    x2: plotLeft,
    y1: plotTop,
    y2: plotBottom,
    class: "plot-axis",
  }));

  svg.append(svgElement("text", {
    x: (plotLeft + plotRight) / 2,
    y: height - 13,
    "text-anchor": "middle",
    class: "plot-axis-label",
  }, xLabel));

  svg.append(svgElement("text", {
    x: 18,
    y: (plotTop + plotBottom) / 2,
    transform: `rotate(-90 18 ${(plotTop + plotBottom) / 2})`,
    "text-anchor": "middle",
    class: "plot-axis-label",
  }, yLabel));
}


function pathFromPoints(points, xScale, yScale) {
  return points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point, index) =>
      `${index === 0 ? "M" : "L"} ${xScale(point.x).toFixed(2)} ${yScale(point.y).toFixed(2)}`
    )
    .join(" ");
}


// =============================================================================
// 7. TRAJECTORY RENDERING
// =============================================================================

function renderTrajectory(result) {
  const points = result.trajectory.downrangeAltitude;

  trajectorySvg.replaceChildren();
  trajectoryEmpty.hidden = points.length > 1;

  if (points.length < 2) return;

  const width = 900;
  const height = 470;
  const margins = { left: 70, right: 30, top: 30, bottom: 55 };

  const xValues = points.map((point) => point.downrangeKm);
  const yValues = points.map((point) => point.altitudeKm);

  const xDomain = paddedExtent(xValues, 0.06, true);
  const yDomain = paddedExtent(yValues, 0.06, true);

  const xScale = scaleLinear(xDomain[0], xDomain[1], margins.left, width - margins.right);
  const yScale = scaleLinear(yDomain[0], yDomain[1], height - margins.bottom, margins.top);

  renderAxes(trajectorySvg, {
    xScale,
    yScale,
    xDomain,
    yDomain,
    xLabel: "DOWNRANGE (km)",
    yLabel: "ALTITUDE (km)",
    width,
    height,
    margins,
  });

  const mapped = points.map((point) => ({
    x: point.downrangeKm,
    y: point.altitudeKm,
  }));

  trajectorySvg.append(svgElement("path", {
    d: pathFromPoints(mapped, xScale, yScale),
    class: "trajectory-line",
  }));

  const start = mapped[0];
  const end = mapped[mapped.length - 1];

  trajectorySvg.append(svgElement("circle", {
    cx: xScale(start.x),
    cy: yScale(start.y),
    r: 5,
    class: "trajectory-point",
  }));

  trajectorySvg.append(svgElement("circle", {
    cx: xScale(end.x),
    cy: yScale(end.y),
    r: 5,
    class: "trajectory-point",
  }));

  for (const event of result.events) {
    if (!["maxQ", "stageBurnout", "stageSeparation"].includes(event.type)) continue;
    if (!Number.isFinite(event.timeS)) continue;

    let nearest = points[0];
    let nearestDistance = Math.abs(points[0].timeS - event.timeS);

    for (const point of points) {
      const distance = Math.abs(point.timeS - event.timeS);
      if (distance < nearestDistance) {
        nearest = point;
        nearestDistance = distance;
      }
    }

    const cx = xScale(nearest.downrangeKm);
    const cy = yScale(nearest.altitudeKm);

    trajectorySvg.append(svgElement("circle", {
      cx,
      cy,
      r: 5,
      class: "trajectory-event",
    }));

    const label =
      event.type === "maxQ"
        ? "MAX-Q"
        : event.type === "stageBurnout"
          ? "BURNOUT"
          : "SEPARATION";

    trajectorySvg.append(svgElement("text", {
      x: cx + 8,
      y: cy - 8,
      class: "trajectory-label",
    }, label));
  }

  trajectorySvg.setAttribute(
    "aria-label",
    `Trajectory plot with ${points.length} recorded states.`
  );
}


// =============================================================================
// 8. RESULT SUMMARY
// =============================================================================

function metricById(result, id) {
  return result.summaryCards.find((item) => item.id === id) ?? null;
}


function metricText(metric) {
  if (!metric) return "—";
  return `${metric.displayValue}${metric.unit ? ` ${metric.unit}` : ""}`;
}


function renderHeadline(result) {
  headline.status.textContent = result.status.classification;
  headline.altitude.textContent = metricText(metricById(result, "max-altitude"));
  headline.speed.textContent = metricText(metricById(result, "max-speed"));
  headline.q.textContent = metricText(metricById(result, "max-q"));
  headline.mass.textContent = metricText(metricById(result, "final-mass"));
}


function renderMetrics(result) {
  const preferredIds = [
    "max-altitude",
    "max-speed",
    "max-mach",
    "max-q",
    "periapsis",
    "apoapsis",
    "max-acceleration",
    "max-twr",
    "flight-time",
    "final-mass",
  ];

  metricGrid.replaceChildren();

  for (const id of preferredIds) {
    const item = metricById(result, id);
    if (!item) continue;

    const card = document.createElement("article");
    const label = document.createElement("span");
    label.textContent = item.label.toUpperCase();

    const value = document.createElement("strong");
    value.textContent = item.displayValue;

    if (item.unit) {
      const unit = document.createElement("small");
      unit.textContent = item.unit;
      value.append(unit);
    }

    card.append(label, value);

    if (item.secondary && Number.isFinite(item.secondary.timeS)) {
      const secondary = document.createElement("p");
      secondary.textContent =
        `Peak at t = ${formatEngineeringValue(item.secondary.timeS, { maximumFractionDigits: 2 })} s`;
      card.append(secondary);
    }

    metricGrid.append(card);
  }
}


function renderStatus(result) {
  resultClassification.textContent = result.status.classification;

  const target = result.orbit.targetEvaluation;

  if (target === null) {
    resultStatusDetail.textContent =
      `Final orbital classification: ${result.orbit.basicClassification}. No target orbit was supplied.`;
    return;
  }

  resultStatusDetail.textContent = target.reachedTarget
    ? "The final periapsis and apoapsis are within the configured target tolerances."
    : `Target not reached. Periapsis error: ${formatEngineeringValue(target.periapsisErrorKm, { maximumFractionDigits: 2 })} km; apoapsis error: ${formatEngineeringValue(target.apoapsisErrorKm, { maximumFractionDigits: 2 })} km.`;
}


// =============================================================================
// 9. CHARTS
// =============================================================================

function renderChart(result, key) {
  const series = result.charts[key];
  if (!series) return;

  chartSvg.replaceChildren();
  chartTitle.textContent = series.label;
  chartUnit.textContent = series.yUnit || "dimensionless";

  const points = series.points;
  if (points.length < 2) return;

  const width = 900;
  const height = 430;
  const margins = { left: 70, right: 28, top: 24, bottom: 55 };

  const xValues = points.map((point) => point.x);
  const yValues = points.map((point) => point.y);

  const xDomain = paddedExtent(xValues, 0.02, true);
  const yDomain = paddedExtent(yValues, 0.08, true);

  const xScale = scaleLinear(xDomain[0], xDomain[1], margins.left, width - margins.right);
  const yScale = scaleLinear(yDomain[0], yDomain[1], height - margins.bottom, margins.top);

  renderAxes(chartSvg, {
    xScale,
    yScale,
    xDomain,
    yDomain,
    xLabel: `${series.xLabel.toUpperCase()} (${series.xUnit})`,
    yLabel: series.yUnit
      ? `${series.yLabel.toUpperCase()} (${series.yUnit})`
      : series.yLabel.toUpperCase(),
    width,
    height,
    margins,
  });

  chartSvg.append(svgElement("path", {
    d: pathFromPoints(points, xScale, yScale),
    class: "plot-line",
  }));

  const maxQEvent = result.events.find((event) => event.type === "maxQ");

  if (maxQEvent && Number.isFinite(maxQEvent.timeS)) {
    const x = xScale(maxQEvent.timeS);

    chartSvg.append(svgElement("line", {
      x1: x,
      x2: x,
      y1: margins.top,
      y2: height - margins.bottom,
      class: "plot-event-line",
    }));

    chartSvg.append(svgElement("text", {
      x: x + 5,
      y: margins.top + 13,
      class: "plot-event-label",
    }, "MAX-Q"));
  }

  chartSvg.setAttribute(
    "aria-label",
    `${series.label}, ${points.length} recorded points.`
  );
}


// =============================================================================
// 10. STAGES
// =============================================================================

function display(value, digits = 2) {
  return formatEngineeringValue(value, { maximumFractionDigits: digits });
}


function renderStagesResult(result) {
  stageResultsBody.replaceChildren();

  if (!result.stages.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.className = "empty-cell";
    cell.textContent = "No stage metadata available.";
    row.append(cell);
    stageResultsBody.append(row);
    return;
  }

  for (const stage of result.stages) {
    const row = document.createElement("tr");

    const values = [
      stage.stageName,
      stage.poweredDurationS === null ? "—" : `${display(stage.poweredDurationS)} s`,
      `${display(stage.usablePropellantMassKg, 1)} kg`,
      `${display(stage.usablePropellantConsumedKg, 1)} kg`,
      stage.burnoutTimeS === null ? "—" : `${display(stage.burnoutTimeS)} s`,
      stage.separationTimeS === null ? "—" : `${display(stage.separationTimeS)} s`,
    ];

    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }

    stageResultsBody.append(row);
  }
}


// =============================================================================
// 11. ORBIT
// =============================================================================

function renderOrbit(result) {
  const orbit = result.orbit;
  const values = orbit.values;

  orbitClassification.textContent = result.status.classification;

  if (orbit.targetEvaluation) {
    orbitTargetResult.textContent = orbit.targetEvaluation.reachedTarget
      ? "Configured target orbit reached within tolerance."
      : "Configured target orbit not reached.";
  } else {
    orbitTargetResult.textContent = "No target orbit was supplied.";
  }

  const rows = [
    ["Periapsis", `${display(values.periapsisAltitudeKm)} km`],
    ["Apoapsis", values.apoapsisAltitudeKm === Infinity ? "∞" : `${display(values.apoapsisAltitudeKm)} km`],
    ["Eccentricity", display(values.eccentricity, 5)],
    ["Semi-major axis", values.semiMajorAxisKm === Infinity ? "∞" : `${display(values.semiMajorAxisKm)} km`],
    ["Orbital period", values.orbitalPeriodS === null ? "—" : `${display(values.orbitalPeriodS)} s`],
    ["Specific energy", `${display(values.specificEnergyJPerKg, 1)} J/kg`],
    ["Angular momentum", `${display(values.specificAngularMomentumM2PerS, 1)} m²/s`],
    ["Final speed", `${display(values.speedKmPerS, 4)} km/s`],
  ];

  orbitGrid.replaceChildren();

  for (const [label, value] of rows) {
    const wrapper = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value;
    wrapper.append(dt, dd);
    orbitGrid.append(wrapper);
  }
}


// =============================================================================
// 12. EVENTS / WARNINGS
// =============================================================================

function renderEvents(result) {
  eventList.replaceChildren();

  for (const event of result.events) {
    const item = document.createElement("li");
    const time = document.createElement("time");
    const title = document.createElement("strong");
    const detail = document.createElement("span");

    time.textContent = Number.isFinite(event.timeS)
      ? `${display(event.timeS)} s`
      : "—";

    title.textContent = event.label;

    if (event.type === "maxQ") {
      detail.textContent =
        `${display(event.altitudeKm)} km · ${display(event.dynamicPressureKPa)} kPa`;
    } else if (event.stage) {
      detail.textContent = event.stage.name;
    } else if (event.terminationReason) {
      detail.textContent = event.terminationReason;
    } else {
      detail.textContent = "";
    }

    item.append(time, title, detail);
    eventList.append(item);
  }

  warningList.replaceChildren();

  if (!result.warnings.length) {
    const item = document.createElement("li");
    item.className = "empty-list";
    item.textContent = "No warnings were produced by the current configuration.";
    warningList.append(item);
    return;
  }

  for (const warning of result.warnings) {
    const item = document.createElement("li");
    const title = document.createElement("strong");
    const text = document.createElement("p");

    title.textContent = warning.code;
    text.textContent = warning.message;

    item.append(title, text);
    warningList.append(item);
  }
}


// =============================================================================
// 13. RESULT TABS
// =============================================================================

const resultTabs = [...document.querySelectorAll("[data-result-tab]")];

function activateResultTab(tab) {
  const name = tab.dataset.resultTab;

  for (const candidate of resultTabs) {
    const selected = candidate === tab;
    candidate.setAttribute("aria-selected", String(selected));
    candidate.tabIndex = selected ? 0 : -1;

    const panel = document.querySelector(`#${candidate.dataset.resultTab}-panel`);
    if (panel) panel.hidden = !selected;
  }

  if (name === "charts" && currentResult) {
    renderChart(currentResult, activeChart);
  }
}


resultTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => activateResultTab(tab));

  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();

    let nextIndex = index;

    if (event.key === "ArrowLeft") nextIndex = (index - 1 + resultTabs.length) % resultTabs.length;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % resultTabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = resultTabs.length - 1;

    resultTabs[nextIndex].focus();
    activateResultTab(resultTabs[nextIndex]);
  });
});


// =============================================================================
// 14. FULL RENDER
// =============================================================================

function renderResult(result) {
  renderTrajectory(result);
  renderHeadline(result);
  renderMetrics(result);
  renderStatus(result);
  renderChart(result, activeChart);
  renderStagesResult(result);
  renderOrbit(result);
  renderEvents(result);

  exportButton.disabled = false;
}


// =============================================================================
// 15. RUN SIMULATION
// =============================================================================

async function executeSimulation() {
  hideError();

  if (!form.checkValidity()) {
    form.reportValidity();
    throw new Error("Complete the required fields before running the simulation.");
  }

  runButton.disabled = true;
  setRunStatus("running", "Running…");

  // Yield once so the browser paints the running state before synchronous work.
  await new Promise((resolve) => setTimeout(resolve, 0));

  const rawInput = collectRawInput();
  const prepared = prepareSimulationInput(rawInput);
  const simulation = runSimulation(prepared.simulationConfig);

  const result = prepareSimulationResult({
    simulationResult: simulation,
    simulationConfig: prepared.simulationConfig,
    inputMetadata: prepared.metadata,
  });

  currentResult = result;

  renderResult(result);
  setRunStatus("success", "Complete");
}


form.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await executeSimulation();
  } catch (error) {
    showError(error);
  } finally {
    runButton.disabled = false;
  }
});


// =============================================================================
// 16. EXPORT
// =============================================================================

exportButton.addEventListener("click", () => {
  if (!currentResult) return;

  const blob = new Blob(
    [JSON.stringify(currentResult.exportData, null, 2)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "launch-vehicle-analysis.json";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});


// =============================================================================
// 17. INPUT EVENTS
// =============================================================================

stageCount.addEventListener("change", () => {
  const count = Number(stageCount.value);
  const existing = captureStageEditorValues();
  const values = Array.from(
    { length: count },
    (_, index) => existing[index] ?? EXAMPLE_STAGES[index]
  );

  renderStages(count, values);
});

document.querySelector("#reset-example").addEventListener("click", loadExample);

document.querySelector("#add-cd-row").addEventListener("click", () => {
  const last = cdTableBody.lastElementChild;
  const lastMach = last
    ? Number(last.querySelector('[data-column="x"]').value) || 0
    : 0;

  addNumericTableRow({
    body: cdTableBody,
    x: lastMach + 1,
    y: 0.25,
    xLabel: "Mach number",
    yLabel: "Drag coefficient",
  });
});

document.querySelector("#add-guidance-row").addEventListener("click", () => {
  const last = guidanceTableBody.lastElementChild;
  const lastValue = last
    ? Number(last.querySelector('[data-column="x"]').value) || 0
    : 0;

  addNumericTableRow({
    body: guidanceTableBody,
    x: lastValue + (guidanceCoordinate.value === "altitude" ? 20 : 20),
    y: 0,
    xLabel: "Guidance schedule coordinate",
    yLabel: "Pitch angle in degrees",
  });
});

guidanceType.addEventListener("change", updateGuidanceVisibility);
guidanceCoordinate.addEventListener("change", updateGuidanceCoordinateLabel);

chartToolbar.addEventListener("click", (event) => {
  const button = event.target.closest("[data-chart]");
  if (!button) return;

  activeChart = button.dataset.chart;

  for (const candidate of chartToolbar.querySelectorAll("[data-chart]")) {
    candidate.classList.toggle("active", candidate === button);
  }

  if (currentResult) renderChart(currentResult, activeChart);
});


// =============================================================================
// 18. INITIALIZE
// =============================================================================

loadExample();
