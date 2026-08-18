import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Code,
  File,
  FileText,
  FolderOpen,
  Globe,
  Image,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FileTreeNode } from '@/lib/persona-files';

function getFileIcon(name: string) {
  const ext = name.includes('.') ? '.' + name.split('.').pop()!.toLowerCase() : '';
  if (['.md', '.txt', '.log'].includes(ext)) return <FileText className="h-4 w-4 text-blue-500" />;
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'].includes(ext)) return <Image className="h-4 w-4 text-green-500" />;
  if (['.html', '.htm'].includes(ext)) return <Globe className="h-4 w-4 text-orange-500" />;
  if (['.js', '.ts', '.jsx', '.tsx', '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.cs', '.swift', '.kt', '.sh', '.php', '.lua', '.r'].includes(ext)) return <Code className="h-4 w-4 text-purple-500" />;
  if (['.json', '.yaml', '.yml', '.toml', '.xml', '.csv', '.ini', '.cfg', '.conf', '.env'].includes(ext)) return <FileText className="h-4 w-4 text-yellow-500" />;
  return <File className="h-4 w-4 text-muted-foreground" />;
}

export interface FileTreeItemProps {
  node: FileTreeNode;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  onDeleteFile?: (path: string) => void;
  depth?: number;
}

export function FileTreeItem({ node, selectedPath, onSelectFile, onDeleteFile, depth = 0 }: FileTreeItemProps) {
  const [expanded, setExpanded] = useState(depth < 1);

  if (node.type === 'directory') {
    return (
      <div>
        <div
          className={cn(
            'group flex w-full items-center justify-between rounded-lg hover:bg-surface transition-colors',
            'text-foreground/80 pr-2'
          )}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          <button
            className="flex flex-1 items-center gap-1.5 py-1.5 text-[13px]"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <FolderOpen className="h-4 w-4 shrink-0 text-yellow-600 dark:text-yellow-500" />
            <span className="truncate font-medium">{node.name}</span>
          </button>
          {onDeleteFile && (
            <button
              className="opacity-0 group-hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5 p-1 rounded-md text-muted-foreground hover:text-destructive transition-all"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteFile(node.path);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {expanded && node.children && (
          <div>
            {node.children.map((child) => (
              <FileTreeItem
                key={child.path}
                node={child}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
                onDeleteFile={onDeleteFile}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'group flex w-full items-center justify-between rounded-lg hover:bg-surface transition-colors pr-2',
        selectedPath === node.path
          ? 'bg-surface text-foreground font-medium'
          : 'text-foreground/70'
      )}
      style={{ paddingLeft: `${depth * 16 + 28}px` }}
    >
      <button
        className="flex flex-1 items-center gap-1.5 py-1.5 text-[13px]"
        onClick={() => onSelectFile(node.path)}
      >
        {getFileIcon(node.name)}
        <span className="truncate">{node.name}</span>
      </button>
      {onDeleteFile && (
        <button
          className="opacity-0 group-hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5 p-1 rounded-md text-muted-foreground hover:text-destructive transition-all"
          onClick={(e) => {
            e.stopPropagation();
            onDeleteFile(node.path);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
