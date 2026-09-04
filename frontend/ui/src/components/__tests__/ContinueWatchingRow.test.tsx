import { render, screen } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import type { ContinueWatchingEntry } from '../../api/client';
import { ContinueWatchingRow } from '../ContinueWatchingRow';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

beforeEach(() => jest.clearAllMocks());

function image(id: string, imageType: string) {
  return { id, imageType, path: `${id}.jpg`, isPrimary: true } as never;
}

function entry(overrides: Record<string, unknown> = {}): ContinueWatchingEntry {
  return {
    progress: { position: 600, duration: 1800 },
    media: {
      id: 'media-1',
      name: 'Heat',
      images: [],
      collection: { id: 'col-1', name: 'Heat (1995)', images: [] },
      ...overrides,
    },
  } as never;
}

describe('ContinueWatchingRow', () => {
  it('renders nothing when nothing is in progress', () => {
    const { container } = render(<ContinueWatchingRow items={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('heads the strip and names each card', () => {
    render(<ContinueWatchingRow items={[entry()]} />);

    expect(screen.getByRole('heading', { name: /continue watching/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Heat' })).toBeInTheDocument();
  });

  it('resumes the media when a card is clicked', async () => {
    const user = userEvent.setup();
    render(<ContinueWatchingRow items={[entry()]} />);

    await user.click(screen.getByRole('button', { name: 'Heat' }));

    expect(mockNavigate).toHaveBeenCalledWith('/play/media-1');
  });

  it('shows how far in it is and how much is left', () => {
    render(<ContinueWatchingRow items={[entry()]} />);

    expect(screen.getByRole('progressbar', { name: '33%' })).toBeInTheDocument();
    expect(screen.getByText('20m 0s left')).toBeInTheDocument();
  });

  it('is not thrown by a progress row with no duration', () => {
    render(
      <ContinueWatchingRow
        items={[{ ...entry(), progress: { position: 0, duration: 0 } } as never]}
      />
    );

    expect(screen.getByRole('progressbar', { name: '0%' })).toBeInTheDocument();
  });

  it('never runs past the end of the bar', () => {
    render(
      <ContinueWatchingRow
        items={[{ ...entry(), progress: { position: 2000, duration: 1800 } } as never]}
      />
    );

    expect(screen.getByRole('progressbar', { name: '100%' })).toBeInTheDocument();
    expect(screen.getByText('0s left')).toBeInTheDocument();
  });

  it('names an episode by its show and its number', () => {
    render(
      <ContinueWatchingRow
        items={[
          entry({
            name: 'Cat in the Bag',
            videoDetails: { season: 1, episode: 3 },
            collection: {
              id: 'season-1',
              name: 'Season 1',
              images: [],
              parent: { id: 'show-1', name: 'Breaking Bad', images: [] },
            },
          }),
        ]}
      />
    );

    expect(screen.getByText('Breaking Bad · S1E3')).toBeInTheDocument();
  });

  it('names a film by its collection', () => {
    render(<ContinueWatchingRow items={[entry()]} />);

    expect(screen.getByText('Heat (1995)')).toBeInTheDocument();
  });

  it('prefers the show backdrop over anything nearer the media', () => {
    const { container } = render(
      <ContinueWatchingRow
        items={[
          entry({
            images: [image('media-poster', 'Poster')],
            collection: {
              id: 'season-1',
              name: 'Season 1',
              images: [image('season-backdrop', 'Backdrop')],
              parent: {
                id: 'show-1',
                name: 'Breaking Bad',
                images: [image('show-backdrop', 'Backdrop')],
              },
            },
          }),
        ]}
      />
    );

    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      expect.stringContaining('show-backdrop')
    );
  });

  it('settles for a poster when no backdrop exists anywhere', () => {
    const { container } = render(
      <ContinueWatchingRow items={[entry({ images: [image('media-poster', 'Poster')] })]} />
    );

    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      expect.stringContaining('media-poster')
    );
  });

  it('shows a bare card when there is no artwork at all', () => {
    const { container } = render(<ContinueWatchingRow items={[entry()]} />);

    expect(container.querySelector('img')).toBeNull();
  });
});
