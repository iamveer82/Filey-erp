// The overlay's cursor is the chosen OpenDots mascot and follows the real pointer.
// agent_overlay.rs calls fileyPointer ~30 times a second and fileyMascot once control starts.
/* global document, window */
(() => {
  const cursor = document.getElementById("cursor");
  const face = document.getElementById("mascot");
  const known = ["blue", "mint", "orange", "purple"];
  window.fileyMascot = (id) => {
    if (typeof id === "string" && id.startsWith("data:image/")) { face.src = id; return; }
    const name = known.includes(id) ? id : "blue";
    face.src = `/mascots/${name}.png`;
  };
  window.fileyPointer = (x, y) => {
    cursor.style.left = `${x - 36}px`;
    cursor.style.top = `${y - 48}px`;
    cursor.style.transform = "none";
  };
})();
