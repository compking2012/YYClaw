import { lazy, Suspense } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SHOW_OFFICE_COLLABORATION } from '@/lib/feature-office';

const OfficePage = lazy(() => import('./index').then((m) => ({ default: m.Office })));

/** Renders Office page only when compile-time collaboration is enabled. */
export function OfficeRouteGuard() {
  const { t } = useTranslation('common');
  if (!SHOW_OFFICE_COLLABORATION) {
    return <Navigate to="/" replace />;
  }
  return (
    <Suspense
      fallback={
        <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-muted-foreground">
          {t('status.loading')}
        </div>
      }
    >
      <OfficePage />
    </Suspense>
  );
}
