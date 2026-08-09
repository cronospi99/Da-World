/** Minimal DOM helpers — the UI is small enough not to need a framework. */

type Attrs = Record<string, string | number | boolean | undefined>;
type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === "class") node.className = String(value);
    else if (key === "text") node.textContent = String(value);
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

/** A close button matching the little rotated tile used across the UI. */
export function closeButton(onClick: () => void, label = "Close"): HTMLButtonElement {
  const button = el("button", { class: "tile-button close", "aria-label": label });
  button.innerHTML = `<svg viewBox="0 0 18 18" aria-hidden="true">
    <path d="M3 3 L15 15 M15 3 L3 15" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/>
  </svg>`;
  button.addEventListener("click", onClick);
  return button;
}

/** Speaker icon button used to replay pronunciation. */
export function speakerButton(onClick: () => void, label = "Listen"): HTMLButtonElement {
  const button = el("button", { class: "tile-button speaker", "aria-label": label });
  button.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M3 8 h3 l4 -3.5 v11 l-4 -3.5 h-3 z" fill="currentColor"/>
    <path d="M13 6.5 a5 5 0 0 1 0 7" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>
  </svg>`;
  button.addEventListener("click", onClick);
  return button;
}
