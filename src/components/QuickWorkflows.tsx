import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, ShoppingBag, Camera, Palette, Globe, Zap, type LucideIcon } from 'lucide-react';
import { workflowMetadata, type WorkflowIconKey } from '../lib/workflowMetadata';

const workflowIcons: Record<WorkflowIconKey, LucideIcon> = {
  'shopping-bag': ShoppingBag,
  camera: Camera,
  palette: Palette,
  globe: Globe,
};

interface QuickWorkflowsProps {
  className?: string;
}

export function QuickWorkflows({ className }: QuickWorkflowsProps) {
  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-primary-100 to-gold-light/20 dark:from-primary-900/30 dark:to-gold-dark/20 rounded-lg">
            <Zap className="w-5 h-5 text-primary-600 dark:text-primary-400" />
          </div>
          <h2 className="text-xl font-semibold text-neutral-900 dark:text-white font-display">
            クイックワークフロー
          </h2>
        </div>
        <span className="text-xs text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800 px-3 py-1 rounded-full">
          一括生成
        </span>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {workflowMetadata.map((workflow, index) => {
          const Icon = workflowIcons[workflow.iconKey];

          return (
            <motion.div
              key={workflow.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <Link
                to={`/workflows/${workflow.id}`}
                className="group block h-full p-5 rounded-2xl bg-white dark:bg-surface-900 border border-neutral-100 dark:border-white/5 hover:shadow-lg hover:-translate-y-1 transition-all duration-300"
              >
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${workflow.color} flex items-center justify-center shadow-md flex-shrink-0`}>
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <h3 className="font-semibold text-neutral-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors truncate">
                        {workflow.title}
                      </h3>
                      <span className="text-xs text-neutral-400 dark:text-neutral-500 whitespace-nowrap">
                        {workflow.estimatedTime}
                      </span>
                    </div>
                    <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-3">
                      {workflow.description}
                    </p>

                    <div className="flex flex-wrap gap-1.5">
                      {workflow.steps.map((step, i) => (
                        <span
                          key={i}
                          className="text-xs px-2 py-0.5 bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 rounded-full"
                        >
                          {step}
                        </span>
                      ))}
                    </div>
                  </div>
                  <ArrowRight className="w-5 h-5 text-neutral-300 dark:text-neutral-600 group-hover:text-primary-500 group-hover:translate-x-1 transition-all flex-shrink-0" />
                </div>
              </Link>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
