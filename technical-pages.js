/**
 * @file technical-pages.js
 * @description Shared presentation behavior for the validation and limitations
 * pages. Provides interface interactions only and does not alter validation data or
 * simulation physics.
 */

const header = document.querySelector("[data-header]");
const menuButton = document.querySelector("[data-menu]");
const nav = document.querySelector("[data-nav]");
const navLinks = [...document.querySelectorAll("[data-nav] a")];

function closeMenu() {
  nav?.classList.remove("open");
  menuButton?.setAttribute("aria-expanded", "false");
}

menuButton?.addEventListener("click", () => {
  const open = nav?.classList.toggle("open");
  menuButton.setAttribute("aria-expanded", String(Boolean(open)));
});

navLinks.forEach((link) => link.addEventListener("click", closeMenu));
window.addEventListener(
  "scroll",
  () => header?.classList.toggle("scrolled", window.scrollY > 20),
  { passive: true }
);
