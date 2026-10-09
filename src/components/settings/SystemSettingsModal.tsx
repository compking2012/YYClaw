import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import {
  Sun,
  Mic,
  Monitor,
  Server,
  Terminal,
  Download,
  Info,
  Cpu,
  Network,
  Puzzle,
  Moon,
  BarChart3,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSettingsModal, type SettingsTab } from '@/stores/settings-modal';
import { useSettingsStore } from '@/stores/settings';
import { SystemSettingsTab } from '@/pages/Settings';
import { ModelsSettings, UsageSettings } from '@/pages/Models';
import { ChannelsSettings } from '@/pages/Channels';
import { MemorySettings } from '@/pages/Dreams';
import { SkillsSettings } from '@/pages/Skills';
import { ComputerUse } from '@/pages/ComputerUse';

type TabEntry = {
  value: SettingsTab;
  labelKey: string;
  icon: LucideIcon;
  devOnly?: boolean;
};

const TABS: TabEntry[] = [
  { value: 'general', labelKey: 'tabs.general', icon: Sun },
  { value: 'models', labelKey: 'tabs.models', icon: Cpu },
  { value: 'usage', labelKey: 'tabs.usage', icon: BarChart3 },
  { value: 'channels', labelKey: 'tabs.channels', icon: Network },
  { value: 'skills', labelKey: 'tabs.skills', icon: Puzzle },
  { value: 'memory', labelKey: 'tabs.memory', icon: Moon },
  { value: 'voice', labelKey: 'tabs.voice', icon: Mic },
  { value: 'computer-use', labelKey: 'tabs.computerUse', icon: Monitor },
  { value: 'gateway', labelKey: 'tabs.gateway', icon: Server },
  { value: 'updates', labelKey: 'tabs.updates', icon: Download },
  { value: 'developer', labelKey: 'tabs.developer', icon: Terminal, devOnly: true },
  { value: 'about', labelKey: 'tabs.about', icon: Info },
];

export function SystemSettingsModal() {
  const { t } = useTranslation('settings');
  const open = useSettingsModal((s) => s.open);
  const tab = useSettingsModal((s) => s.tab);
  const setTab = useSettingsModal((s) => s.setTab);
  const close = useSettingsModal((s) => s.close);
  const devModeUnlocked = useSettingsStore((s) => s.devModeUnlocked);

  const visibleTabs = TABS.filter(
    (entry) => !entry.devOnly || devModeUnlocked,
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        className="w-[92vw] max-w-6xl h-[88vh] flex flex-col p-0 gap-0 bg-background rounded-2xl shadow-xl border border-black/10 dark:border-white/10"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          // Nested app modals (channel config, add-model, usage detail) are
          // portaled to <body>, i.e. outside this dialog's DOM subtree. Without
          // this guard Radix would treat interacting with them as an outside
          // click and close Settings. Skip dismissal when the interaction comes
          // from a portaled app modal.
          const target = event.detail.originalEvent.target as HTMLElement | null;
          if (target?.closest('[data-app-modal]')) event.preventDefault();
        }}
      >
        <div className="flex items-center justify-between gap-4 shrink-0 border-b border-black/5 dark:border-white/10 px-5 py-3">
          <DialogTitle className="text-lg font-semibold text-foreground">
            {t('title')}
          </DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={close}
            aria-label={t('close', { defaultValue: 'Close' })}
          >
            <X className="h-4 w-4 pointer-events-none" />
          </Button>
        </div>
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as SettingsTab)}
          orientation="vertical"
          className="flex min-h-0 flex-1"
        >
          <TabsList
            className="h-auto w-52 shrink-0 flex-col items-stretch justify-start gap-y-1 overflow-y-auto rounded-none border-r border-black/5 bg-surface-sidebar p-2 dark:border-white/10"
          >
            {visibleTabs.map((entry) => {
              const Icon = entry.icon;
              return (
                <TabsTrigger
                  key={entry.value}
                  value={entry.value}
                  data-testid={`settings-tab-${entry.value}`}
                  className="sidebar-nav-text justify-start gap-2 rounded-lg px-2.5 py-1.5 text-foreground/80 hover:bg-black/5 dark:hover:bg-white/5 data-[state=active]:bg-black/5 dark:data-[state=active]:bg-white/10 data-[state=active]:text-foreground data-[state=active]:shadow-none"
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {t(entry.labelKey)}
                </TabsTrigger>
              );
            })}
          </TabsList>
          <div className="min-h-0 flex-1 overflow-hidden">
            <TabsContent value="general" className="m-0 h-full overflow-y-auto p-6">
              <SystemSettingsTab section="general" />
            </TabsContent>
            <TabsContent value="models" className="m-0 h-full overflow-hidden">
              <ModelsSettings />
            </TabsContent>
            <TabsContent value="usage" className="m-0 h-full overflow-y-auto p-6">
              <UsageSettings />
            </TabsContent>
            <TabsContent value="channels" className="m-0 h-full overflow-y-auto p-6">
              <ChannelsSettings />
            </TabsContent>
            <TabsContent value="skills" className="m-0 h-full overflow-y-auto p-6">
              <SkillsSettings />
            </TabsContent>
            <TabsContent value="memory" className="m-0 h-full overflow-y-auto p-6">
              <MemorySettings />
            </TabsContent>
            <TabsContent value="voice" className="m-0 h-full overflow-y-auto p-6">
              <SystemSettingsTab section="voice" />
            </TabsContent>
            <TabsContent value="computer-use" className="m-0 h-full overflow-y-auto p-6">
              <ComputerUse />
            </TabsContent>
            <TabsContent value="gateway" className="m-0 h-full overflow-y-auto p-6">
              <SystemSettingsTab section="gateway" />
            </TabsContent>
            <TabsContent value="developer" className="m-0 h-full overflow-y-auto p-6">
              <SystemSettingsTab section="developer" />
            </TabsContent>
            <TabsContent value="updates" className="m-0 h-full overflow-y-auto p-6">
              <SystemSettingsTab section="updates" />
            </TabsContent>
            <TabsContent value="about" className="m-0 h-full overflow-y-auto p-6">
              <SystemSettingsTab section="about" />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
