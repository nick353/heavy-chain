import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, CreditCard, Gauge, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';

const FREE_PLAN_QUOTA = 25;

type UsageStatus = 'reserved' | 'succeeded' | 'failed' | 'released';

interface UsageEventRow {
  units: number | null;
  status: UsageStatus | string | null;
}

interface PlanRow {
  id: string;
  code: string | null;
  name: string | null;
  monthly_quota: number | null;
}

interface BrandSubscriptionRow {
  plan_id: string | null;
  quota_override: number | null;
  status: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
}

interface UsageSummaryRow {
  plan_code: string | null;
  monthly_quota: number | null;
  used_units: number | null;
  reserved_units: number | null;
  remaining_units: number | null;
}

interface QuotaSummary {
  remainingUnits: number;
  usedUnits: number;
  reservedUnits: number;
  monthlyQuota: number;
  planName: string;
}

interface UsageStatsProps {
  className?: string;
}

const toNumber = (value: unknown, fallback = 0) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
};

const getPlanLabel = (plan: PlanRow | null) => {
  if (!plan) return 'Free';
  return plan.name || plan.code || 'Free';
};

const getPlanCodeLabel = (planCode: string | null | undefined) => {
  switch (planCode) {
    case 'pro':
      return 'Pro';
    case 'business':
      return 'Business';
    case 'free':
    default:
      return 'Free';
  }
};

export function UsageStats({ className }: UsageStatsProps) {
  const { currentBrand } = useAuthStore();
  const [summary, setSummary] = useState<QuotaSummary>({
    remainingUnits: FREE_PLAN_QUOTA,
    usedUnits: 0,
    reservedUnits: 0,
    monthlyQuota: FREE_PLAN_QUOTA,
    planName: 'Free',
  });
  const [isLoading, setIsLoading] = useState(true);

  const fetchUsageSummary = useCallback(async () => {
    if (!currentBrand) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    const fallbackPeriodStart = new Date();
    fallbackPeriodStart.setDate(1);
    fallbackPeriodStart.setHours(0, 0, 0, 0);

    const fallbackPeriodEnd = new Date(fallbackPeriodStart);
    fallbackPeriodEnd.setMonth(fallbackPeriodEnd.getMonth() + 1);

    const billingClient = supabase as any;

    try {
      const rpcResult = await billingClient
        .rpc('get_brand_usage_summary', { p_brand_id: currentBrand.id })
        .maybeSingle();

      if (!rpcResult.error && rpcResult.data) {
        const rpcSummary = rpcResult.data as UsageSummaryRow;
        setSummary({
          monthlyQuota: toNumber(rpcSummary.monthly_quota, FREE_PLAN_QUOTA),
          usedUnits: toNumber(rpcSummary.used_units),
          reservedUnits: toNumber(rpcSummary.reserved_units),
          remainingUnits: toNumber(rpcSummary.remaining_units, FREE_PLAN_QUOTA),
          planName: getPlanCodeLabel(rpcSummary.plan_code),
        });
        return;
      }

      if (rpcResult.error) {
        console.warn('Falling back to table usage summary:', rpcResult.error);
      }

      const [subscriptionResult, freePlanResult] = await Promise.all([
        billingClient
          .from('brand_subscriptions')
          .select('plan_id, quota_override, status, current_period_start, current_period_end')
          .eq('brand_id', currentBrand.id)
          .eq('status', 'active')
          .maybeSingle(),
        billingClient
          .from('plans')
          .select('id, code, name, monthly_quota')
          .eq('code', 'free')
          .maybeSingle(),
      ]);

      if (subscriptionResult.error) {
        console.warn('Failed to fetch brand subscription:', subscriptionResult.error);
      }
      if (freePlanResult.error) {
        console.warn('Failed to fetch free plan:', freePlanResult.error);
      }
      const subscription = (subscriptionResult.data ?? null) as BrandSubscriptionRow | null;
      const freePlan = (freePlanResult.data ?? null) as PlanRow | null;
      let activePlan = freePlan;
      const periodStart = subscription?.current_period_start ?? fallbackPeriodStart.toISOString();
      const periodEnd = subscription?.current_period_end ?? fallbackPeriodEnd.toISOString();

      if (subscription?.plan_id) {
        const planResult = await billingClient
          .from('plans')
          .select('id, code, name, monthly_quota')
          .eq('id', subscription.plan_id)
          .maybeSingle();

        if (planResult.error) {
          console.warn('Failed to fetch active plan:', planResult.error);
        } else {
          activePlan = (planResult.data ?? freePlan) as PlanRow | null;
        }
      }

      const usageResult = await billingClient
        .from('usage_events')
        .select('units, status')
        .eq('brand_id', currentBrand.id)
        .gte('created_at', periodStart)
        .lt('created_at', periodEnd);

      if (usageResult.error) {
        console.warn('Failed to fetch usage events:', usageResult.error);
      }

      const usageRows = ((usageResult.data ?? []) as UsageEventRow[]).filter(Boolean);
      const usedUnits = usageRows.reduce((sum, row) => {
        return row.status === 'succeeded' ? sum + toNumber(row.units) : sum;
      }, 0);
      const reservedUnits = usageRows.reduce((sum, row) => {
        return row.status === 'reserved' ? sum + toNumber(row.units) : sum;
      }, 0);
      const monthlyQuota = subscription?.quota_override ?? activePlan?.monthly_quota ?? FREE_PLAN_QUOTA;
      const normalizedQuota = toNumber(monthlyQuota, FREE_PLAN_QUOTA);

      setSummary({
        monthlyQuota: normalizedQuota,
        usedUnits,
        reservedUnits,
        remainingUnits: Math.max(normalizedQuota - usedUnits - reservedUnits, 0),
        planName: getPlanLabel(activePlan),
      });
    } catch (error) {
      console.error('Failed to fetch usage summary:', error);
      setSummary({
        remainingUnits: FREE_PLAN_QUOTA,
        usedUnits: 0,
        reservedUnits: 0,
        monthlyQuota: FREE_PLAN_QUOTA,
        planName: 'Free',
      });
    } finally {
      setIsLoading(false);
    }
  }, [currentBrand]);

  useEffect(() => {
    fetchUsageSummary();
  }, [fetchUsageSummary]);

  const statItems = [
    {
      label: '残り回数',
      value: summary.remainingUnits.toLocaleString(),
      suffix: '回',
      icon: Gauge,
      color: 'text-emerald-500',
      bgColor: 'bg-emerald-50 dark:bg-emerald-900/20',
    },
    {
      label: '今月使用',
      value: summary.usedUnits.toLocaleString(),
      suffix: `/${summary.monthlyQuota.toLocaleString()}`,
      icon: CheckCircle2,
      color: 'text-blue-500',
      bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    },
    {
      label: '処理中',
      value: summary.reservedUnits.toLocaleString(),
      suffix: '回',
      icon: Loader2,
      color: 'text-amber-500',
      bgColor: 'bg-amber-50 dark:bg-amber-900/20',
    },
    {
      label: 'プラン',
      value: summary.planName,
      suffix: '',
      icon: CreditCard,
      color: 'text-purple-500',
      bgColor: 'bg-purple-50 dark:bg-purple-900/20',
    },
  ];

  if (isLoading) {
    return (
      <div className={className}>
        <div className="animate-pulse grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-3 sm:gap-4 lg:gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-neutral-100 dark:bg-neutral-800 rounded-xl sm:rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-3 sm:gap-4 lg:gap-6">
        {statItems.map((item, index) => (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className="bg-white dark:bg-surface-900 rounded-xl sm:rounded-2xl p-3 sm:p-4 lg:p-6 border border-neutral-100 dark:border-white/5 shadow-sm"
          >
            <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-4">
              <div className={`p-1.5 sm:p-2 ${item.bgColor} rounded-lg`}>
                <item.icon className={`w-4 h-4 sm:w-5 sm:h-5 ${item.color}`} />
              </div>
              <span className="text-[10px] sm:text-xs lg:text-sm font-medium text-neutral-500 dark:text-neutral-400">
                {item.label}
              </span>
            </div>
            <p className="text-xl sm:text-2xl lg:text-3xl font-bold text-neutral-900 dark:text-white font-display truncate">
              {item.value}
              {item.suffix && (
                <span className="text-xs sm:text-sm lg:text-base font-normal text-neutral-400 ml-1 sm:ml-2">
                  {item.suffix}
                </span>
              )}
            </p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
