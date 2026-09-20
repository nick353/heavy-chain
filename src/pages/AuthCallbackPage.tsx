import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../lib/auth';
import { Layers } from 'lucide-react';
import { ensureUserProfile, useAuthStore } from '../stores/authStore';

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const adoptAuthenticatedSession = useAuthStore((state) => state.adoptAuthenticatedSession);

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        const { data: { session }, error } = await auth.getSession();
        
        if (error) throw error;
        
        if (session?.user) {
          let profile = null;
          try {
            profile = await ensureUserProfile(session.user);
          } catch (profileError) {
            // A valid auth session must not be downgraded to "not logged in"
            // just because the optional profile read is slow or
            // temporarily unavailable. The protected workspace resolves its
            // brand/profile state separately and shows its own gate.
            console.warn('Auth callback profile hydration deferred:', profileError);
          }
          adoptAuthenticatedSession(session.user, profile);

          navigate('/designProduction', { replace: true });
        } else {
          navigate('/login');
        }
      } catch (error) {
        console.error('Auth callback error:', error);
        navigate('/login');
      }
    };

    handleAuthCallback();
  }, [adoptAuthenticatedSession, navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-50 via-primary-50/30 to-accent-50/20 flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 bg-gradient-to-br from-primary-700 to-accent-600 rounded-2xl flex items-center justify-center shadow-elegant mx-auto mb-6 animate-pulse">
          <Layers className="w-9 h-9 text-white" />
        </div>
        <div className="spinner mx-auto mb-4" />
        <p className="text-neutral-600">認証中...</p>
      </div>
    </div>
  );
}
