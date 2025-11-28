import { useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import { Box } from '@mui/material'
import { Header, Sidebar } from './components'
import { SettingsPage } from './pages/SettingsPage'
import { LibrariesPage } from './pages/LibrariesPage'

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
      <Header onMenuClick={() => setSidebarOpen(true)} />
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <Box component="main" sx={{ flexGrow: 1 }}>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/libraries" element={<LibrariesPage />} />
          <Route path="/" element={<Box />} />
        </Routes>
      </Box>
    </Box>
  )
}

export default App
