import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react';
import { apiClient, type User } from '../api/client';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  needsSetup: boolean;
  login: (name: string, password: string) => Promise<string | null>;
  setup: (name: string, password: string) => Promise<string | null>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      // First check if setup is needed
      const setupResult = await apiClient.checkSetup();
      if (cancelled) return;

      if (setupResult.data?.needsSetup) {
        setNeedsSetup(true);
        setIsLoading(false);
        return;
      }

      // If setup is complete, check for existing auth
      if (!apiClient.hasToken()) {
        setIsLoading(false);
        return;
      }

      const result = await apiClient.getCurrentUser();
      if (cancelled) return;

      if (result.data) {
        setUser(result.data.user);
      } else {
        apiClient.clearToken();
      }
      setIsLoading(false);
    }

    initialize();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = async (name: string, password: string): Promise<string | null> => {
    const result = await apiClient.login(name, password);
    if (result.error) {
      return result.error;
    }
    if (result.data) {
      setUser(result.data.user);
    }
    return null;
  };

  const setup = async (name: string, password: string): Promise<string | null> => {
    const result = await apiClient.setup(name, password);
    if (result.error) {
      return result.error;
    }
    if (result.data) {
      setUser(result.data.user);
      setNeedsSetup(false);
    }
    return null;
  };

  const logout = () => {
    apiClient.clearToken();
    setUser(null);
  };

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated: !!user,
    needsSetup,
    login,
    setup,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
