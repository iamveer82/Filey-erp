import { useRef, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useSidebarSwipe } from '../useSidebarSwipe';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function Drawer({ enabled = true }: { enabled?: boolean }) {
  const root = useRef<HTMLDivElement>(null), panel = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  useSidebarSwipe(root, panel, enabled, open, setOpen);
  return <div ref={root} data-testid="root" data-sidebar-open={open}><div className="workspace-drawer-backdrop" /><aside ref={panel} data-testid="drawer" data-open={open}><button>Destination</button><input aria-label="Search pages" /></aside><div className="workspace-main"><button onClick={() => setOpen(true)}>Menu</button></div></div>;
}
const point = (x: number, y = 200) => ({ identifier: 1, clientX: x, clientY: y });
function start(target: Element, x: number, y = 200) { fireEvent.touchStart(target, { touches: [point(x, y)] }); }
function move(target: Element, x: number, y = 200) { fireEvent.touchMove(target, { touches: [point(x, y)], cancelable: true }); }
function setup(enabled = true) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 336 } as DOMRect);
  const view = render(<Drawer enabled={enabled} />);
  return { ...view, root: view.getByTestId('root'), panel: view.getByTestId('drawer') };
}
it('follows an edge swipe, opens on release, and closes with a left swipe without activating links', () => {
  const {root, panel, getByText} = setup();
  start(root, 20); move(root, 200);
  expect(root.style.getPropertyValue('--workspace-reveal')).toBe('180px');
  expect(root.dataset.sidebarDragging).toBe('true');
  expect(panel.dataset.open).toBe('false');
  fireEvent.touchEnd(root);
  expect(panel.dataset.open).toBe('true');
  expect(root.style.getPropertyValue('--workspace-reveal')).toBe('');
  expect(root.dataset.sidebarDragging).toBeUndefined();
  const clicked = vi.fn(); getByText('Destination').addEventListener('click', clicked);
  start(getByText('Destination'), 260); move(panel, 50);
  expect(root.style.getPropertyValue('--workspace-reveal')).toBe('126px');
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
  const {root, panel, rerender} = setup();
  start(root, 20); move(root, 200); fireEvent.touchCancel(root);
  expect(panel.dataset.open).toBe('false'); expect(root.style.getPropertyValue('--workspace-reveal')).toBe('');
  expect(root.dataset.sidebarDragging).toBeUndefined();
  start(root, 20); move(root, 200); fireEvent.touchStart(root, {touches: [point(200), {...point(250), identifier: 2}]}); fireEvent.touchEnd(root);
  expect(panel.dataset.open).toBe('false');
  rerender(<Drawer enabled={false} />);
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
  const {root, panel, getByText} = setup();
  start(root, 20); move(root, 200);
  fireEvent.touchEnd(root, {changedTouches: [point(28)]});
  expect(panel.dataset.open).toBe('false');
  start(root, 20); move(root, 200);
  fireEvent(window, new Event('resize'));
  expect(root.dataset.sidebarDragging).toBeUndefined();
  expect(root.style.getPropertyValue('--workspace-reveal')).toBe('');
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
