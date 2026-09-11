import { GenerateLightchainEntry } from '../components/GenerateLightchainEntry';
import { Header } from '../components/layout/Header';

/**
 * Keep the public entry on the same Lightchain launcher frame as the
 * authenticated parity route. Heavy-specific marketing chrome here used to
 * make the first screen diverge before a user could reach the shared tools.
 */
export function LandingPage() {
  return (
    <div className="min-h-screen bg-[#171b1c] text-white">
      <div className="fixed left-0 right-0 top-0 z-50 bg-[#05090b]/95">
        <Header />
      </div>
      <main className="pt-[70px]">
        <GenerateLightchainEntry />
      </main>
    </div>
  );
}
