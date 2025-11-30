import { useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import { Box } from '@mui/material'
import { Header, Sidebar } from './components'
import { SettingsPage } from './pages/SettingsPage'
import { LibrariesPage } from './pages/LibrariesPage'
import { LibraryPage } from './pages/LibraryPage'
import { CollectionPage } from './pages/CollectionPage'
import { MediaPage } from './pages/MediaPage'
import { PlayPage } from './pages/PlayPage'
import { PersonPage } from './pages/PersonPage'

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
      <Header onMenuClick={() => setSidebarOpen(true)} />
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <Box component="main" sx={{ flexGrow: 1 }}>
        <Routes>
          {/* Admin routes */}
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/admin/libraries" element={<LibrariesPage />} />
          {/* Keep old route for backwards compatibility */}
          <Route path="/libraries" element={<LibrariesPage />} />

          {/* Library browsing routes */}
          <Route path="/library/:libraryId" element={<LibraryPage />} />
          <Route path="/collection/:collectionId" element={<CollectionPage />} />
          <Route path="/media/:mediaId" element={<MediaPage />} />
          <Route path="/play/:mediaId" element={<PlayPage />} />
          <Route path="/person/:personId" element={<PersonPage />} />

          <Route path="/" element={<Box />} />
        </Routes>
      </Box>
    </Box>
  )
}

export default App
