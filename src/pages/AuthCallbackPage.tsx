import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Layers } from 'lucide-react';

export function AuthCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) throw error;
        
        if (session) {
          // Check if user profile exists
          const { data: profile } = await supabase
            .from('users')
            .select('*')
            .eq('id', session.user.id)
            .single();
          
          if (!profile) {
            // Create user profile for OAuth users
            await supabase.from('users').insert({
              id: session.user.id,
              email: session.user.email!,
              name: session.user.user_metadata?.full_name || session.user.user_metadata?.name || null,
              avatar_url: session.user.user_metadata?.avatar_url || null,
            });
          }
          
          navigate('/dashboard');
        } else {
          navigate('/login');
        }
      } catch (error) {
        console.error('Auth callback error:', error);
        navigate('/login');
      }
    };

    handleAuthCallback();
  }, [navigate]);

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



