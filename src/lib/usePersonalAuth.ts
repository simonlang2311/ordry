import { useLayoutEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const DEFAULT_PASSWORD = 'schnitzel';
const AUTH_TOKEN_KEY = 'personal_auth_token';
const AUTH_EXPIRY_KEY = 'personal_auth_expiry';
const AUTH_DURATION = 6 * 60 * 60 * 1000; // 6 Stunden in Millisekunden

export const usePersonalAuth = () => {
  const params = useParams();
  const restaurantParam = params?.restaurantId;
  const restaurantId =
    typeof restaurantParam === 'string'
      ? restaurantParam
      : Array.isArray(restaurantParam)
        ? restaurantParam[0]
        : process.env.NEXT_PUBLIC_RESTAURANT_ID ?? 'demo-restaurant-1';
  const authTokenKey = `${AUTH_TOKEN_KEY}:${restaurantId}`;
  const authExpiryKey = `${AUTH_EXPIRY_KEY}:${restaurantId}`;
  const adminCookieName = `admin_${restaurantId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthInitialized, setIsAuthInitialized] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [personalPassword, setPersonalPassword] = useState(DEFAULT_PASSWORD);

  useLayoutEffect(() => {
    let isActive = true;

    const initializeAuth = async () => {
      setIsAuthInitialized(false);
      setPersonalPassword(DEFAULT_PASSWORD);

      try {
        const { data, error } = await supabase
          .from('settings')
          .select('value')
          .eq('key', 'personal_password')
          .eq('restaurant_id', restaurantId)
          .maybeSingle();

        if (!isActive) {
          return;
        }

        if (error) {
          console.error('Personal-Passwort konnte nicht geladen werden:', error);
        }

        if (data?.value) {
          setPersonalPassword(data.value);
        }

        const token = localStorage.getItem(authTokenKey);
        const expiry = localStorage.getItem(authExpiryKey);

        if (token && expiry) {
          const expiryTime = parseInt(expiry);
          if (Date.now() < expiryTime) {
            setIsAuthenticated(true);
          } else {
            localStorage.removeItem(authTokenKey);
            localStorage.removeItem(authExpiryKey);
            setIsAuthenticated(false);
          }
        } else {
          setIsAuthenticated(false);
        }
      } finally {
        if (isActive) {
          setIsAuthInitialized(true);
        }
      }
    };

    initializeAuth();

    return () => {
      isActive = false;
    };
  }, [authExpiryKey, authTokenKey, restaurantId]);

  const checkAuth = () => {
    const token = localStorage.getItem(authTokenKey);
    const expiry = localStorage.getItem(authExpiryKey);

    if (token && expiry) {
      const expiryTime = parseInt(expiry);
      if (Date.now() < expiryTime) {
        setIsAuthenticated(true);
        return true;
      } else {
        // Abgelaufen
        localStorage.removeItem(authTokenKey);
        localStorage.removeItem(authExpiryKey);
        setIsAuthenticated(false);
        return false;
      }
    }
    return false;
  };

  const handlePasswordSubmit = (password: string): boolean => {
    if (password.trim() === personalPassword.trim()) {
      const now = Date.now();
      const expiryTime = now + AUTH_DURATION;
      localStorage.setItem(authTokenKey, 'authenticated');
      localStorage.setItem(authExpiryKey, expiryTime.toString());
      localStorage.removeItem(AUTH_TOKEN_KEY);
      localStorage.removeItem(AUTH_EXPIRY_KEY);
      // also set a cookie so middleware can identify admin user
      document.cookie = `${adminCookieName}=true; max-age=${AUTH_DURATION / 1000}; path=/`;
      document.cookie = 'admin=; max-age=0; path=/';
      setIsAuthenticated(true);
      setShowPasswordModal(false);
      return true;
    }
    return false;
  };

  const requireAuth = () => {
    if (!checkAuth()) {
      setShowPasswordModal(true);
      return false;
    }
    return true;
  };

  const logout = () => {
    localStorage.removeItem(authTokenKey);
    localStorage.removeItem(authExpiryKey);
    // expire admin cookie
    document.cookie = `${adminCookieName}=; max-age=0; path=/`;
    setIsAuthenticated(false);
  };

  return {
    isAuthenticated,
    isAuthInitialized,
    showPasswordModal,
    setShowPasswordModal,
    handlePasswordSubmit,
    requireAuth,
    logout,
  };
};
