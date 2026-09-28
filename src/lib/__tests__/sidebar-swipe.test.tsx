import { useRef, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useSidebarSwipe } from '../useSidebarSwipe';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function Drawer({ enabled = true }: { enabled?: boolean }) {
  const root = useRef<HTMLDivElement>(null), panel = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  useSidebarSwipe(root, panel, enabled, open, setOpen);
  return <div ref={root} data-testid="root"><div className="workspace-drawer-backdrop" /><aside ref={panel} data-testid="drawer" data-open={open}><button>Destination</button><input aria-label="Search pages" /></aside><button onClick={() => setOpen(true)}>Menu</button></div>;
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
  expect(panel.style.transform).toBe('translate3d(-156px, 0, 0)');
  expect(panel.dataset.open).toBe('false');
  fireEvent.touchEnd(root);
  expect(panel.dataset.open).toBe('true');
  expect(panel.style.transform).toBe('');
  const clicked = vi.fn(); getByText('Destination').addEventListener('click', clicked);
  start(getByText('Destination'), 260); move(panel, 50); fireEvent.touchEnd(panel);
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
  expect(panel.dataset.open).toBe('false'); expect(panel.style.transform).toBe('');
  start(root, 20); move(root, 200); fireEvent.touchStart(root, {touches: [point(200), {...point(250), identifier: 2}]}); fireEvent.touchEnd(root);
  expect(panel.dataset.open).toBe('false');
  rerender(<Drawer enabled={false} />);
  start(root, 20); move(root, 250); fireEvent.touchEnd(root);
  expect(panel.dataset.open).toBe('false');
});
