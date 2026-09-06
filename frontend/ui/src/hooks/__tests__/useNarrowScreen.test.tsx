import { DEFAULT_VIEWPORT_WIDTH, render, screen, setViewportWidth } from '../../test-utils';
import { useNarrowScreen } from '../useNarrowScreen';

function Probe() {
  return <span data-testid="answer">{useNarrowScreen() ? 'narrow' : 'wide'}</span>;
}

const answer = () => screen.getByTestId('answer').textContent;

afterEach(() => setViewportWidth(DEFAULT_VIEWPORT_WIDTH));

describe('useNarrowScreen', () => {
  it('is false on a desktop', () => {
    render(<Probe />);

    expect(answer()).toBe('wide');
  });

  it('is true on a phone', () => {
    setViewportWidth(390);
    render(<Probe />);

    expect(answer()).toBe('narrow');
  });

  it('turns over at MUI\'s sm breakpoint, 600px', () => {
    setViewportWidth(599);
    render(<Probe />);
    expect(answer()).toBe('narrow');

    setViewportWidth(601);
    expect(answer()).toBe('wide');
  });

  it('follows the window as it changes', () => {
    render(<Probe />);
    expect(answer()).toBe('wide');

    setViewportWidth(400);
    expect(answer()).toBe('narrow');

    setViewportWidth(1200);
    expect(answer()).toBe('wide');
  });
});
