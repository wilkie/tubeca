import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import App from './App';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';
import { AuthProvider } from './context/AuthContext';
import { PlayerProvider } from './context/PlayerContext';
import { ScrollRestorationProvider } from './context/ScrollRestorationContext';
import { ProtectedRoute } from './components';
import { theme } from './theme';
import './i18n';
import './index.scss';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <ScrollRestorationProvider>
                    <PlayerProvider>
                      <App />
                    </PlayerProvider>
                  </ScrollRestorationProvider>
                </ProtectedRoute>
              }
            />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
);
