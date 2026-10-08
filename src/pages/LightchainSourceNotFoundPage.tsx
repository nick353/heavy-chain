import { useEffect } from 'react';
import { Link } from 'react-router-dom';

export function LightchainSourceNotFoundPage() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = '404: This page could not be found.';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <main className="flex min-h-[calc(100vh-50px)] items-center justify-center bg-[#101516] px-6 text-white" data-testid="lightchain-source-not-found">
      <section className="text-center">
        <p className="text-5xl font-semibold tracking-tight">404</p>
        <h1 className="mt-3 text-lg font-semibold">This page could not be found.</h1>
        <Link to="/designProduction" className="mt-6 inline-block text-sm text-[#5fcfc4] underline-offset-4 hover:underline" data-testid="not-found-home">ホームに戻る</Link>
      </section>
    </main>
  );
}
