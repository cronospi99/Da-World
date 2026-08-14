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
