import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import App from './App';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './api/queryClient';
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
        <QueryClientProvider client={queryClient}>
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
        </QueryClientProvider>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
);
