import type { LanguageCode } from '../language';

// EN
import enCommon from './locales/en/common.json';
import enSettings from './locales/en/settings.json';
import enDashboard from './locales/en/dashboard.json';
import enChat from './locales/en/chat.json';
import enChannels from './locales/en/channels.json';
import enAgents from './locales/en/agents.json';
import enSkills from './locales/en/skills.json';
import enCron from './locales/en/cron.json';
import enSetup from './locales/en/setup.json';
import enMenu from './locales/en/menu.json';
import enWorkflow from './locales/en/workflow.json';
import enWorkspace from './locales/en/workspace.json';
import enErrors from './locales/en/errors.json';
import enDreams from './locales/en/dreams.json';

// ZH
import zhCommon from './locales/zh/common.json';
import zhSettings from './locales/zh/settings.json';
import zhDashboard from './locales/zh/dashboard.json';
import zhChat from './locales/zh/chat.json';
import zhChannels from './locales/zh/channels.json';
import zhAgents from './locales/zh/agents.json';
import zhSkills from './locales/zh/skills.json';
import zhCron from './locales/zh/cron.json';
import zhSetup from './locales/zh/setup.json';
import zhMenu from './locales/zh/menu.json';
import zhWorkflow from './locales/zh/workflow.json';
import zhWorkspace from './locales/zh/workspace.json';
import zhErrors from './locales/zh/errors.json';
import zhDreams from './locales/zh/dreams.json';

// JA
import jaCommon from './locales/ja/common.json';
import jaSettings from './locales/ja/settings.json';
import jaDashboard from './locales/ja/dashboard.json';
import jaChat from './locales/ja/chat.json';
import jaChannels from './locales/ja/channels.json';
import jaAgents from './locales/ja/agents.json';
import jaSkills from './locales/ja/skills.json';
import jaCron from './locales/ja/cron.json';
import jaSetup from './locales/ja/setup.json';
import jaMenu from './locales/ja/menu.json';
import jaWorkflow from './locales/ja/workflow.json';
import jaWorkspace from './locales/ja/workspace.json';
import jaErrors from './locales/ja/errors.json';
import jaDreams from './locales/ja/dreams.json';

// RU
import ruCommon from './locales/ru/common.json';
import ruSettings from './locales/ru/settings.json';
import ruDashboard from './locales/ru/dashboard.json';
import ruChat from './locales/ru/chat.json';
import ruChannels from './locales/ru/channels.json';
import ruAgents from './locales/ru/agents.json';
import ruSkills from './locales/ru/skills.json';
import ruCron from './locales/ru/cron.json';
import ruSetup from './locales/ru/setup.json';
import ruMenu from './locales/ru/menu.json';
import ruWorkflow from './locales/ru/workflow.json';
import ruWorkspace from './locales/ru/workspace.json';
import ruErrors from './locales/ru/errors.json';
import ruDreams from './locales/ru/dreams.json';

export const I18N_NAMESPACES = [
  'common',
  'settings',
  'dashboard',
  'chat',
  'channels',
  'agents',
  'skills',
  'cron',
  'setup',
  'menu',
  'workflow',
  'workspace',
  'errors',
  'dreams',
] as const;

export const I18N_RESOURCES = {
  en: {
    common: enCommon,
    settings: enSettings,
    dashboard: enDashboard,
    chat: enChat,
    channels: enChannels,
    agents: enAgents,
    skills: enSkills,
    cron: enCron,
    setup: enSetup,
    menu: enMenu,
    workflow: enWorkflow,
    workspace: enWorkspace,
    errors: enErrors,
    dreams: enDreams,
  },
  zh: {
    common: zhCommon,
    settings: zhSettings,
    dashboard: zhDashboard,
    chat: zhChat,
    channels: zhChannels,
    agents: zhAgents,
    skills: zhSkills,
    cron: zhCron,
    setup: zhSetup,
    menu: zhMenu,
    workflow: zhWorkflow,
    workspace: zhWorkspace,
    errors: zhErrors,
    dreams: zhDreams,
  },
  ja: {
    common: jaCommon,
    settings: jaSettings,
    dashboard: jaDashboard,
    chat: jaChat,
    channels: jaChannels,
    agents: jaAgents,
    skills: jaSkills,
    cron: jaCron,
    setup: jaSetup,
    menu: jaMenu,
    workflow: jaWorkflow,
    workspace: jaWorkspace,
    errors: jaErrors,
    dreams: jaDreams,
  },
  ru: {
    common: ruCommon,
    settings: ruSettings,
    dashboard: ruDashboard,
    chat: ruChat,
    channels: ruChannels,
    agents: ruAgents,
    skills: ruSkills,
    cron: ruCron,
    setup: ruSetup,
    menu: ruMenu,
    workflow: ruWorkflow,
    workspace: ruWorkspace,
    errors: ruErrors,
    dreams: ruDreams,
  },
} as const;

export type MenuLabels = typeof enMenu;

export const MENU_LABELS: Record<LanguageCode, MenuLabels> = {
  en: enMenu,
  zh: zhMenu,
  ja: jaMenu,
  ru: ruMenu,
};
