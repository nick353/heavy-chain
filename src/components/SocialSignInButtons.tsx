import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../stores/authStore';
import { getAuthErrorMessage } from '../lib/authErrorMessage';

type Providers = { google: boolean; apple: boolean };

let cached: Promise<Providers> | null = null;
/** Shown below the email form. The auth worker reports which providers have credentials; only those buttons are shown. */
function loadProviders(): Promise<Providers> {
  cached ??= fetch('/api/auth/providers', { credentials: 'same-origin' })
    .then(async (response) => {
      if (!response.ok) return { google: false, apple: false };
      const body = await response.json() as Partial<Providers>;
      return { google: body.google === true, apple: body.apple === true };
    })
    .catch(() => ({ google: false, apple: false }));
  return cached;
}

export function SocialSignInButtons() {
  const { signInWithGoogle, signInWithApple, isLoading } = useAuthStore();
  const [providers, setProviders] = useState<Providers>({ google: false, apple: false });

  useEffect(() => {
    let active = true;
    void loadProviders().then((value) => { if (active) setProviders(value); });
    return () => { active = false; };
  }, []);

  if (!providers.google && !providers.apple) return null;

  const run = async (signIn: () => Promise<void>, fallback: string) => {
    try {
      await signIn();
    } catch (error) {
      toast.error(getAuthErrorMessage(error, fallback));
    }
  };

  return (
    <div data-testid="social-sign-in">
      <div className="my-6 flex items-center gap-4">
        <div className="h-px flex-1 bg-white/10" />
        <span className="text-sm text-neutral-500">または</span>
        <div className="h-px flex-1 bg-white/10" />
      </div>
      <div className="space-y-3">
        {providers.google && (
          <button
            type="button"
            data-testid="social-sign-in-google"
            onClick={() => void run(signInWithGoogle, 'Googleログインに失敗しました')}
            disabled={isLoading}
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-white/15 bg-white px-4 py-3 font-medium text-neutral-800 transition hover:bg-neutral-100 disabled:opacity-60"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8Z" />
              <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z" />
              <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
              <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z" />
            </svg>
            Googleで続ける
          </button>
        )}
        {providers.apple && (
          <button
            type="button"
            data-testid="social-sign-in-apple"
            onClick={() => void run(signInWithApple, 'Appleログインに失敗しました')}
            disabled={isLoading}
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-white/15 bg-black px-4 py-3 font-medium text-white transition hover:bg-neutral-900 disabled:opacity-60"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
            </svg>
            Appleで続ける
          </button>
        )}
      </div>
    </div>
  );
}
