import { Suspense, lazy, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { Header, Sidebar } from './components';
import { NavigationLoadingOverlay } from './components/NavigationLoadingOverlay';
import { ActiveLibraryProvider } from './context/ActiveLibraryContext';
import { HomePage } from './pages/HomePage';

// Every page below the landing page is fetched when it is first visited. The
// heavy ones are the reason: the player pulls in hls.js, the queue and user
// collection pages pull in dnd-kit, and the admin pages are rarely opened at
// all. HomePage stays eager because it is what a signed-in user lands on.
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const LibrariesPage = lazy(() => import('./pages/LibrariesPage').then((m) => ({ default: m.LibrariesPage })));
const UsersPage = lazy(() => import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })));
const LibraryPage = lazy(() => import('./pages/LibraryPage').then((m) => ({ default: m.LibraryPage })));
const LibraryScrapeStatusPage = lazy(() =>
  import('./pages/LibraryScrapeStatusPage').then((m) => ({ default: m.LibraryScrapeStatusPage }))
);
const CollectionPage = lazy(() => import('./pages/CollectionPage').then((m) => ({ default: m.CollectionPage })));
const MediaPage = lazy(() => import('./pages/MediaPage').then((m) => ({ default: m.MediaPage })));
const PlayPage = lazy(() => import('./pages/PlayPage').then((m) => ({ default: m.PlayPage })));
const PersonPage = lazy(() => import('./pages/PersonPage').then((m) => ({ default: m.PersonPage })));
const SearchPage = lazy(() => import('./pages/SearchPage').then((m) => ({ default: m.SearchPage })));
const UserCollectionsPage = lazy(() =>
  import('./pages/UserCollectionsPage').then((m) => ({ default: m.UserCollectionsPage }))
);
const UserCollectionPage = lazy(() =>
  import('./pages/UserCollectionPage').then((m) => ({ default: m.UserCollectionPage }))
);
const FavoritesPage = lazy(() => import('./pages/FavoritesPage').then((m) => ({ default: m.FavoritesPage })));
const WatchLaterPage = lazy(() => import('./pages/WatchLaterPage').then((m) => ({ default: m.WatchLaterPage })));
const QueuePage = lazy(() => import('./pages/QueuePage').then((m) => ({ default: m.QueuePage })));

/** Shown only while a page's code is on its way. */
function RouteFallback() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
      <CircularProgress />
    </Box>
  );
}

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <ActiveLibraryProvider>
      <NavigationLoadingOverlay />
      <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <Box component="main" sx={{ flexGrow: 1 }}>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              {/* Admin routes */}
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/admin/libraries" element={<LibrariesPage />} />
              <Route path="/admin/users" element={<UsersPage />} />
              {/* Keep old route for backwards compatibility */}
              <Route path="/libraries" element={<LibrariesPage />} />

              {/* Library browsing routes */}
              <Route path="/library/:libraryId" element={<LibraryPage />} />
              <Route path="/library/:libraryId/metadata" element={<LibraryScrapeStatusPage />} />
              <Route path="/collection/:collectionId" element={<CollectionPage />} />
              <Route path="/media/:mediaId" element={<MediaPage />} />
              <Route path="/play/:mediaId" element={<PlayPage />} />
              <Route path="/person/:personId" element={<PersonPage />} />
              <Route path="/search" element={<SearchPage />} />

              {/* User collections routes */}
              <Route path="/favorites" element={<FavoritesPage />} />
              <Route path="/watch-later" element={<WatchLaterPage />} />
              <Route path="/queue" element={<QueuePage />} />
              <Route path="/my-collections" element={<UserCollectionsPage />} />
              <Route path="/my-collections/:collectionId" element={<UserCollectionPage />} />

              <Route path="/" element={<HomePage />} />
            </Routes>
          </Suspense>
        </Box>
      </Box>
    </ActiveLibraryProvider>
  );
}

export default App;
