import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileQuestion, FolderOpen, RefreshCw, Sparkles, Wand2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { hostApi } from '@/lib/host-api';
import { toast } from '@/lib/toast';
import { useTranslation } from 'react-i18next';
import { useAgentsStore } from '@/stores/agents';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { FilePreviewBody } from '@/components/file-preview/FilePreviewBody';
import { readTextFile, writeTextFile } from '@/lib/file-preview-client';
import { basenameOf } from '@/lib/generated-files';
import { buildPersonaGenPrompt, isPersonaGeneratableFile, PERSONA_GEN_SET } from '@/lib/persona-generate';
import { FileTreeItem } from './FileTreeItem';
import { PersonaGenerateReviewDialog, type GeneratedPersonaFile } from './PersonaGenerateReviewDialog';
import { PersonaGenerateInputDialog, type PersonaGenerateMode } from './PersonaGenerateInputDialog';
import {
  buildPreviewTarget,
  isSystemFilePath,
  isSystemNode,
  joinWorkspacePath,
  type FileTreeNode,
} from '@/lib/persona-files';

export interface PersonaSettingsModalProps {
  agentId: string | null;
  open: boolean;
  onClose: () => void;
}

type GenerateTextResponse = { success: boolean; text?: string; error?: string };

type PersonaMdFile = { name: string; path: string; content: string };

const GEN_TIMEOUT_MS = 60_000;

export function PersonaSettingsModal({ agentId, open, onClose }: PersonaSettingsModalProps) {
  const { t } = useTranslation('agents');
  const agentName = useAgentsStore((s) => s.agents.find((a) => a.id === agentId)?.name ?? '');

  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [workspacePath, setWorkspacePath] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);

  // Natural-language generation state.
  const [genDialog, setGenDialog] = useState<{ mode: PersonaGenerateMode } | null>(null);
  const [description, setDescription] = useState('');
  const [generating, setGenerating] = useState(false);
  // Draft injected into the editor for single-file generation, tied to a path
  // so switching files never leaks a generated draft into the wrong file.
  const [pendingDraft, setPendingDraft] = useState<{ path: string; content: string; token: number } | null>(null);
  const [reviewFiles, setReviewFiles] = useState<GeneratedPersonaFile[] | null>(null);
  const [savingReview, setSavingReview] = useState(false);
  const genTokenRef = useRef(0);

  const filteredTree = useMemo(() => fileTree.filter(isSystemNode), [fileTree]);

  // Stable preview target so a parent re-render doesn't re-read the file or
  // flip the editor out of edit mode / clobber the draft.
  const previewFile = useMemo(
    () => (selectedFile && workspacePath ? buildPreviewTarget(workspacePath, selectedFile) : null),
    [workspacePath, selectedFile],
  );

  const selectedFileName = selectedFile ? basenameOf(selectedFile) : null;
  const canGenerateSingle = !!selectedFile
    && !!selectedFileName
    && isSystemFilePath(selectedFile)
    && isPersonaGeneratableFile(selectedFileName);

  const resetGenerationState = useCallback(() => {
    setGenDialog(null);
    setDescription('');
    setGenerating(false);
    setPendingDraft(null);
    setReviewFiles(null);
  }, []);

  const fetchTree = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    setSelectedFile(null);
    try {
      const result = await hostApi.workspace.tree({ agentId: id, includeHidden: false }) as {
        success: boolean;
        tree: FileTreeNode[];
        workspace: string;
        error?: string;
      };
      if (result.success) {
        setFileTree(result.tree);
        setWorkspacePath(result.workspace);
      } else {
        setError(result.error || 'Failed to load');
        setFileTree([]);
      }
    } catch (err) {
      setError(String(err));
      setFileTree([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !agentId) return;
    // Defer state resets into a microtask so they don't run synchronously in
    // the effect body (mirrors the existing async fetchTree pattern).
    void Promise.resolve().then(() => {
      resetGenerationState();
      return fetchTree(agentId);
    });
  }, [open, agentId, fetchTree, resetGenerationState]);

  const handleSelectFile = useCallback((path: string) => {
    // Dropping any pending injected draft avoids leaking it onto another file.
    setPendingDraft(null);
    setSelectedFile(path);
  }, []);

  const handleRebuild = async () => {
    if (!agentId) return;
    setRebuilding(true);
    try {
      const result = await hostApi.workspace.rebuild({ agentId }) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error || 'Failed to rebuild persona templates');
      void fetchTree(agentId);
    } catch (err) {
      console.error(err);
      setError(String(err));
    } finally {
      setRebuilding(false);
    }
  };

  const handleDeleteFile = async (path: string) => {
    if (!agentId) return;
    if (!window.confirm(t('persona.deleteConfirm', { path }))) return;
    try {
      const result = await hostApi.workspace.deleteFile({ agentId, path }) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error || 'Failed to delete file');
      if (selectedFile === path || selectedFile?.startsWith(`${path}/`)) {
        setSelectedFile(null);
      }
      void fetchTree(agentId);
    } catch (err) {
      console.error(err);
      setError(String(err));
    }
  };

  const readCurrentContent = useCallback(async (relPath: string): Promise<string> => {
    try {
      const res = await readTextFile(joinWorkspacePath(workspacePath, relPath)) as { ok: boolean; content?: string };
      return res.ok ? (res.content ?? '') : '';
    } catch {
      return '';
    }
  }, [workspacePath]);

  // Read every top-level persona markdown file (excludes the memory/ directory,
  // which isn't a file node) so generation can use them as context.
  const readAllPersonaMd = useCallback(async (): Promise<PersonaMdFile[]> => {
    const files = filteredTree.filter(
      (n) => n.type === 'file' && n.name.toLowerCase().endsWith('.md'),
    );
    const out: PersonaMdFile[] = [];
    for (const f of files) {
      out.push({ name: f.name, path: f.path, content: await readCurrentContent(f.path) });
    }
    return out;
  }, [filteredTree, readCurrentContent]);

  const runSingleGenerate = useCallback(async () => {
    if (!agentId || !selectedFile || !selectedFileName) return;
    setGenerating(true);
    try {
      const all = await readAllPersonaMd();
      const current = await readCurrentContent(selectedFile);
      const contextFiles = all
        .filter((f) => f.path !== selectedFile)
        .map(({ name, content }) => ({ name, content }));
      const { system, input } = buildPersonaGenPrompt(selectedFileName, description, {
        currentContent: current,
        contextFiles,
      });
      const res = await hostApi.agents.generateText({ agentId, system, input, timeoutMs: GEN_TIMEOUT_MS }) as GenerateTextResponse;
      if (!res.success || !res.text) throw new Error(res.error || 'Generation failed');
      genTokenRef.current += 1;
      setPendingDraft({ path: selectedFile, content: res.text, token: genTokenRef.current });
      setGenDialog(null);
      setDescription('');
    } catch (err) {
      toast.appError(err);
    } finally {
      setGenerating(false);
    }
  }, [agentId, selectedFile, selectedFileName, description, readAllPersonaMd, readCurrentContent]);

  const runSetGenerate = useCallback(async () => {
    if (!agentId) return;
    setGenerating(true);
    try {
      const all = await readAllPersonaMd();
      const results: GeneratedPersonaFile[] = [];
      for (const name of PERSONA_GEN_SET) {
        const current = all.find((f) => f.name === name)?.content ?? '';
        const contextFiles = all
          .filter((f) => f.name !== name)
          .map(({ name: n, content }) => ({ name: n, content }));
        const { system, input } = buildPersonaGenPrompt(name, description, {
          currentContent: current,
          contextFiles,
        });
        const res = await hostApi.agents.generateText({ agentId, system, input, timeoutMs: GEN_TIMEOUT_MS }) as GenerateTextResponse;
        if (!res.success || !res.text) throw new Error(res.error || `Failed to generate ${name}`);
        results.push({ name, content: res.text });
      }
      setReviewFiles(results);
      setGenDialog(null);
      setDescription('');
    } catch (err) {
      toast.appError(err);
    } finally {
      setGenerating(false);
    }
  }, [agentId, description, readAllPersonaMd]);

  const handleGenerate = () => {
    if (genDialog?.mode === 'single') void runSingleGenerate();
    else if (genDialog?.mode === 'set') void runSetGenerate();
  };

  const openGenerate = (mode: PersonaGenerateMode) => {
    setDescription('');
    setGenDialog({ mode });
  };

  const handleReviewSave = useCallback(async (files: GeneratedPersonaFile[]) => {
    if (!agentId) return;
    setSavingReview(true);
    try {
      for (const file of files) {
        const res = await writeTextFile(joinWorkspacePath(workspacePath, file.name), file.content) as { ok: boolean; error?: string };
        if (!res.ok) throw new Error(res.error || `Failed to save ${file.name}`);
      }
      toast.success(t('persona.gen.savedAll', 'Saved to disk'));
      setReviewFiles(null);
      void fetchTree(agentId);
    } catch (err) {
      toast.appError(err);
    } finally {
      setSavingReview(false);
    }
  }, [agentId, workspacePath, fetchTree, t]);

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
        <DialogContent
          className="w-[min(1024px,95vw)] h-[80vh] flex flex-col p-0 gap-0 bg-background rounded-2xl shadow-xl border border-black/10 dark:border-white/10"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <div className="flex items-center justify-between gap-4 shrink-0 border-b border-black/5 dark:border-white/10 px-5 py-3">
            <div className="min-w-0">
              <DialogTitle className="text-lg font-semibold text-foreground truncate">
                {t('persona.title')}
              </DialogTitle>
              <p className="text-[13px] text-foreground/60 truncate">{t('persona.subtitle', { name: agentName || agentId || '' })}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* Future: an "Import from persona library" action can slot in here. */}
              <Button
                variant="outline"
                disabled={rebuilding}
                onClick={() => openGenerate('set')}
                className="h-8 text-[13px] font-medium rounded-full px-3 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground transition-colors"
              >
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                {t('persona.gen.wholeButton', 'Generate whole persona')}
              </Button>
              <Button
                variant="outline"
                disabled={rebuilding}
                onClick={handleRebuild}
                className="h-8 text-[13px] font-medium rounded-full px-3 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground transition-colors"
              >
                {rebuilding ? (
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Wand2 className="h-3.5 w-3.5 mr-1.5" />
                )}
                {t('persona.rebuild')}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={onClose}
                aria-label={t('persona.close')}
              >
                <X className="h-4 w-4 pointer-events-none" />
              </Button>
            </div>
          </div>

          <div className="flex flex-1 overflow-hidden min-h-0">
            <div className="w-64 shrink-0 border-r border-black/5 dark:border-white/10 bg-surface/40 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto py-2 px-1.5">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <LoadingSpinner size="lg" />
                  </div>
                ) : error ? (
                  <div className="p-4 text-[13px] text-destructive">{error}</div>
                ) : filteredTree.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                    <FolderOpen className="h-10 w-10 opacity-20" />
                    <p className="text-[13px] font-medium">{t('persona.empty')}</p>
                  </div>
                ) : (
                  filteredTree.map((node) => (
                    <FileTreeItem
                      key={node.path}
                      node={node}
                      selectedPath={selectedFile}
                      onSelectFile={handleSelectFile}
                      onDeleteFile={handleDeleteFile}
                    />
                  ))
                )}
              </div>
            </div>

            <div className="flex flex-1 flex-col overflow-hidden">
              {previewFile && selectedFile ? (
                <FilePreviewBody
                  key={selectedFile}
                  file={previewFile}
                  readOnly={!isSystemFilePath(selectedFile)}
                  documentEditable={isSystemFilePath(selectedFile)}
                  pendingDraft={
                    pendingDraft && pendingDraft.path === selectedFile
                      ? { content: pendingDraft.content, token: pendingDraft.token }
                      : undefined
                  }
                  trailingHeader={(
                    <>
                      {canGenerateSingle && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          title={t('persona.gen.currentButton', 'Generate / edit with AI')}
                          onClick={() => openGenerate('single')}
                        >
                          <Sparkles className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        title={t('persona.showInManager')}
                        onClick={() => {
                          void hostApi.shell.showItemInFolder(joinWorkspacePath(workspacePath, selectedFile))
                            .catch((err) => console.error(err));
                        }}
                      >
                        <FolderOpen className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                />
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground gap-2">
                  <FileQuestion className="h-10 w-10 opacity-20" />
                  <p className="text-[13px] font-medium">{t('persona.selectToPreview')}</p>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <PersonaGenerateInputDialog
        open={genDialog != null}
        mode={genDialog?.mode ?? 'set'}
        targetName={selectedFileName}
        description={description}
        generating={generating}
        onDescriptionChange={setDescription}
        onCancel={() => { if (!generating) setGenDialog(null); }}
        onGenerate={handleGenerate}
      />

      <PersonaGenerateReviewDialog
        open={reviewFiles != null}
        files={reviewFiles ?? []}
        saving={savingReview}
        onCancel={() => setReviewFiles(null)}
        onFileChange={(index, content) =>
          setReviewFiles((prev) =>
            prev ? prev.map((f, i) => (i === index ? { ...f, content } : f)) : prev,
          )
        }
        onSave={() => { if (reviewFiles) void handleReviewSave(reviewFiles); }}
      />
    </>
  );
}
