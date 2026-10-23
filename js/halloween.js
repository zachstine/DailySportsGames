const ghost = /* HTML */ `<svg viewBox="0 0 64 72" focusable="false" aria-hidden="true">
  <path
    class="ghost-body"
    d="M12 60V28a20 20 0 0 1 40 0v32l-10-7-10 9-10-9Z"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linejoin="round"
  />
  <ellipse class="ghost-face" cx="25" cy="29" rx="3" ry="4" />
  <ellipse class="ghost-face" cx="40" cy="29" rx="3" ry="4" />
  <ellipse class="ghost-face" cx="33" cy="41" rx="3" ry="4" />
</svg>`;

const web = /* HTML */ `<svg viewBox="0 0 100 90" focusable="false" aria-hidden="true">
  <g fill="none" stroke="currentColor" stroke-width="1.3">
    <path d="M0 0h100M0 0v90M0 0l88 38M0 0l52 75M0 0l22 87" />
    <path d="M23 0q-3 8-3 9-7 4-8 8-6 1-8 4-2 0-4 1" />
    <path d="M47 0q-5 14-6 18-12 5-16 17-10 1-15 8-4 0-10 1" />
    <path d="M72 0q-6 23-9 27-19 9-25 27-15 1-23 12-7 0-15 1" />
    <path d="M98 0q-8 30-11 38-26 11-35 37-20 0-30 12-10 0-22 1" />
  </g>
</svg>`;

const spider = /* HTML */ `<svg viewBox="0 0 60 50" focusable="false" aria-hidden="true">
  <g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
    <path d="M23 21 12 14 5 7M21 26 9 24 3 18M22 31 10 34 4 42M24 34 18 44 16 48" />
    <path d="M37 21 48 14 55 7M39 26 51 24 57 18M38 31 50 34 56 42M36 34 42 44 44 48" />
  </g>
  <ellipse cx="30" cy="29" rx="12" ry="13" fill="currentColor" />
  <circle cx="30" cy="16" r="8" fill="currentColor" />
  <circle cx="27" cy="15" r="1.6" class="spider-eye" />
  <circle cx="33" cy="15" r="1.6" class="spider-eye" />
</svg>`;

export function createHalloweenDecorations() {
  let active = false;
  const scene = document.createElement("div");
  scene.className = "halloween-scene";
  scene.setAttribute("aria-hidden", "true");
  scene.inert = true;
  scene.hidden = true;
  scene.innerHTML = /* HTML */ `
    <span class="halloween-web web-left">${web}</span>
    <span class="halloween-web web-right">${web}</span>
    <span class="web-spider">${spider}</span>
    <span class="halloween-dropper">
      <span class="spider-thread"></span>
      <span class="hanging-spider">${spider}</span>
    </span>
  `;
  for (const [index, position] of [18, 51, 77].entries()) {
    const visitor = document.createElement("span");
    visitor.className = "halloween-ghost";
    visitor.innerHTML = ghost;
    visitor.style.left = `${position + Math.random() * 6 - 3}%`;
    visitor.style.top = `${12 + Math.random() * 17}px`;
    visitor.style.width = `${26 + Math.random() * 12}px`;
    visitor.style.setProperty("--ghost-tilt", `${Math.random() * 16 - 8}deg`);
    visitor.style.setProperty("--ghost-delay", `${index * 0.4}s`);
    scene.append(visitor);
  }
  document.querySelector("#appearance-preview")?.after(scene);

  const accents = [];
  for (const heading of document.querySelectorAll("#home-view .section-heading h2")) {
    const visitor = document.createElement("span");
    visitor.className = "halloween-heading-ghost";
    visitor.setAttribute("aria-hidden", "true");
    visitor.innerHTML = ghost;
    visitor.hidden = true;
    heading.append(visitor);
    accents.push(visitor);
  }
  const footer = document.querySelector(".site-footer");
  const footerWeb = document.createElement("span");
  footerWeb.className = "halloween-footer-web";
  footerWeb.setAttribute("aria-hidden", "true");
  footerWeb.innerHTML = web;
  footerWeb.hidden = true;
  footer?.append(footerWeb);

  return {
    setActive(value) {
      if (value === active) return;
      active = value;
      scene.hidden = !value;
      footerWeb.hidden = !value;
      for (const accent of accents) accent.hidden = !value;
    },
  };
}
