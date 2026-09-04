import { render, screen } from '../../test-utils';
import { HeroSection } from '../HeroSection';
import { apiClient } from '../../api/client';

jest.mock('../../api/client', () => ({
  apiClient: { getImageUrl: jest.fn((id: string, size?: string) => `http://localhost/images/${id}?size=${size}`) },
}));
const mockApi = apiClient as jest.Mocked<typeof apiClient>;

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getImageUrl.mockImplementation(
    (id: string, size?: string) => `http://localhost/images/${id}?size=${size}`
  );
});

describe('HeroSection', () => {
  it('shows what it wraps', () => {
    render(
      <HeroSection>
        <p>Breaking Bad</p>
      </HeroSection>
    );

    expect(screen.getByText('Breaking Bad')).toBeInTheDocument();
  });

  it('asks for a backdrop wide enough to fill the window', () => {
    const { container } = render(
      <HeroSection backdropImageId="img-1">
        <p>Breaking Bad</p>
      </HeroSection>
    );

    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'http://localhost/images/img-1?size=w1280'
    );
  });

  it('leaves the backdrop out of the accessibility tree', () => {
    render(
      <HeroSection backdropImageId="img-1">
        <p>Breaking Bad</p>
      </HeroSection>
    );

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('falls back to a plain dark panel with no backdrop', () => {
    const { container } = render(
      <HeroSection>
        <p>Breaking Bad</p>
      </HeroSection>
    );

    expect(container.querySelector('img')).toBeNull();
    expect(mockApi.getImageUrl).not.toHaveBeenCalled();
  });
});
