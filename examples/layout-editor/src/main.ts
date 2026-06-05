import { mount } from "svelte";
import "./app.css";

// Viewer by default; the authoring editor stays behind #edit. The dynamic
// imports keep the two as split bundles, so the editor's model/board weight
// never loads for viewers.
//
// Each import() must be its own statement. Vite wraps every dynamic import in
// a CSS-preload helper, and a `cond ? import(a) : import(b)` ternary gets a
// single wrapper with one shared deps array — the other branch's chunk CSS
// then never loads (#edit shipped unstyled this way).
const editor = location.hash === "#edit";

async function boot(): Promise<void> {
  const target = document.getElementById("app")!;
  if (editor) {
    const { default: Root } = await import("./App.svelte");
    mount(Root, { target });
  } else {
    const { default: Root } = await import("./Viewer.svelte");
    mount(Root, { target });
  }
}
void boot();

// The mode is decided at boot; flipping the hash mid-session reloads into the
// other app rather than hot-swapping component trees.
window.addEventListener("hashchange", () => {
  if ((location.hash === "#edit") !== editor) location.reload();
});
