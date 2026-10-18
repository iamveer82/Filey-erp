// The overlay's cursor follows the real pointer; agent_overlay.rs calls this ~30 times a second.
/* global document, window */
(() => {
  const cursor = document.getElementById("cursor");
  window.fileyPointer = (x, y) => {
    cursor.style.transform = `translate(${x}px, ${y}px)`;
  };
})();
