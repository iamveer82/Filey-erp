import { useRef, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { Link, MemoryRouter, useLocation } from 'react-router-dom';
import { useSidebarSwipe } from '../useSidebarSwipe';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function Drawer({ enabled = true }: { enabled?: boolean }) {
  const root = useRef<HTMLDivElement>(null), panel = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useSidebarSwipe(root, panel, enabled, open, setOpen);
  return <div ref={root} data-testid="root" data-sidebar-open={open}><div className="workspace-drawer-backdrop" /><aside ref={panel} data-testid="drawer" data-open={open}><Link to="/overview">Filey home</Link><button>Destination</button><input aria-label="Search pages" /></aside><div className="workspace-main"><button onClick={() => setOpen(true)}>Menu</button><output aria-label="Current page">{pathname}</output></div></div>;
}
const point = (x: number, y = 200) => ({ identifier: 1, clientX: x, clientY: y });
function start(target: Element, x: number, y = 200) { return fireEvent.touchStart(target, { touches: [point(x, y)], cancelable: true }); }
function move(target: Element, x: number, y = 200) { return fireEvent.touchMove(target, { touches: [point(x, y)], cancelable: true }); }
function setup(enabled = true) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 336 } as DOMRect);
  const view = render(<MemoryRouter initialEntries={['/invoicing']}><Drawer enabled={enabled} /></MemoryRouter>);
  return { ...view, root: view.getByTestId('root'), panel: view.getByTestId('drawer'), main: view.container.querySelector<HTMLElement>('.workspace-main')! };
}
it('follows an edge swipe, opens on release, and closes with a left swipe without activating links', () => {
  const {root, panel, main, getByText} = setup();
  start(root, 20); move(root, 200);
  expect(main.style.transform).toBe('translate3d(180px, 0, 0)');
  expect(panel.style.transform).toBe('translate3d(-156px, 0, 0)');
  expect(root.style.getPropertyValue('--workspace-reveal')).toBe('');
  expect(root.dataset.sidebarDragging).toBe('true');
  expect(panel.dataset.open).toBe('false');
  fireEvent.touchEnd(root);
  expect(panel.dataset.open).toBe('true');
  expect(main.style.transform).toBe('');
  expect(panel.style.transform).toBe('');
  expect(root.dataset.sidebarDragging).toBeUndefined();
  const clicked = vi.fn(); getByText('Destination').addEventListener('click', clicked);
  start(getByText('Destination'), 260); move(panel, 50);
  expect(main.style.transform).toBe('translate3d(126px, 0, 0)');
  expect(panel.style.transform).toBe('translate3d(-210px, 0, 0)');
  fireEvent.touchEnd(panel);
  expect(panel.dataset.open).toBe('false');
  fireEvent.click(getByText('Destination'));
  expect(clicked).not.toHaveBeenCalled();
});
it('leaves vertical scrolling, fields and gestures away from the edge alone', () => {
  const {root, panel, getByLabelText} = setup();
  start(root, 20); move(root, 24, 250); move(root, 240, 260); fireEvent.touchEnd(root);
  expect(panel.dataset.open).toBe('false');
  start(root, 100); move(root, 300); fireEvent.touchEnd(root);
  expect(panel.dataset.open).toBe('false');
  const field = getByLabelText('Search pages'); start(field, 20); move(field, 240); fireEvent.touchEnd(field);
  expect(panel.dataset.open).toBe('false');
});
it('cancels interrupted and multi-finger gestures and disables swipes on desktop', () => {
  const {root, panel, main, rerender} = setup();
  start(root, 20); move(root, 200); fireEvent.touchCancel(root);
  expect(panel.dataset.open).toBe('false'); expect(main.style.transform).toBe(''); expect(panel.style.transform).toBe('');
  expect(root.dataset.sidebarDragging).toBeUndefined();
  start(root, 20); move(root, 200); fireEvent.touchStart(root, {touches: [point(200), {...point(250), identifier: 2}]}); fireEvent.touchEnd(root);
  expect(panel.dataset.open).toBe('false');
  rerender(<MemoryRouter><Drawer enabled={false} /></MemoryRouter>);
  start(root, 20); move(root, 250); fireEvent.touchEnd(root);
  expect(panel.dataset.open).toBe('false');
});

it('keeps menu taps and diagonal page scrolling separate from swipe gestures', () => {
  const {root, panel, getByText} = setup();
  const menu = getByText('Menu');
  start(menu, 24); move(menu, 90); fireEvent.touchEnd(menu);
  expect(root.dataset.sidebarDragging).toBeUndefined();
  fireEvent.click(menu);
  expect(panel.dataset.open).toBe('true');
  start(panel, 250); move(panel, 235, 209); move(panel, 226, 265); fireEvent.touchEnd(panel);
  expect(panel.dataset.open).toBe('true');
  expect(root.dataset.sidebarDragging).toBeUndefined();
});

it('uses the release position and recovers from browser interruptions without stray clicks', () => {
  const {root, panel, main, getByText} = setup();
  start(root, 20); move(root, 200);
  fireEvent.touchEnd(root, {changedTouches: [point(28)]});
  expect(panel.dataset.open).toBe('false');
  start(root, 20); move(root, 200);
  fireEvent(window, new Event('resize'));
  expect(root.dataset.sidebarDragging).toBeUndefined();
  expect(main.style.transform).toBe('');
  expect(panel.style.transform).toBe('');
  fireEvent.touchEnd(root);
  expect(panel.dataset.open).toBe('false');
  start(root, 20); move(root, 200);
  fireEvent.touchMove(root, { touches: [point(230)], cancelable: false });
  const menu = getByText('Menu');
  fireEvent.click(menu);
  expect(panel.dataset.open).toBe('false');
  // A new deliberate tap works immediately, even inside the click guard window.
  start(menu, 24); fireEvent.touchEnd(menu); fireEvent.click(menu);
  expect(panel.dataset.open).toBe('true');
});

it('claims the first small horizontal move before native scrolling can take over', () => {
  const {root, panel, main} = setup();
  start(root, 20);
  // Real swipes arrive as small increments, not one 180px jump. The first
  // move must be canceled, or Safari may make subsequent moves non-cancelable.
  expect(move(root, 23)).toBe(false);
  expect(main.style.transform).toBe('translate3d(3px, 0, 0)');
  expect(panel.style.transform).toBe('translate3d(-333px, 0, 0)');
  for (const x of [28, 45, 80, 150, 210]) expect(move(root, x)).toBe(false);
  fireEvent.touchEnd(root, {changedTouches: [point(210)]});
  expect(panel.dataset.open).toBe('true');
  expect(main.style.transform).toBe('');
  expect(panel.style.transform).toBe('');
  start(panel, 260);
  expect(move(panel, 257)).toBe(true);
  expect(main.style.transform).toBe('');
  for (const x of [250, 230, 170, 70]) expect(move(panel, x)).toBe(false);
  fireEvent.touchEnd(panel, {changedTouches: [point(70)]});
  expect(panel.dataset.open).toBe('false');
});

it('preserves navigation taps with small finger jitter and subsequent vertical scrolling', () => {
  const {root, panel, getByText} = setup();
  fireEvent.click(getByText('Menu'));
  const destination = getByText('Destination');
  const clicked = vi.fn();
  destination.addEventListener('click', clicked);
  start(destination, 250);
  for (const x of [249, 248, 247]) expect(move(destination, x)).toBe(true);
  fireEvent.touchEnd(destination, {changedTouches: [point(247)]});
  fireEvent.click(destination);
  expect(clicked).toHaveBeenCalledOnce();
  expect(panel.dataset.open).toBe('true');
  start(destination, 250);
  expect(move(destination, 248)).toBe(true);
  expect(move(destination, 247, 235)).toBe(true);
  expect(move(destination, 100, 235)).toBe(true);
  fireEvent.touchEnd(destination);
  expect(root.dataset.sidebarDragging).toBeUndefined();
  expect(panel.dataset.open).toBe('true');
  // A deliberate close swipe still works when begun on the same link/button.
  start(destination, 250);
  expect(move(destination, 239)).toBe(false);
  expect(move(destination, 50)).toBe(false);
  fireEvent.touchEnd(destination, {changedTouches: [point(50)]});
  expect(panel.dataset.open).toBe('false');
});

it('keeps small diagonal and vertical movements with the scroller and excludes tables and dialogs', () => {
  const {root, panel} = setup();
  start(root, 20);
  expect(move(root, 23, 202)).toBe(true);
  expect(move(root, 25, 240)).toBe(true);
  expect(move(root, 200, 240)).toBe(true);
  fireEvent.touchEnd(root);
  expect(panel.dataset.open).toBe('false');
  const table = document.createElement('div');
  table.className = 'filey-table-scroll';
  root.append(table);
  start(table, 20);
  expect(move(table, 200)).toBe(true);
  fireEvent.touchEnd(table);
  const dialog = document.createElement('div');
  dialog.setAttribute('aria-modal', 'true');
  root.append(dialog);
  start(root, 20);
  expect(move(root, 200)).toBe(true);
  fireEvent.touchEnd(root);
  expect(panel.dataset.open).toBe('false');
  expect(root.dataset.sidebarDragging).toBeUndefined();
});

it.each([0, 8, 15])('reserves the outer edge at x=%i before browser history can claim it', (x) => {
  const { root, panel, getByLabelText } = setup();
  expect(start(root, x)).toBe(false);
  expect(move(root, x + 3)).toBe(false);
  expect(fireEvent.touchEnd(root, { changedTouches: [point(x + 220)], cancelable: true })).toBe(false);
  expect(panel.dataset.open).toBe('true');
  expect(getByLabelText('Current page').textContent).toBe('/invoicing');
});

it('consumes rightward drawer swipes without following the home link, while real taps still navigate', () => {
  const { panel, getByText, getByLabelText } = setup();
  fireEvent.click(getByText('Menu'));
  const home = getByText('Filey home');
  start(home, 24);
  expect(move(home, 80)).toBe(false);
  expect(fireEvent.touchEnd(home, { changedTouches: [point(100)], cancelable: true })).toBe(false);
  fireEvent.click(home);
  expect(panel.dataset.open).toBe('true');
  expect(getByLabelText('Current page').textContent).toBe('/invoicing');
  start(home, 24);
  expect(move(home, 26)).toBe(true);
  fireEvent.touchEnd(home, { changedTouches: [point(26)], cancelable: true });
  fireEvent.click(home);
  expect(getByLabelText('Current page').textContent).toBe('/overview');
});

it('reserves only the outer strip and keeps fields, tables, dialogs and inner-edge scrolling native', () => {
  const { root, panel, getByLabelText } = setup();
  // A vertical touch starting in the reserved 16px strip has its native defaults
  // canceled at start; ordinary page scrolling remains available outside it.
  expect(start(root, 8)).toBe(false);
  expect(move(root, 8, 250)).toBe(true);
  fireEvent.touchEnd(root);
  expect(start(root, 16)).toBe(true);
  expect(move(root, 16, 250)).toBe(true);
  fireEvent.touchEnd(root);
  expect(start(getByLabelText('Search pages'), 8)).toBe(true);
  const table = document.createElement('div');
  table.className = 'filey-table-scroll';
  root.append(table);
  expect(start(table, 8)).toBe(true);
  const dialog = document.createElement('div');
  dialog.setAttribute('aria-modal', 'true');
  root.append(dialog);
  expect(start(root, 8)).toBe(true);
  expect(panel.dataset.open).toBe('false');
});
