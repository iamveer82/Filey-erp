/* global HL, hairline, performance */
/** Six letter sheets in a rounded desk tray; only resting edges are hit targets. */
const {
  Cam, clamp, facing, fillet, fit, hull, mk, open, pointer, poly, proj, rad,
  register, ringAt, rrect, run, seg, tdone, tset, tval, tween, disposer,
} = HL;

const N = 6, W = 84, H = 70, G = 16, TK = 1.1;
const REST = [-15, -12, -9, -13, -10, -8], BACK = -26, FORWARD = 14;
const X0 = -6, X1 = 90, Y0 = -14, Y1 = 92, RIM = 19, WALL = 2.4;
const MAX_LIFT = 48;
const leftFirst = points => points[0][0] <= points[points.length - 1][0] ? points : points.slice().reverse();

function tray(P, front) {
  const outer = rrect(X0, Y0, X1, Y1, 6, 6);
  const inner = rrect(X0 + WALL, Y0 + WALL, X1 - WALL, Y1 - WALL, 3.6, 6);
  const far = [
    [poly(hull(ringAt(P, outer, 0).concat(ringAt(P, outer, RIM)))), "sil"],
    [poly(ringAt(P, inner, RIM)), "nf"],
    [open(ringAt(P, run(inner, q => !front(q)), 2.5)), "nf lo"],
  ];
  const inside = leftFirst(ringAt(P, run(inner, front), RIM));
  const top = leftFirst(ringAt(P, run(outer, front), RIM));
  const base = leftFirst(ringAt(P, run(outer, front), 0));
  const grip = ring => poly(ring.map(q => P(W / 2 + q.u, Y1, q.v)));
  const near = [
    [poly([...inside, top[top.length - 1], ...base.slice().reverse(), top[0]]), "fo"],
    [open(top), "nf lo"], [open(inside), "nf"],
    [open([top[0], ...base, top[top.length - 1]]), "nf sil"],
    [grip(rrect(-11, 6, 11, 12, 3, 6)), "nf"],
    [grip(rrect(-9.4, 7.5, 9.4, 10.5, 1.5, 6)), "nf lo"],
  ];
  return { far, near };
}

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let lift = clamp(Number.isFinite(value) ? value : 36, 20, MAX_LIFT), active = -1;
  const C = Cam(45, 0.5, 1.48);
  fit(C, [[X0, Y0, 0], [X1, Y0, 0], [X0, Y1, 0], [X1, Y1, 0], [0, -32, H + MAX_LIFT],
    [W, 0, H + MAX_LIFT], [0, (N - 1) * G, H + MAX_LIFT], [W, (N - 1) * G, H + MAX_LIFT],
    [W, (N - 1) * G + H * Math.sin(rad(FORWARD)), H]], 200, 166);
  const P = proj(C), front = facing(C), root = mk("g", {}, svg), paths = tray(P, front);
  paths.far.forEach(([d, cls]) => mk("path", { d, class: cls }, root));
  const shape = fillet([[0, 0], [W, 0], [W, H - 12], [W - 12, H], [0, H]], [2, 2, 1.3, 1.3, 2]);
  const sheets = Array.from({ length: N }, (_, i) => {
    const group = mk("g", {}, root);
    return { back: mk("path", { class: "lo" }, group), face: mk("path", { class: "sil" }, group),
      fold: mk("path", { class: "nf lo" }, group), ruling: mk("path", { class: "nf lo" }, group),
      angle: tween(REST[i]), height: tween(0), lastAngle: NaN, lastHeight: NaN };
  });
  paths.near.forEach(([d, cls]) => mk("path", { d, class: cls }, root));

  function draw(i, angle, height) {
    const sheet = sheets[i];
    if (angle === sheet.lastAngle && height === sheet.lastHeight) return;
    sheet.lastAngle = angle; sheet.lastHeight = height;
    const s = Math.sin(rad(angle)), c = Math.cos(rad(angle));
    const face = (u, v) => P(u, i * G + v * s, v * c + height);
    const back = (u, v) => P(u, i * G + v * s - TK * c, v * c + TK * s + height);
    sheet.back.setAttribute("d", poly(shape.map(([u, v]) => back(u, v))));
    sheet.face.setAttribute("d", poly(shape.map(([u, v]) => face(u, v))));
    sheet.fold.setAttribute("d", open([face(W - 12, H), face(W - 12, H - 12), face(W, H - 12)]));
    sheet.ruling.setAttribute("d", [seg(face(9, H - 17), face(43, H - 17)),
      ...[H - 26, H - 35, H - 44].map(v => seg(face(9, v), face(W - 10, v)))].join(""));
  }

  const loop = register(stage, (_dt, now) => {
    let moving = false;
    sheets.forEach((sheet, i) => {
      draw(i, tval(sheet.angle, now), tval(sheet.height, now));
      if (!tdone(sheet.angle, now) || !tdone(sheet.height, now)) moving = true;
    });
    return moving;
  });
  bag.add(loop.unregister);

  function select(a, force = false) {
    if (a === active && !force) return;
    const now = performance.now(), origin = a < 0 ? active : a;
    active = a;
    sheets.forEach((sheet, i) => {
      const distance = Math.abs(i - origin), delay = distance * 38;
      const angle = a < 0 ? REST[i] : i < a ? BACK : i > a ? FORWARD : 0;
      const height = a < 0 ? 0 : lift * (i === a ? 1 : distance === 1 ? 0.38 : distance === 2 ? 0.13 : 0);
      tset(sheet.angle, angle, now, delay); tset(sheet.height, height, now, delay);
      sheet.face.classList.toggle("hi", i === (a < 0 ? N - 1 : a));
    });
    read.textContent = a < 0 ? "rest" : `sheet ${String(N - a).padStart(2, "0")}`;
    loop.wake();
  }

  // Each band follows its own immutable rest edge, including its resting lean.
  const start = P(0, 0, 0), end = P(1, 0, 0), axis = [end[0] - start[0], end[1] - start[1]];
  const length = Math.hypot(...axis), unit = axis.map(v => v / length);
  const centres = REST.map((angle, i) => P(W / 2, i * G + H * Math.sin(rad(angle)), H * Math.cos(rad(angle))));
  function hit([x, y]) {
    let picked = -1, nearest = 12;
    centres.forEach(([cx, cy], i) => {
      const dx = x - cx, dy = y - cy;
      const along = (dx * unit[0] + dy * unit[1]) / length;
      const distance = Math.abs(dx * unit[1] - dy * unit[0]);
      if (Math.abs(along) <= W / 2 + 5 && distance < nearest) { nearest = distance; picked = i; }
    });
    return picked;
  }
  bag.add(pointer(stage, { move: point => select(hit(point)), leave: () => select(-1) }));
  const attrs = ["tabindex", "role", "aria-label"].map(name => [name, stage.getAttribute(name)]);
  stage.setAttribute("tabindex", "0"); stage.setAttribute("role", "group");
  stage.setAttribute("aria-label", "Document tray. Left and right arrows select a sheet; Home selects the first, End the last, Escape returns to rest.");
  bag.on(stage, "keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) return;
    event.preventDefault();
    const chapter = active < 0 ? -1 : N - 1 - active;
    const next = event.key === "Escape" ? -1 : event.key === "Home" ? 0 : event.key === "End" ? N - 1
      : clamp(chapter + (event.key === "ArrowRight" ? 1 : -1), 0, N - 1);
    select(next < 0 ? -1 : N - 1 - next);
  });
  bag.on(stage, "blur", () => select(-1));
  bag.add(() => { attrs.forEach(([name, previous]) => previous === null ? stage.removeAttribute(name) : stage.setAttribute(name, previous)); svg.replaceChildren(); });
  select(-1, true);
  return { set: next => { lift = clamp(Number.isFinite(next) ? next : 36, 20, MAX_LIFT); select(active, true); },
    choose: index => select(N - 1 - clamp(Math.round(Number.isFinite(index) ? index : 0), 0, N - 1)), destroy: bag.dispose };
}

hairline({
  name: "document-tray",
  means: "Six sheets in a desk tray: choose one to lift it, while nearby pages part in a quiet ripple.",
  rules: [1, 2, 4, 5, 7, 8, 9, 10], range: [20, 36, 48], mount,
});
