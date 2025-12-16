import { useTranslation } from 'react-i18next';
import {
  Typography,
  Grid,
  Card,
  CardContent,
  CardActionArea,
  CardMedia,
} from '@mui/material';
import { Folder, Tv, Person, Album } from '@mui/icons-material';
import { apiClient, type CollectionType, type Image } from '../api/client';

interface ChildCollection {
  id: string;
  name: string;
  collectionType?: CollectionType;
  images?: Image[];
}

interface ChildCollectionGridProps {
  collections: ChildCollection[];
  parentCollectionType?: CollectionType;
  onCollectionClick: (collectionId: string) => void;
  title?: string;
  fallbackImages?: Image[];
}

function getCollectionIcon(collectionType?: CollectionType) {
  switch (collectionType) {
    case 'Show':
      return <Tv sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />;
    case 'Season':
      return <Folder sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />;
    case 'Artist':
      return <Person sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />;
    case 'Album':
      return <Album sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />;
    default:
      return <Folder sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />;
  }
}

export function ChildCollectionGrid({
  collections,
  parentCollectionType,
  onCollectionClick,
  title,
  fallbackImages,
}: ChildCollectionGridProps) {
  const { t } = useTranslation();

  if (collections.length === 0) return null;

  const getChildLabel = () => {
    switch (parentCollectionType) {
      case 'Show':
        return t('collection.seasons', 'Seasons');
      case 'Artist':
        return t('collection.albums', 'Albums');
      default:
        return t('collection.subfolders', 'Subfolders');
    }
  };

  return (
    <>
      <Typography variant="h6" sx={{ mb: 2 }}>
        {title || getChildLabel()} ({collections.length})
      </Typography>
      <Grid container spacing={2} sx={{ mb: 4 }}>
        {collections.map((child) => {
          // Use child's own image, or fall back to parent's images (e.g., show images for seasons)
          const childImage = child.images?.[0];
          const fallbackImage = fallbackImages?.find((img) => img.imageType === 'Poster') || fallbackImages?.[0];
          const primaryImage = childImage || fallbackImage;
          const hasImage = primaryImage && child.collectionType === 'Season';

          return (
            <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={child.id}>
              <Card
                sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}
              >
                <CardActionArea
                  onClick={() => onCollectionClick(child.id)}
                  sx={{
                    flexGrow: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'stretch',
                  }}
                >
                  {hasImage ? (
                    <>
                      <CardMedia
                        component="img"
                        image={apiClient.getImageUrl(primaryImage.id)}
                        alt={child.name}
                        sx={{
                          aspectRatio: '2/3',
                          objectFit: 'cover',
                        }}
                      />
                      <CardContent sx={{ textAlign: 'center', py: 1 }}>
                        <Typography variant="body2" noWrap title={child.name}>
                          {child.name}
                        </Typography>
                      </CardContent>
                    </>
                  ) : (
                    <CardContent
                      sx={{
                        textAlign: 'center',
                        flexGrow: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                      }}
                    >
                      {getCollectionIcon(child.collectionType)}
                      <Typography variant="body2" noWrap title={child.name}>
                        {child.name}
                      </Typography>
                    </CardContent>
                  )}
                </CardActionArea>
              </Card>
            </Grid>
          );
        })}
      </Grid>
    </>
  );
}
