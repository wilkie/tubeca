import { useTranslation } from 'react-i18next';
import { Box, Card, CardActionArea, CardContent, CardMedia, IconButton, Stack, Typography } from '@mui/material';
import { Album, CheckBox, CheckBoxOutlineBlank, Folder, Movie, PlayArrow, Tv } from '@mui/icons-material';
import { apiClient, type Collection, type CollectionWatchSummary, type LibraryType } from '../api/client';
import { CardQuickActions } from './CardQuickActions';
import { WatchBadge } from './WatchBadge';

export interface CollectionCardProps {
  collection: Collection;
  libraryType: LibraryType;
  isSelectionMode: boolean;
  isSelected: boolean;
  favorited: boolean;
  inWatchLater: boolean;
  watchSummary?: CollectionWatchSummary;
  onClick: (collectionId: string) => void;
  onAddToCollection: (collection: Collection) => void;
}

/** Artwork is only meaningful for a show or a film; everything else gets an icon. */
function useArtwork(collection: Collection, libraryType: LibraryType) {
  const primaryImage = collection.images?.[0];
  const hasImage = Boolean(primaryImage && (collection.collectionType === 'Show' || libraryType === 'Film'));
  return { primaryImage, hasImage };
}

function PlaceholderIcon({ libraryType, size }: { libraryType: LibraryType; size: number }) {
  const sx = { fontSize: size, color: 'text.secondary' };
  if (libraryType === 'Film') return <Movie sx={sx} />;
  if (libraryType === 'Television') return <Tv sx={sx} />;
  if (libraryType === 'Music') return <Album sx={sx} />;
  return <Folder sx={sx} />;
}

function SelectionMark({ selected, size, offset }: { selected: boolean; size: number; offset: number }) {
  return (
    <Box
      sx={{
        position: 'absolute',
        bottom: offset,
        left: offset,
        bgcolor: 'rgba(0, 0, 0, 0.6)',
        borderRadius: '50%',
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {selected ? (
        <CheckBox sx={{ color: 'primary.main', fontSize: size - 4 }} />
      ) : (
        <CheckBoxOutlineBlank sx={{ color: 'white', fontSize: size - 4 }} />
      )}
    </Box>
  );
}

/** Child counts, shown for everything except films. */
function ChildCounts({ collection, libraryType }: { collection: Collection; libraryType: LibraryType }) {
  const { t } = useTranslation();
  if (libraryType === 'Film' || !collection._count) return null;

  return (
    <>
      {collection._count.children > 0 &&
        (collection.collectionType === 'Show'
          ? t('library.seasons', { count: collection._count.children })
          : t('library.folders', { count: collection._count.children }))}
      {collection._count.children > 0 && collection._count.media > 0 && ' | '}
      {collection._count.media > 0 && t('library.items', { count: collection._count.media })}
    </>
  );
}

const selectionOutline = {
  outline: '3px solid',
  outlineColor: 'primary.main',
  outlineOffset: -3,
};

/** A poster tile, with the rating badges that appear on hover. */
export function CollectionPosterCard(props: CollectionCardProps) {
  const { collection, libraryType, isSelectionMode, isSelected, watchSummary } = props;
  const { primaryImage, hasImage } = useArtwork(collection, libraryType);

  const rating = collection.filmDetails?.rating ?? collection.showDetails?.rating;
  const contentRating = collection.filmDetails?.contentRating;
  const hasRatingInfo = rating != null || contentRating != null;

  const overlayChip = {
    bgcolor: 'rgba(0, 0, 0, 0.75)',
    color: 'white',
    px: 1,
    py: 0.25,
    borderRadius: 0.5,
    fontSize: '0.7rem',
    fontWeight: 600,
  };

  return (
    <Card
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        '&:hover .rating-overlay': { opacity: 1 },
        ...(isSelectionMode && isSelected && selectionOutline),
      }}
    >
      <CardActionArea
        onClick={() => props.onClick(collection.id)}
        sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
      >
        {hasRatingInfo && (
          <Box
            className="rating-overlay"
            sx={{
              position: 'absolute',
              top: 8,
              left: 8,
              zIndex: 2,
              display: 'flex',
              flexDirection: 'column',
              gap: 0.5,
              opacity: 0,
              transition: 'opacity 0.2s ease-in-out',
            }}
          >
            {contentRating && <Box sx={overlayChip}>{contentRating}</Box>}
            {rating != null && (
              <Box sx={{ ...overlayChip, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                ★ {rating.toFixed(1)}
              </Box>
            )}
          </Box>
        )}
        <Box sx={{ position: 'relative' }}>
          {hasImage ? (
            <CardMedia
              component="img"
              image={apiClient.getImageUrl(primaryImage!.id, 'w400')}
              alt={collection.name}
              sx={{ aspectRatio: '2/3', objectFit: 'cover' }}
            />
          ) : (
            <Box
              sx={{
                aspectRatio: '2/3',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: 'action.hover',
              }}
            >
              <PlaceholderIcon libraryType={libraryType} size={64} />
            </Box>
          )}
          <WatchBadge kind="collection" summary={watchSummary} />
          {isSelectionMode && <SelectionMark selected={isSelected} size={28} offset={8} />}
        </Box>
        <CardContent sx={{ textAlign: 'center', py: 1 }}>
          <Typography variant="body2" noWrap title={collection.name}>
            {collection.name}
          </Typography>
          {libraryType !== 'Film' && collection._count && (
            <Typography variant="caption" color="text.secondary">
              <ChildCounts collection={collection} libraryType={libraryType} />
            </Typography>
          )}
        </CardContent>
      </CardActionArea>
      <CardQuickActions
        collectionId={collection.id}
        initialFavorited={props.favorited}
        initialInWatchLater={props.inWatchLater}
        onAddToCollection={() => props.onAddToCollection(collection)}
      />
    </Card>
  );
}

/** A wide row with the description and a play button. */
export function CollectionListCard(props: CollectionCardProps & { onPlay: (collectionId: string) => void }) {
  const { t } = useTranslation();
  const { collection, libraryType, isSelectionMode, isSelected, watchSummary } = props;
  const { primaryImage, hasImage } = useArtwork(collection, libraryType);

  const rating = collection.filmDetails?.rating ?? collection.showDetails?.rating;
  const contentRating = collection.filmDetails?.contentRating;
  const releaseYear =
    collection.filmDetails?.releaseDate?.slice(0, 4) ?? collection.showDetails?.releaseDate?.slice(0, 4);
  const runtime = collection.filmDetails?.runtime;
  const description = collection.filmDetails?.description ?? collection.showDetails?.description;

  return (
    <Card sx={{ display: 'flex', ...(isSelectionMode && isSelected && selectionOutline) }}>
      <CardActionArea
        onClick={() => props.onClick(collection.id)}
        sx={{ flexGrow: 1, display: 'flex', alignItems: 'stretch' }}
      >
        {/* Fixed width from a 2:3 aspect ratio at the row's maximum height. */}
        <Box sx={{ width: 125, flexShrink: 0, flexGrow: 0, position: 'relative' }}>
          {hasImage ? (
            <CardMedia
              component="img"
              image={apiClient.getImageUrl(primaryImage!.id, 'w200')}
              alt={collection.name}
              sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <Box
              sx={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: 'action.hover',
              }}
            >
              <PlaceholderIcon libraryType={libraryType} size={32} />
            </Box>
          )}
          <WatchBadge kind="collection" summary={watchSummary} />
          {isSelectionMode && <SelectionMark selected={isSelected} size={24} offset={4} />}
        </Box>

        <CardContent sx={{ py: 1.5, px: 2, flexGrow: 1 }}>
          <Typography variant="subtitle1" fontWeight="medium">
            {collection.name}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
            {releaseYear && (
              <Typography variant="caption" color="text.secondary">
                {releaseYear}
              </Typography>
            )}
            {contentRating && (
              <Typography variant="caption" sx={{ bgcolor: 'action.selected', px: 0.5, borderRadius: 0.5 }}>
                {contentRating}
              </Typography>
            )}
            {runtime && (
              <Typography variant="caption" color="text.secondary">
                {Math.floor(runtime / 60)}h {runtime % 60}m
              </Typography>
            )}
            {rating != null && (
              <Typography variant="caption" color="text.secondary">
                ★ {rating.toFixed(1)}
              </Typography>
            )}
            {libraryType !== 'Film' && collection._count && (
              <Typography variant="caption" color="text.secondary">
                {collection._count.children > 0 &&
                  (collection.collectionType === 'Show'
                    ? t('library.seasons', { count: collection._count.children })
                    : t('library.folders', { count: collection._count.children }))}
                {collection._count.children > 0 && collection._count.media > 0 && ' • '}
                {collection._count.media > 0 && t('library.items', { count: collection._count.media })}
              </Typography>
            )}
          </Stack>
          {description && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {description}
            </Typography>
          )}
        </CardContent>
      </CardActionArea>

      <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 0.5 }}>
        <IconButton
          color="primary"
          onClick={() => props.onPlay(collection.id)}
          aria-label={t('common.play', 'Play')}
          sx={{ width: 40, height: 56, borderRadius: 0.5 }}
        >
          <PlayArrow sx={{ fontSize: 28 }} />
        </IconButton>
        <CardQuickActions
          collectionId={collection.id}
          initialFavorited={props.favorited}
          initialInWatchLater={props.inWatchLater}
          onAddToCollection={() => props.onAddToCollection(collection)}
          variant="inline"
        />
      </Box>
    </Card>
  );
}
