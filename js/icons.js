const shapes = {
  "arrow-up-right": '<path d="M7 17 17 7M7 7h10v10" />',
  "arrow-right": '<path d="M4 12h16m-6-6 6 6-6 6" />',
  "arrow-left": '<path d="M20 12H4m6-6-6 6 6 6" />',
  "arrow-up": '<path d="M12 20V4m-6 6 6-6 6 6" />',
  "arrow-down": '<path d="M12 4v16m-6-6 6 6 6-6" />',
  refresh: '<path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7" />',
  burst: '<path d="M12 2v20M2 12h20M5 5l14 14M19 5 5 19" />',
  sparkle: '<path d="m12 2 2.7 7.3L22 12l-7.3 2.7L12 22l-2.7-7.3L2 12l7.3-2.7Z" />',
  sun: /* HTML */ `<circle cx="12" cy="12" r="4" />
    <path
      d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"
    />`,
  moon: '<path d="M20.8 14.3A9 9 0 0 1 9.7 3.2a9 9 0 1 0 11.1 11.1Z" />',
  pumpkin: /* HTML */ `<path
      d="M12 6V3l3-1M12 6C4 2 1 10 3 16c1 4 5 6 9 4 4 2 8 0 9-4 2-6-1-14-9-10Z"
    />
    <path d="M12 6c-5 2-5 12 0 14 5-2 5-12 0-14Z" />
    <path d="m6.5 11 1 1m9-1-1 1M9 16c2 1.4 4 1.4 6 0" />`,
  leaves: /* HTML */ `<path d="M4 15C3 8 9 4 20 3c0 10-4 16-11 16M4 21 17 7M8 17l-1-6m6 1 5 1" />`,
  snowflake: /* HTML */ `<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7" />
    <path
      d="m9 4 3 3 3-3M9 20l3-3 3 3M3.5 10l4-1-1-4m11 14-1-4 4-1M6.5 19l1-4-4-1m17-4-4-1 1-4"
    />`,
};

// Interface artwork inherits CSS colors instead of using a device's emoji font.
export function icon(name) {
  const shape = Object.hasOwn(shapes, name) ? shapes[name] : shapes.sparkle;
  return /* HTML */ `<svg
    class="ui-icon"
    viewBox="0 0 24 24"
    width="24"
    height="24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    ${shape}
  </svg>`;
}
