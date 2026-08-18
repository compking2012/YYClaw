import { Loader2, MessageSquare, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { OfficeChatPanel } from '@/pages/Office/OfficeChatPanel';
import type { OfficeMentionRole } from '@/components/office/OfficeRoleMentionInput';
import { formatOfficeProjectListTitle } from '@/lib/office-task-order';
import { OfficeProjectStatusDot } from '@/components/office/OfficeProjectStatusDot';
import {
  filterRoomMessagesForProject,
  isOfficeProjectArchived,
  officeTaskStatusLight,
  roomGroupIdForProject,
} from '@/lib/office-room-sidebar';
import type { OfficeTempProject, RoomMessage } from '@/types/office';
import type { RoomAuthorMember } from '@/lib/office-room-reply';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

function roomChatSidebarClassName(extra?: string) {
  return cn(
    'flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden bg-card',
    extra,
  );
}

type OfficeProjectRoomsSidebarProps = {
  activeRoomProject: OfficeTempProject | null;
  roomLoading?: boolean;
  /** 群聊数据与 OfficeChatPanel 延后挂载，避免大列表阻塞卡片展开。 */
  roomChatActive?: boolean;
  roomMembers: RoomAuthorMember[];
  mentionRoles: OfficeMentionRole[];
  roomMessagesByProject: Record<string, RoomMessage[]>;
  onCollapseRoom: () => void;
  onPostRoom: (
    projectId: string,
    content: string,
    opts?: { replyToId?: string },
  ) => Promise<void>;
};

function ActiveRoomHeader({
  project,
  messageCount,
  onCollapse,
}: {
  project: OfficeTempProject;
  messageCount: number;
  onCollapse: () => void;
}) {
  const { t } = useTranslation('office');
  const statusLight = officeTaskStatusLight(project);

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/40 bg-gradient-to-r from-muted/30 to-transparent px-3 py-2.5">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <OfficeProjectStatusDot light={statusLight} />
        <h3 className="min-w-0 flex-1 truncate font-serif text-sm font-normal tracking-tight text-foreground">
          {formatOfficeProjectListTitle(project)}
        </h3>
        {messageCount > 0 ? (
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
            {t('roomMessageCount', { count: messageCount })}
          </span>
        ) : null}
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 w-7 shrink-0 p-0 text-muted-foreground"
        aria-label={t('close')}
        onClick={onCollapse}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function DeferredOfficeRoomChat({
  project,
  roomLoading,
  roomMembers,
  mentionRoles,
  roomMessages,
  onCollapseRoom,
  onPostRoom,
}: {
  project: OfficeTempProject;
  roomLoading: boolean;
  roomMembers: RoomAuthorMember[];
  mentionRoles: OfficeMentionRole[];
  roomMessages: RoomMessage[];
  onCollapseRoom: () => void;
  onPostRoom: (content: string, opts?: { replyToId?: string }) => Promise<void>;
}) {
  const { t } = useTranslation('office');

  if (roomLoading) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-xs text-muted-foreground"
        data-testid={`office-task-room-loading-${project.id}`}
      >
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        <span>{t('projectRoomLoading')}</span>
      </div>
    );
  }

  if (!project.roomSessionKey?.trim()) {
    return <p className="p-4 text-sm text-muted-foreground">{t('roomChatUnavailable')}</p>;
  }

  return (
    <OfficeChatPanel
      embedded
      hideClose
      hideHeader
      sessionKey={project.roomSessionKey}
      title={project.title.trim() || t('roomChat')}
      onClose={onCollapseRoom}
      roomGroupId={roomGroupIdForProject(project)}
      roomProjectId={project.id}
      mentionRoles={mentionRoles}
      roomMessages={roomMessages}
      roomMembers={roomMembers}
      onPostRoom={onPostRoom}
      roomReadOnly={isOfficeProjectArchived(project)}
    />
  );
}

export function OfficeProjectRoomsSidebar({
  activeRoomProject,
  roomLoading = false,
  roomChatActive = true,
  roomMembers,
  mentionRoles,
  roomMessagesByProject,
  onCollapseRoom,
  onPostRoom,
}: OfficeProjectRoomsSidebarProps) {
  const { t } = useTranslation('office');

  return (
    <div className={roomChatSidebarClassName()} data-testid="office-room-chat-sidebar">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/40 bg-card/95 px-3 py-2.5 backdrop-blur-sm">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/10">
          <MessageSquare className="h-3.5 w-3.5" />
        </span>
        <h2 className="font-serif text-sm font-normal tracking-tight text-foreground">{t('projectRooms')}</h2>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {activeRoomProject ? (
          <div
            className="flex min-h-0 flex-1 flex-col"
            data-testid={`office-task-room-${activeRoomProject.id}`}
          >
            <ActiveRoomHeader
              project={activeRoomProject}
              messageCount={filterRoomMessagesForProject(
                roomMessagesByProject[activeRoomProject.id] ?? [],
                activeRoomProject.id,
              ).length}
              onCollapse={() => onCollapseRoom()}
            />
            <div
              className="relative flex min-h-0 flex-1 flex-col bg-muted/5"
              data-testid={`office-task-room-expanded-${activeRoomProject.id}`}
            >
              {roomChatActive ? (
                <DeferredOfficeRoomChat
                  project={activeRoomProject}
                  roomLoading={roomLoading}
                  roomMembers={roomMembers}
                  mentionRoles={mentionRoles}
                  roomMessages={filterRoomMessagesForProject(
                    roomMessagesByProject[activeRoomProject.id] ?? [],
                    activeRoomProject.id,
                  )}
                  onCollapseRoom={onCollapseRoom}
                  onPostRoom={(content, opts) => onPostRoom(activeRoomProject.id, content, opts)}
                />
              ) : (
                <div
                  className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-xs text-muted-foreground"
                  data-testid={`office-task-room-chat-pending-${activeRoomProject.id}`}
                >
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                  <span>{t('projectRoomLoading')}</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div
            className="flex-1 bg-muted/5"
            data-testid="office-room-chat-empty"
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}
