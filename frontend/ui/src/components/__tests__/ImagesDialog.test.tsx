import { render, screen } from '../../test-utils';
import userEvent from '@testing-library/user-event';
import { ImagesDialog } from '../ImagesDialog';
import type { Image } from '../../api/client';

// Mock apiClient
jest.mock('../../api/client', () => ({
  apiClient: {
    getImageUrl: jest.fn((id: string) => `http://localhost/api/images/${id}`),
  },
}));

// Sample image data
const mockImages: Image[] = [
  {
    id: 'img-1',
    mediaId: null,
    collectionId: 'col-1',
    personId: null,
    showCreditId: null,
    creditId: null,
    imageType: 'Poster',
    path: '/images/poster.jpg',
    width: 800,
    height: 1200,
    format: 'jpeg',
    fileSize: 102400, // 100 KB
    sourceUrl: null,
    scraperId: null,
    isPrimary: true,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'img-2',
    mediaId: null,
    collectionId: 'col-1',
    personId: null,
    showCreditId: null,
    creditId: null,
    imageType: 'Backdrop',
    path: '/images/backdrop.jpg',
    width: 1920,
    height: 1080,
    format: 'jpeg',
    fileSize: 2097152, // 2 MB
    sourceUrl: null,
    scraperId: null,
    isPrimary: false,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'img-3',
    mediaId: null,
    collectionId: 'col-1',
    personId: null,
    showCreditId: null,
    creditId: null,
    imageType: 'Logo',
    path: '/images/logo.png',
    width: null,
    height: null,
    format: null,
    fileSize: null,
    sourceUrl: null,
    scraperId: null,
    isPrimary: false,
    createdAt: '',
    updatedAt: '',
  },
];

describe('ImagesDialog', () => {
  const mockOnClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders dialog with default title', () => {
      render(<ImagesDialog open={true} onClose={mockOnClose} images={mockImages} />);

      expect(screen.getByText('Images')).toBeInTheDocument();
    });

    it('renders dialog with custom title', () => {
      render(<ImagesDialog open={true} onClose={mockOnClose} images={mockImages} title="Movie Posters" />);

      expect(screen.getByText('Movie Posters')).toBeInTheDocument();
    });

    it('renders close button', () => {
      render(<ImagesDialog open={true} onClose={mockOnClose} images={mockImages} />);

      expect(screen.getByTestId('CloseIcon')).toBeInTheDocument();
    });

    it('shows no images message when images array is empty', () => {
      render(<ImagesDialog open={true} onClose={mockOnClose} images={[]} />);

      expect(screen.getByText('No images available.')).toBeInTheDocument();
    });

    it('does not render content when closed', () => {
      render(<ImagesDialog open={false} onClose={mockOnClose} images={mockImages} />);

      expect(screen.queryByText('Images')).not.toBeInTheDocument();
    });
  });

  describe('image display', () => {
    it('renders all images', () => {
      render(<ImagesDialog open={true} onClose={mockOnClose} images={mockImages} />);

      const images = screen.getAllByRole('img');
      expect(images).toHaveLength(3);
    });

    it('uses correct image URLs', () => {
      render(<ImagesDialog open={true} onClose={mockOnClose} images={mockImages} />);

      const images = screen.getAllByRole('img');
      expect(images[0]).toHaveAttribute('src', 'http://localhost/api/images/img-1');
      expect(images[1]).toHaveAttribute('src', 'http://localhost/api/images/img-2');
    });

    it('shows image type as alt text', () => {
      render(<ImagesDialog open={true} onClose={mockOnClose} images={mockImages} />);

      expect(screen.getByAltText('Poster')).toBeInTheDocument();
      expect(screen.getByAltText('Backdrop')).toBeInTheDocument();
      expect(screen.getByAltText('Logo')).toBeInTheDocument();
    });

    it('shows image type chips', () => {
      render(<ImagesDialog open={true} onClose={mockOnClose} images={mockImages} />);

      expect(screen.getByText('Poster')).toBeInTheDocument();
      expect(screen.getByText('Backdrop')).toBeInTheDocument();
      expect(screen.getByText('Logo')).toBeInTheDocument();
    });

    it('shows primary chip with filled style', () => {
      render(<ImagesDialog open={true} onClose={mockOnClose} images={mockImages} />);

      const posterChip = screen.getByText('Poster').closest('.MuiChip-root');
      expect(posterChip).toHaveClass('MuiChip-colorPrimary');
      expect(posterChip).toHaveClass('MuiChip-filled');
    });

    it('shows non-primary chip with outlined style', () => {
      render(<ImagesDialog open={true} onClose={mockOnClose} images={mockImages} />);

      const backdropChip = screen.getByText('Backdrop').closest('.MuiChip-root');
      expect(backdropChip).toHaveClass('MuiChip-outlined');
    });

    it('shows image dimensions', () => {
      render(<ImagesDialog open={true} onClose={mockOnClose} images={mockImages} />);

      expect(screen.getByText(/800×1200/)).toBeInTheDocument();
      expect(screen.getByText(/1920×1080/)).toBeInTheDocument();
    });

    it('shows formatted file size', () => {
      render(<ImagesDialog open={true} onClose={mockOnClose} images={mockImages} />);

      expect(screen.getByText(/100\.0 KB/)).toBeInTheDocument();
      expect(screen.getByText(/2\.0 MB/)).toBeInTheDocument();
    });

    it('does not show dimensions/size section for images without metadata', () => {
      const imageWithoutMeta: Image[] = [{
        id: 'img-no-meta',
        mediaId: null,
        collectionId: null,
        personId: null,
        showCreditId: null,
        creditId: null,
        imageType: 'Poster',
        path: '/images/image.jpg',
        width: null,
        height: null,
        format: null,
        fileSize: null,
        sourceUrl: null,
        scraperId: null,
        isPrimary: false,
        createdAt: '',
        updatedAt: '',
      }];

      render(<ImagesDialog open={true} onClose={mockOnClose} images={imageWithoutMeta} />);

      // Should only have the chip, no dimensions/size text
      expect(screen.getByText('Poster')).toBeInTheDocument();
      expect(screen.queryByText(/×/)).not.toBeInTheDocument();
    });
  });

  describe('file size formatting', () => {
    const createImageWithSize = (id: string, fileSize: number | null): Image => ({
      id,
      mediaId: null,
      collectionId: null,
      personId: null,
      showCreditId: null,
      creditId: null,
      imageType: 'Poster',
      path: '/images/image.jpg',
      width: null,
      height: null,
      format: null,
      fileSize,
      sourceUrl: null,
      scraperId: null,
      isPrimary: false,
      createdAt: '',
      updatedAt: '',
    });

    it('formats bytes correctly', () => {
      render(<ImagesDialog open={true} onClose={mockOnClose} images={[createImageWithSize('img-bytes', 500)]} />);

      expect(screen.getByText('500 B')).toBeInTheDocument();
    });

    it('formats kilobytes correctly', () => {
      render(<ImagesDialog open={true} onClose={mockOnClose} images={[createImageWithSize('img-kb', 5120)]} />);

      expect(screen.getByText('5.0 KB')).toBeInTheDocument();
    });

    it('formats megabytes correctly', () => {
      render(<ImagesDialog open={true} onClose={mockOnClose} images={[createImageWithSize('img-mb', 5242880)]} />);

      expect(screen.getByText('5.0 MB')).toBeInTheDocument();
    });

    it('formats gigabytes correctly', () => {
      render(<ImagesDialog open={true} onClose={mockOnClose} images={[createImageWithSize('img-gb', 2147483648)]} />);

      expect(screen.getByText('2.0 GB')).toBeInTheDocument();
    });
  });

  describe('interaction', () => {
    it('calls onClose when close button is clicked', async () => {
      const user = userEvent.setup();

      render(<ImagesDialog open={true} onClose={mockOnClose} images={mockImages} />);

      const closeButton = screen.getByTestId('CloseIcon').closest('button');
      await user.click(closeButton!);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when backdrop is clicked', async () => {
      const user = userEvent.setup();

      render(<ImagesDialog open={true} onClose={mockOnClose} images={mockImages} />);

      const backdrop = document.querySelector('.MuiBackdrop-root');
      if (backdrop) {
        await user.click(backdrop);
        expect(mockOnClose).toHaveBeenCalled();
      }
    });
  });
});
