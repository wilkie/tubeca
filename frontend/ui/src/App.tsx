import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Box } from '@mui/material';
import { Header, Sidebar } from './components';
import { ActiveLibraryProvider } from './context/ActiveLibraryContext';
import { SettingsPage } from './pages/SettingsPage';
import { LibrariesPage } from './pages/LibrariesPage';
import { UsersPage } from './pages/UsersPage';
import { LibraryPage } from './pages/LibraryPage';
import { CollectionPage } from './pages/CollectionPage';
import { MediaPage } from './pages/MediaPage';
import { PlayPage } from './pages/PlayPage';
import { PersonPage } from './pages/PersonPage';
import { SearchPage } from './pages/SearchPage';
import { UserCollectionsPage } from './pages/UserCollectionsPage';
import { UserCollectionPage } from './pages/UserCollectionPage';
import { FavoritesPage } from './pages/FavoritesPage';
import { WatchLaterPage } from './pages/WatchLaterPage';
import { QueuePage } from './pages/QueuePage';

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <ActiveLibraryProvider>
      <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <Box component="main" sx={{ flexGrow: 1 }}>
          <Routes>
          {/* Admin routes */}
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/admin/libraries" element={<LibrariesPage />} />
          <Route path="/admin/users" element={<UsersPage />} />
          {/* Keep old route for backwards compatibility */}
          <Route path="/libraries" element={<LibrariesPage />} />

          {/* Library browsing routes */}
          <Route path="/library/:libraryId" element={<LibraryPage />} />
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

            <Route path="/" element={<Box />} />
          </Routes>
        </Box>
      </Box>
    </ActiveLibraryProvider>
  );
}

export default App;
