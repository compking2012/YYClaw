import { useEffect } from 'react';
import { useUpdateStore } from '@/stores/update';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Download, Loader2, Rocket, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ModalPortal } from '@/components/ui/modal-portal';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function ForceUpdateModal() {
  const { t } = useTranslation('settings');
  const {
    status,
    updateInfo,
    progress,
    downloadUpdate,
    installUpdate,
    error,
    checkForUpdates,
    init,
  } = useUpdateStore();

  // Subscribe to main-process update events and hydrate from update:status.
  // Without this, only Settings > Update mounted UpdateSettings would call init(),
  // and startup checkForUpdates() pushes would be missed.
  useEffect(() => {
    void init();
  }, [init]);

  const isForceUpdate = updateInfo?.forceUpdate === true || String(updateInfo?.forceUpdate).toLowerCase() === 'true';
  const isUpdateActive = ['available', 'downloading', 'downloaded', 'error'].includes(status);

  console.log('[ForceUpdateModal] updateInfo:', updateInfo);
  console.log('[ForceUpdateModal] isForceUpdate:', isForceUpdate, 'isUpdateActive:', isUpdateActive, 'status:', status);

  if (!isForceUpdate || !isUpdateActive) {
    return null;
  }

  // Prevent user from dismissing the modal. It will render over everything.
  return (
    <ModalPortal>
    <div className="fixed inset-0 z-[9999] bg-background/80 backdrop-blur-sm flex items-center justify-center">
      <div className="bg-background border shadow-lg rounded-xl w-full max-w-md p-6 space-y-6 flex flex-col pointer-events-auto">
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="p-3 bg-destructive/10 text-destructive rounded-full">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold tracking-tight">
            {t('updates.forceUpdate.title', '重要更新可用')}
          </h2>
          <p className="text-muted-foreground text-sm">
            {t('updates.forceUpdate.description', '当前版本已停止维护，必须更新到最新版本才能继续使用。')}
          </p>
        </div>

        {/* Status Info */}
        <div className="bg-muted/50 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t('updates.currentVersion', '版本')}</span>
            <span className="font-medium">v{updateInfo?.version ?? ''}</span>
          </div>

          {status === 'downloading' && progress && (
            <div className="space-y-2 pt-2 border-t border-border/50">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {formatBytes(progress.transferred)} / {formatBytes(progress.total)}
                </span>
                <span>{formatBytes(progress.bytesPerSecond)}/s</span>
              </div>
              <Progress value={progress.percent} className="h-2" />
              <p className="text-xs text-center text-muted-foreground">
                {Math.round(progress.percent)}% {t('updates.status.downloading', '下载中...')}
              </p>
            </div>
          )}

          {status === 'error' && error && (
            <div className="pt-2 border-t border-border/50 text-xs text-destructive break-words">
              {error}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 pt-2">
          {status === 'available' && (
            <Button onClick={downloadUpdate} className="w-full">
              <Download className="w-4 h-4 mr-2" />
              {t('updates.action.download', '立即下载更新')}
            </Button>
          )}

          {status === 'downloading' && (
            <Button disabled className="w-full">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {t('updates.status.downloading', '下载中...')}
            </Button>
          )}

          {status === 'downloaded' && (
            <Button onClick={installUpdate} className="w-full">
              <Rocket className="w-4 h-4 mr-2" />
              {t('updates.action.install', '立即重启安装')}
            </Button>
          )}

          {status === 'error' && (
            <Button onClick={checkForUpdates} variant="default" className="w-full">
              <AlertTriangle className="w-4 h-4 mr-2" />
              {t('updates.action.retry', '重试')}
            </Button>
          )}
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
