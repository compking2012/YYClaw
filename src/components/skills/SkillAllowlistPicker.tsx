import { useCallback, useMemo, useState } from 'react';
import { usePickerSessionOrder } from '@/hooks/use-picker-session-order';
import { orderItemsBySessionKeys } from '@/lib/picker-session-order';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { Skill } from '@/types/skill';
import { SkillPickerSearch } from '@/components/skills/SkillPickerSearch';
import { SkillPickerPageSectionHeader } from '@/components/skills/SkillPickerPageSectionHeader';
import {
  SKILL_PICKER_SEARCH_MIN_COUNT,
  skillPickerBulkButtonClasses,
  skillPickerLabelClasses,
  skillPickerPageSectionClasses,
  skillPickerListContainerClassesForCount,
  skillPickerSectionCardClasses,
  skillPickerSectionNestedClasses,
} from '@/components/skills/skill-picker-styles';
import {
  addCatalogSkillToSelection,
  canonicalSkillKeyFromSkill,
  countSelectedCatalogSkills,
  findCatalogSkillByKey,
  isCatalogSkillSelected,
  normalizeSkillKey,
  removeCatalogSkillsFromSelection,
} from '@/lib/skill-lookup-aliases';

export interface SkillAllowlistPickerProps {
  availableSkills: Skill[];
  selectedSkills: string[];
  onChange: (skills: string[]) => void;
  title: string;
  description?: string;
  searchPlaceholder: string;
  emptyText: string;
  testIdPrefix: string;
  /** When set, renders global/other dual sections with per-section search. */
  globalSkillIds?: string[];
  globalSectionTitle?: string;
  globalSectionDescription?: string;
  otherSectionTitle?: string;
  otherSectionDescription?: string;
  /** Title outside card; content inside card (agent settings / global skills layout). */
  pageSectionLayout?: boolean;
  /** @deprecated Use pageSectionLayout */
  groupDualSections?: boolean;
  /** When the picker session resets (e.g. dialog open/close). Defaults to a per-mount session. */
  sessionKey?: string | number | boolean | null;
  /** Selection snapshot for entry ordering; defaults to selectedSkills on session start. */
  initialSelectedSkills?: string[];
  /** When true, an empty availableSkills is treated as "still loading" instead of "no skills". */
  isLoading?: boolean;
}

function filterSkillsByQuery(skills: Skill[], query: string): Skill[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return skills;
  return skills.filter((skill) =>
    skill.name.toLowerCase().includes(normalized)
    || skill.id.toLowerCase().includes(normalized)
    || (skill.slug || '').toLowerCase().includes(normalized)
    || (skill.description || '').toLowerCase().includes(normalized),
  );
}

function SkillListRows({
  skills,
  availableSkills,
  selectedSkills,
  onChange,
  emptyText,
  testIdPrefix,
  isBulkMode,
  bulkSelectedSet,
  onBulkToggle,
  getSkillDescription,
  t,
}: {
  skills: Skill[];
  availableSkills: Skill[];
  selectedSkills: string[];
  onChange: (skills: string[]) => void;
  emptyText: string;
  testIdPrefix: string;
  isBulkMode: boolean;
  bulkSelectedSet: Set<string>;
  onBulkToggle: (skillKey: string) => void;
  getSkillDescription: (skill: Skill) => string;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const isSkillSelected = useCallback(
    (skill: Skill) => isCatalogSkillSelected(skill, selectedSkills, availableSkills),
    [availableSkills, selectedSkills],
  );

  const toggle = (skill: Skill, checked: boolean) => {
    if (checked) {
      onChange(addCatalogSkillToSelection(skill, selectedSkills, availableSkills));
      return;
    }
    onChange(removeCatalogSkillsFromSelection([skill], selectedSkills, availableSkills));
  };

  return (
    <div className={skillPickerListContainerClassesForCount(skills.length)}>
      {skills.map((skill) => {
        const rowKey = canonicalSkillKeyFromSkill(skill);
        return (
          <div
            key={rowKey}
            className="flex items-center justify-between rounded-lg px-2 py-2 hover:bg-black/5 dark:hover:bg-white/5 gap-2 transition-colors"
          >
            {isBulkMode ? (
              <button
                type="button"
                onClick={() => onBulkToggle(rowKey)}
                data-testid={`${testIdPrefix}-bulk-item-${skill.id}`}
                className={cn(
                  'h-4 w-4 rounded border border-black/20 dark:border-white/20 flex items-center justify-center shrink-0',
                  bulkSelectedSet.has(rowKey) ? 'bg-black/80 text-white dark:bg-white/80 dark:text-black' : 'bg-transparent',
                )}
                aria-label={t('skills.bulkToggleLabel', { skill: skill.name })}
              >
                {bulkSelectedSet.has(rowKey) ? <Check className="h-3 w-3" /> : null}
              </button>
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium truncate flex items-center gap-1.5">
                <span>{skill.name}</span>
                {skill.version?.trim() ? (
                  <span className="text-[11px] font-mono font-normal text-muted-foreground tabular-nums shrink-0">
                    {skill.version.trim()}
                  </span>
                ) : null}
                {skill.isCore ? (
                  <Badge variant="outline" className="h-4 rounded-full px-1.5 text-[10px] border-black/20 dark:border-white/20">
                    {t('skills.coreTag')}
                  </Badge>
                ) : null}
              </div>
              <div className="text-[11px] text-muted-foreground truncate">{getSkillDescription(skill)}</div>
            </div>
            {!isBulkMode ? (
              <Switch
                checked={isSkillSelected(skill)}
                onCheckedChange={(checked) => toggle(skill, checked)}
                data-testid={`${testIdPrefix}-toggle-${skill.id}`}
              />
            ) : null}
          </div>
        );
      })}
      {skills.length === 0 ? (
        <div className="text-[12px] text-muted-foreground px-2 py-2 text-center">{emptyText}</div>
      ) : null}
    </div>
  );
}

function SkillPickerSection({
  title,
  description,
  enabledCount,
  sectionSkills,
  availableSkills,
  selectedSkills,
  onChange,
  searchPlaceholder,
  emptyText,
  testIdPrefix,
  getSkillDescription,
  t,
  variant = 'card',
}: {
  title: string;
  description?: string;
  enabledCount: number;
  sectionSkills: Skill[];
  availableSkills: Skill[];
  selectedSkills: string[];
  onChange: (skills: string[]) => void;
  searchPlaceholder: string;
  emptyText: string;
  testIdPrefix: string;
  getSkillDescription: (skill: Skill) => string;
  t: (key: string, options?: Record<string, unknown>) => string;
  variant?: 'card' | 'nested' | 'content';
}) {
  const [query, setQuery] = useState('');
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [bulkSelectedKeys, setBulkSelectedKeys] = useState<string[]>([]);

  const filteredSkills = useMemo(
    () => filterSkillsByQuery(sectionSkills, query),
    [query, sectionSkills],
  );
  const visibleKeys = useMemo(
    () => filteredSkills.map((skill) => canonicalSkillKeyFromSkill(skill)),
    [filteredSkills],
  );
  const bulkSelectedSet = useMemo(
    () => new Set(bulkSelectedKeys.map(normalizeSkillKey)),
    [bulkSelectedKeys],
  );
  const showSearch = sectionSkills.length >= SKILL_PICKER_SEARCH_MIN_COUNT;
  const hasBulkSelection = bulkSelectedKeys.length > 0;

  const toggleBulkSelect = (skillKey: string) => {
    const normalizedId = normalizeSkillKey(skillKey);
    setBulkSelectedKeys((prev) => {
      const prevSet = new Set(prev.map(normalizeSkillKey));
      if (prevSet.has(normalizedId)) {
        return prev.filter((id) => normalizeSkillKey(id) !== normalizedId);
      }
      return [...prev, normalizedId];
    });
  };

  const bulkEnable = () => {
    let next = selectedSkills;
    for (const skillKey of bulkSelectedKeys) {
      const skill = findCatalogSkillByKey(skillKey, availableSkills);
      if (skill) next = addCatalogSkillToSelection(skill, next, availableSkills);
    }
    onChange(next);
    setBulkSelectedKeys([]);
    setIsBulkMode(false);
  };

  const bulkDisable = () => {
    const skillsToRemove = bulkSelectedKeys
      .map((skillKey) => findCatalogSkillByKey(skillKey, availableSkills))
      .filter((skill): skill is Skill => Boolean(skill));
    onChange(removeCatalogSkillsFromSelection(skillsToRemove, selectedSkills, availableSkills));
    setBulkSelectedKeys([]);
    setIsBulkMode(false);
  };

  if (sectionSkills.length === 0 && variant !== 'content') {
    return null;
  }

  const sectionClasses =
    variant === 'nested'
      ? skillPickerSectionNestedClasses
      : variant === 'content'
        ? 'space-y-3'
        : skillPickerSectionCardClasses;

  return (
    <section
      className={sectionClasses}
      data-testid={`${testIdPrefix}-section`}
    >
      {variant !== 'content' ? (
        <div className="space-y-1">
          <Label className={skillPickerLabelClasses}>{title}({enabledCount})</Label>
          {description ? <p className="text-[13px] text-foreground/60 leading-relaxed">{description}</p> : null}
        </div>
      ) : null}

      {showSearch ? (
        <SkillPickerSearch
          value={query}
          onChange={setQuery}
          placeholder={searchPlaceholder}
          testId={`${testIdPrefix}-search`}
        />
      ) : null}

      <div className="flex flex-wrap gap-2">
        {!isBulkMode ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setBulkSelectedKeys([]);
              setIsBulkMode(true);
            }}
            disabled={visibleKeys.length === 0}
            data-testid={`${testIdPrefix}-bulk-enter`}
            className={skillPickerBulkButtonClasses}
          >
            {t('skills.bulkSelect')}
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setBulkSelectedKeys([...visibleKeys])}
              disabled={visibleKeys.length === 0}
              data-testid={`${testIdPrefix}-bulk-select-all`}
              className={skillPickerBulkButtonClasses}
            >
              {t('skills.bulkSelectAll')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setBulkSelectedKeys([])}
              disabled={!hasBulkSelection}
              data-testid={`${testIdPrefix}-bulk-clear`}
              className={skillPickerBulkButtonClasses}
            >
              {t('skills.bulkClear')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={bulkEnable}
              disabled={!hasBulkSelection}
              data-testid={`${testIdPrefix}-bulk-enable`}
              className={skillPickerBulkButtonClasses}
            >
              {t('skills.bulkEnable')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={bulkDisable}
              disabled={!hasBulkSelection}
              data-testid={`${testIdPrefix}-bulk-disable`}
              className={skillPickerBulkButtonClasses}
            >
              {t('skills.bulkDisable')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setBulkSelectedKeys([]);
                setIsBulkMode(false);
              }}
              data-testid={`${testIdPrefix}-bulk-exit`}
              className={skillPickerBulkButtonClasses}
            >
              {t('skills.bulkExit')}
            </Button>
          </>
        )}
      </div>

      <SkillListRows
        skills={filteredSkills}
        availableSkills={availableSkills}
        selectedSkills={selectedSkills}
        onChange={onChange}
        emptyText={emptyText}
        testIdPrefix={testIdPrefix}
        isBulkMode={isBulkMode}
        bulkSelectedSet={bulkSelectedSet}
        onBulkToggle={toggleBulkSelect}
        getSkillDescription={getSkillDescription}
        t={t}
      />
    </section>
  );
}

export function SkillAllowlistPicker({
  availableSkills,
  selectedSkills,
  onChange,
  title,
  description,
  searchPlaceholder,
  emptyText,
  testIdPrefix,
  globalSkillIds,
  globalSectionTitle,
  globalSectionDescription,
  otherSectionTitle,
  otherSectionDescription,
  pageSectionLayout: pageSectionLayoutProp,
  groupDualSections,
  sessionKey: sessionKeyProp,
  initialSelectedSkills,
  isLoading,
}: SkillAllowlistPickerProps) {
  const { t } = useTranslation('agents');
  const pageSectionLayout = pageSectionLayoutProp ?? groupDualSections ?? false;

  const globalSkillIdSet = useMemo(
    () => new Set((globalSkillIds || []).map(normalizeSkillKey)),
    [globalSkillIds],
  );
  const isDualMode = Boolean(globalSectionTitle && otherSectionTitle);

  const getSkillName = useCallback((skill: Skill) => skill.name, []);
  const sessionSkillOrder = usePickerSessionOrder({
    sessionKey: sessionKeyProp === undefined ? 'picker-session' : sessionKeyProp,
    items: availableSkills,
    getKey: canonicalSkillKeyFromSkill,
    getName: getSkillName,
    getInitialSelectedKeys: useCallback(
      () => initialSelectedSkills ?? selectedSkills,
      [initialSelectedSkills, selectedSkills],
    ),
    isItemSelected: useCallback(
      (skill: Skill, selectedKeys: readonly string[]) =>
        isCatalogSkillSelected(skill, [...selectedKeys], availableSkills),
      [availableSkills],
    ),
  });

  const sortSkills = useCallback((skills: Skill[]) => {
    if (sessionSkillOrder.length === 0) {
      return skills;
    }
    return orderItemsBySessionKeys(
      skills,
      sessionSkillOrder,
      canonicalSkillKeyFromSkill,
      (skill) => skill.name,
    );
  }, [sessionSkillOrder]);

  const globalSkills = useMemo(() => {
    if (!isDualMode) return [];
    return sortSkills(
      availableSkills.filter((skill) => globalSkillIdSet.has(canonicalSkillKeyFromSkill(skill))),
    );
  }, [availableSkills, globalSkillIdSet, isDualMode, sortSkills]);

  const otherSkills = useMemo(() => {
    if (!isDualMode) return [];
    return sortSkills(
      availableSkills.filter((skill) => !globalSkillIdSet.has(canonicalSkillKeyFromSkill(skill))),
    );
  }, [availableSkills, globalSkillIdSet, isDualMode, sortSkills]);

  const flatSkills = useMemo(() => {
    if (isDualMode) return [];
    return sortSkills(availableSkills);
  }, [availableSkills, isDualMode, sortSkills]);

  const getSkillDescription = (skill: Skill): string => {
    const i18nKey = `skills.descriptions.${skill.id}`;
    const translated = t(i18nKey, { defaultValue: '' });
    if (translated && translated !== i18nKey) return translated;
    return skill.description || '';
  };

  const sectionProps = {
    availableSkills,
    selectedSkills,
    onChange,
    searchPlaceholder,
    emptyText,
    getSkillDescription,
    t,
  };

  if (isDualMode) {
    // Both sections hide themselves when they have no skills, so an empty
    // availableSkills would render nothing at all — indistinguishable from a
    // transient blank. Show an explicit loading/empty affordance instead.
    if (availableSkills.length === 0) {
      const placeholder = isLoading
        ? t('skills.loadingSkills', { defaultValue: '加载技能中…' })
        : emptyText;
      const body = (
        <p
          className="text-[13px] text-foreground/60 leading-relaxed"
          data-testid={`${testIdPrefix}-empty`}
        >
          {placeholder}
        </p>
      );
      if (pageSectionLayout) {
        return (
          <div className={skillPickerPageSectionClasses} data-testid={`${testIdPrefix}-group`}>
            <SkillPickerPageSectionHeader title={title} description={description} count={0} />
            <section className={skillPickerSectionCardClasses}>{body}</section>
          </div>
        );
      }
      return (
        <div className="space-y-4" data-testid={`${testIdPrefix}-dual`}>{body}</div>
      );
    }

    if (pageSectionLayout) {
      const totalEnabledCount = countSelectedCatalogSkills(availableSkills, selectedSkills);
      return (
        <div className={skillPickerPageSectionClasses} data-testid={`${testIdPrefix}-group`}>
          <SkillPickerPageSectionHeader
            title={title}
            description={description}
            count={totalEnabledCount}
          />
          <section className={skillPickerSectionCardClasses}>
            <div className="space-y-1">
              <SkillPickerSection
                {...sectionProps}
                variant="nested"
                title={globalSectionTitle!}
                description={globalSectionDescription}
                enabledCount={countSelectedCatalogSkills(globalSkills, selectedSkills)}
                sectionSkills={globalSkills}
                testIdPrefix={`${testIdPrefix}-global`}
              />
              <SkillPickerSection
                {...sectionProps}
                variant="nested"
                title={otherSectionTitle!}
                description={otherSectionDescription}
                enabledCount={countSelectedCatalogSkills(otherSkills, selectedSkills)}
                sectionSkills={otherSkills}
                testIdPrefix={`${testIdPrefix}-other`}
              />
            </div>
          </section>
        </div>
      );
    }

    return (
      <div className="space-y-4" data-testid={`${testIdPrefix}-dual`}>
        <SkillPickerSection
          {...sectionProps}
          title={globalSectionTitle!}
          description={globalSectionDescription}
          enabledCount={countSelectedCatalogSkills(globalSkills, selectedSkills)}
          sectionSkills={globalSkills}
          testIdPrefix={`${testIdPrefix}-global`}
        />
        <SkillPickerSection
          {...sectionProps}
          title={otherSectionTitle!}
          description={otherSectionDescription}
          enabledCount={countSelectedCatalogSkills(otherSkills, selectedSkills)}
          sectionSkills={otherSkills}
          testIdPrefix={`${testIdPrefix}-other`}
        />
      </div>
    );
  }

  const flatEnabledCount = countSelectedCatalogSkills(availableSkills, selectedSkills);

  if (pageSectionLayout) {
    return (
      <div className={skillPickerPageSectionClasses} data-testid={`${testIdPrefix}-group`}>
        <SkillPickerPageSectionHeader
          title={title}
          description={description}
          count={flatEnabledCount}
        />
        <section className={skillPickerSectionCardClasses}>
          <SkillPickerSection
            {...sectionProps}
            variant="content"
            title={title}
            description={description}
            enabledCount={flatEnabledCount}
            sectionSkills={flatSkills}
            testIdPrefix={testIdPrefix}
          />
        </section>
      </div>
    );
  }

  return (
    <SkillPickerSection
      {...sectionProps}
      title={title}
      description={description}
      enabledCount={flatEnabledCount}
      sectionSkills={flatSkills}
      testIdPrefix={testIdPrefix}
    />
  );
}
