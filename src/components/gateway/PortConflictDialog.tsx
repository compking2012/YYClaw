import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { toast } from 'sonner';
import { hostApi } from '@/lib/host-api';

interface PortConflictData {
  port: number;
  externalPids: string[];
}

export function PortConflictDialog() {
  const { t } = useTranslation(['common']);
  const [conflictData, setConflictData] = useState<PortConflictData | null>(null);

  useEffect(() => {
    // Initial fetch in case a conflict is already pending when the UI loads
    const fetchPendingConflict = async () => {
      try {
        const pending = await hostApi.gateway.pendingPortConflict();
        if (pending) {
          setConflictData(pending);
        }
      } catch (error) {
        console.error('Failed to fetch pending port conflict', error);
      }
    };
    void fetchPendingConflict();

    const unsubscribe = window.electron.ipcRenderer.on('gateway:port-conflict', (...args: unknown[]) => {
      const data = args[0] as PortConflictData | null;
      setConflictData(data);
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  const handleConfirm = async () => {
    if (!conflictData) return;
    try {
      await hostApi.gateway.resolvePortConflict(true);
    } catch (error) {
      toast.error(t('common:errors.generic', { error: String(error) }));
    } finally {
      setConflictData(null);
    }
  };

  const handleCancel = async () => {
    if (!conflictData) return;
    try {
      await hostApi.gateway.resolvePortConflict(false);
      await hostApi.app.quit();
    } catch (error) {
      console.error('Failed to send conflict resolution', error);
    } finally {
      setConflictData(null);
    }
  };

  if (!conflictData) return null;

  return (
    <ConfirmDialog
      open={!!conflictData}
      title={t('common:gateway.portConflictTitle')}
      message={t('common:gateway.portConflictMessage', { port: conflictData.port })}
      confirmLabel={t('common:gateway.portConflictBtnForceKill')}
      cancelLabel={t('common:gateway.portConflictBtnCancel')}
      variant="destructive"
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );
}
