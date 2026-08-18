import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { toast } from 'sonner';

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
        const pending = await window.electron.ipcRenderer.invoke('gateway:getPendingPortConflict');
        if (pending) {
          setConflictData(pending as PortConflictData);
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
      await window.electron.ipcRenderer.invoke('gateway:resolve-conflict', true);
    } catch (error) {
      toast.error(t('common:errors.generic', { error: String(error) }));
    } finally {
      setConflictData(null);
    }
  };

  const handleCancel = async () => {
    if (!conflictData) return;
    try {
      await window.electron.ipcRenderer.invoke('gateway:resolve-conflict', false);
      await window.electron.ipcRenderer.invoke('app:quit');
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
