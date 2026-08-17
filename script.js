/**
 * @file script.js
 * @description Homepage interaction controller for AscentBench. Handles navigation,
 * progressive UI behavior, and presentation-only interactions. No simulation physics
 * is implemented in this file.
 */

const header = document.querySelector("[data-header]");
const menuButton = document.querySelector("[data-menu]");
const nav = document.querySelector("[data-nav]");
const navLinks = [...document.querySelectorAll("[data-nav] a")];

function closeMenu(){nav?.classList.remove("open");menuButton?.setAttribute("aria-expanded","false")}
menuButton?.addEventListener("click",()=>{const open=nav?.classList.toggle("open");menuButton.setAttribute("aria-expanded",String(Boolean(open)))})
navLinks.forEach(link=>link.addEventListener("click",closeMenu));
window.addEventListener("scroll",()=>header?.classList.toggle("scrolled",window.scrollY>20),{passive:true});

const sections=[...document.querySelectorAll("#home,#system,#flight,#physics,#traceability,#architecture")];
const sectionObserver=new IntersectionObserver(entries=>{
  const visible=entries.filter(e=>e.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];
  if(!visible)return;
  navLinks.forEach(link=>link.classList.toggle("active",link.getAttribute("href")===`#${visible.target.id}`));
},{rootMargin:"-25% 0px -60% 0px",threshold:[.05,.25,.5]});
sections.forEach(section=>sectionObserver.observe(section));

const revealTargets=[...document.querySelectorAll(".section-intro,.system-flow,.flight-story,.physics-workbench,.trace-flow,.trace-meta,.architecture-board")];
revealTargets.forEach(el=>el.classList.add("reveal"));
const revealObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(!entry.isIntersecting)return;entry.target.classList.add("visible");revealObserver.unobserve(entry.target)}),{threshold:.08});
revealTargets.forEach(el=>revealObserver.observe(el));

const telemetryFrames=[
  {altitude:"18.4 km",velocity:"0.43 km/s",mach:"1.46",q:"10.6 kPa",stage:"1"},
  {altitude:"32.8 km",velocity:"1.21 km/s",mach:"3.98",q:"8.74 kPa",stage:"1"},
  {altitude:"58.6 km",velocity:"2.05 km/s",mach:"6.46",q:"0.77 kPa",stage:"1"}
];
let telemetryIndex=1;
function renderTelemetry(frame){Object.entries(frame).forEach(([key,value])=>{const target=document.querySelector(`[data-telemetry="${key}"]`);if(target)target.textContent=value})}
const reduceMotion=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches??false;
if(!reduceMotion){
  window.setInterval(()=>{telemetryIndex=(telemetryIndex+1)%telemetryFrames.length;renderTelemetry(telemetryFrames[telemetryIndex])},3000);
}

const modelData={
  gravity:{index:"01",kicker:"GRAVITY MODEL",title:"Central spherical-Earth gravity",equation:"g = μ / r²",input:"Earth-centred position",output:"Acceleration vector",module:"gravity.js",limit:"J2, oblateness, third-body gravity, and local terrain effects are not modeled."},
  atmosphere:{index:"02",kicker:"ATMOSPHERE MODEL",title:"Layered lower-atmosphere model",equation:"T(H), P(H), ρ = P / RT",input:"Geometric altitude",output:"Temperature, pressure, density, speed of sound",module:"atmosphere.js",limit:"The lower model ends at 86 km geometric altitude; above that the current ascent wrapper uses an explicit vacuum approximation."},
  propulsion:{index:"03",kicker:"PROPULSION MODEL",title:"Ambient-pressure-corrected stage performance",equation:"F(Pa) from sea-level ↔ vacuum anchors",input:"Stage performance data + ambient pressure",output:"Thrust, effective Isp, mass-flow rate",module:"propulsion.js",limit:"No nozzle geometry, chamber thermodynamics, or detailed throttle-performance map is modeled."},
  aerodynamics:{index:"04",kicker:"AERODYNAMICS MODEL",title:"Drag-only Mach-dependent aerodynamics",equation:"D = ½ρV² Cd A",input:"Relative air velocity + atmosphere + Cd(M)",output:"Mach, dynamic pressure, drag vector",module:"aerodynamics.js",limit:"Lift, Reynolds-number dependence, angle-of-attack dependence, and CFD are outside the current model."},
  guidance:{index:"05",kicker:"GUIDANCE MODEL",title:"Abstract two-dimensional thrust direction",equation:"T⃗ = T · T̂",input:"Position, velocity, selected guidance mode",output:"Unit thrust direction and guidance angles",module:"guidance.js",limit:"No vehicle-specific pitch program, launch azimuth logic, closed-loop orbital targeting, or attitude-control hardware is modeled."},
  orbit:{index:"06",kicker:"ORBIT MODEL",title:"Planar two-body orbital-state analysis",equation:"ε = v²/2 − μ/r",input:"Earth-centred position + velocity",output:"Energy, angular momentum, eccentricity, periapsis, apoapsis",module:"orbit.js",limit:"The analysis is planar and two-body; J2, third-body gravity, and other perturbations are not included."}
};
const tabs=[...document.querySelectorAll("[data-model]")];
function renderModel(key){const model=modelData[key];if(!model)return;document.querySelector("[data-model-index]").textContent=model.index;document.querySelector("[data-model-kicker]").textContent=model.kicker;document.querySelector("[data-model-title]").textContent=model.title;document.querySelector("[data-model-equation]").textContent=model.equation;document.querySelector("[data-model-input]").textContent=model.input;document.querySelector("[data-model-output]").textContent=model.output;document.querySelector("[data-model-module]").textContent=model.module;document.querySelector("[data-model-limit]").textContent=model.limit;tabs.forEach(tab=>{const selected=tab.dataset.model===key;tab.setAttribute("aria-selected",String(selected));tab.tabIndex=selected?0:-1})}
tabs.forEach((tab,index)=>{tab.addEventListener("click",()=>renderModel(tab.dataset.model));tab.addEventListener("keydown",event=>{if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End"].includes(event.key))return;event.preventDefault();let next=index;if(event.key==="ArrowLeft"||event.key==="ArrowUp")next=(index-1+tabs.length)%tabs.length;else if(event.key==="ArrowRight"||event.key==="ArrowDown")next=(index+1)%tabs.length;else if(event.key==="Home")next=0;else if(event.key==="End")next=tabs.length-1;tabs[next].focus();renderModel(tabs[next].dataset.model)})});
renderModel("gravity");
