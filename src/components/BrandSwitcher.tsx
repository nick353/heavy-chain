import { useState, useEffect, useMemo, useRef } from 'react';
import { ChevronDown, Plus, Check, Building2 } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import type { Brand } from '../types/database';
import { cloudflareDataPlane } from '../lib/cloudflareApi';

export function BrandSwitcher() {
  const {
    user,
    currentBrand,
    accessibleBrands,
    brandState,
    refreshCurrentBrand,
    setCurrentBrand,
  } = useAuthStore();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [failedLogoUrls, setFailedLogoUrls] = useState<Set<string>>(() => new Set());
  const [resolvedLogoUrls, setResolvedLogoUrls] = useState<Record<string, string>>({});
  const dropdownRef = useRef<HTMLDivElement>(null);
  const userId = user?.id;

  useEffect(() => {
    if (!userId) {
      setIsLoading(false);
      return;
    }
    void refreshCurrentBrand();
  }, [refreshCurrentBrand, userId]);

  const brands = useMemo(
    () => brandState.status === 'success_nonempty' ? accessibleBrands : [],
    [accessibleBrands, brandState.status],
  );
  useEffect(() => {
    setIsLoading(brandState.status === 'pending');
  }, [brandState.status]);

  useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];
    void Promise.all(brands.map(async (brand) => {
      const source = brand.logo_url;
      if (!source || !cloudflareDataPlane || !source.startsWith('media/v1/')) {
        return [brand.id, source ?? ''] as const;
      }
      try {
        const url = await cloudflareDataPlane.readMediaObjectUrl(source);
        objectUrls.push(url);
        return [brand.id, url] as const;
      } catch {
        return [brand.id, ''] as const;
      }
    })).then((entries) => {
      if (!cancelled) setResolvedLogoUrls(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [brands]);

  const logoUrlFor = (brand: Brand | null): string | null => {
    if (!brand?.logo_url) return null;
    if (cloudflareDataPlane && brand.logo_url.startsWith('media/v1/')) {
      return resolvedLogoUrls[brand.id] || null;
    }
    return brand.logo_url;
  };

  const markLogoFailed = (url: string) => {
    setFailedLogoUrls((current) => {
      if (current.has(url)) return current;
      const next = new Set(current);
      next.add(url);
      return next;
    });
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectBrand = (brand: Brand) => {
    setCurrentBrand(brand);
    setIsOpen(false);
  };

  if (isLoading) {
    return (
      <div className="h-10 w-40 bg-neutral-100 rounded-lg animate-pulse" />
    );
  }

  if (brands.length === 0) {
    return null;
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 bg-white border border-neutral-200 rounded-lg hover:bg-neutral-50 transition-colors min-w-[160px]"
      >
        <div className="w-6 h-6 rounded bg-primary-100 flex items-center justify-center flex-shrink-0">
          {logoUrlFor(currentBrand) && !failedLogoUrls.has(logoUrlFor(currentBrand)!) ? (
            <img 
              src={logoUrlFor(currentBrand)!}
              alt="" 
              className="w-full h-full rounded object-cover"
              onError={() => markLogoFailed(logoUrlFor(currentBrand)!)}
            />
          ) : (
            <span className="text-xs font-bold text-primary-600">
              {currentBrand?.name?.charAt(0) || 'B'}
            </span>
          )}
        </div>
        <span className="text-sm font-medium text-neutral-700 truncate flex-1 text-left">
          {currentBrand?.name || 'ブランドを選択'}
        </span>
        <ChevronDown className={`w-4 h-4 text-neutral-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-white rounded-xl shadow-elegant border border-neutral-100 py-2 z-50">
          <div className="px-3 py-2 border-b border-neutral-100">
            <p className="text-xs font-medium text-neutral-500">ブランド切り替え</p>
          </div>
          
          <div className="max-h-60 overflow-y-auto py-1">
            {brands.map((brand) => (
              <button
                key={brand.id}
                onClick={() => handleSelectBrand(brand)}
                className={`
                  w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-neutral-50 transition-colors
                  ${currentBrand?.id === brand.id ? 'bg-primary-50' : ''}
                `}
              >
                <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center flex-shrink-0">
                  {logoUrlFor(brand) && !failedLogoUrls.has(logoUrlFor(brand)!) ? (
                    <img 
                      src={logoUrlFor(brand)!}
                      alt="" 
                      className="w-full h-full rounded-lg object-cover"
                      onError={() => markLogoFailed(logoUrlFor(brand)!)}
                    />
                  ) : (
                    <Building2 className="w-4 h-4 text-primary-600" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-neutral-800 truncate">
                    {brand.name}
                  </p>
                  {brand.target_audience && (
                    <p className="text-xs text-neutral-500 truncate">
                      {brand.target_audience}
                    </p>
                  )}
                </div>
                {currentBrand?.id === brand.id && (
                  <Check className="w-4 h-4 text-primary-600 flex-shrink-0" />
                )}
              </button>
            ))}
          </div>

          <div className="border-t border-neutral-100 pt-1 mt-1">
            <button
              onClick={() => {
                setIsOpen(false);
                // Navigate to create brand or open modal
                window.location.href = '/dashboard?newBrand=true';
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-primary-600 hover:bg-primary-50 transition-colors"
            >
              <Plus className="w-4 h-4" />
              新しいブランドを作成
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
