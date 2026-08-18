/**
 * Kind-specific extra params editor.
 *
 * Renders the config-driven extra params for one ModelKind (e.g. voice kinds:
 * voice / format / speed / language …). The field list comes from
 * `getKindParamFields`, which prefers a provider's `kindParamsSchema`
 * (providers.json) and falls back to DEFAULT_VOICE_KIND_PARAMS for voice kinds.
 *
 * Extracted into its own module so both the add-provider dialog and the
 * provider-card editor (and any future surfaces) can reuse it without coupling
 * to ProvidersSettings. Adding params for a new model kind needs no change
 * here — just declare a `kindParamsSchema` entry for that kind.
 */
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { getKindParamFields, type ModelKind, type KindParamsSchema } from '@/lib/providers';

export function KindParamsEditor({
  kind,
  info,
  values,
  onChange,
  inputClasses,
}: {
  kind: ModelKind;
  info: { kindParamsSchema?: KindParamsSchema } | undefined | null;
  values: Record<string, string | number | boolean> | undefined;
  onChange: (next: Record<string, string | number | boolean>) => void;
  inputClasses: string;
}) {
  const { t } = useTranslation('settings');
  const fields = getKindParamFields(info, kind);
  if (fields.length === 0) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pl-[128px]" data-testid={`kind-params-${kind}`}>
      {fields.map((field) => {
        const label = t(`aiProviders.kindParams.${field.key}`, field.key);
        const raw = values?.[field.key];
        const value = raw === undefined ? '' : String(raw);
        const placeholder = field.placeholder ?? (field.default != null ? String(field.default) : undefined);
        const testId = `kind-param-${kind}-${field.key}`;
        const setValue = (v: string) => {
          const next = { ...(values ?? {}) };
          if (!v.trim()) {
            delete next[field.key];
          } else {
            next[field.key] = field.type === 'number' && !Number.isNaN(Number(v)) ? Number(v) : v;
          }
          onChange(next);
        };
        return (
          <div key={field.key} className="space-y-1">
            <Label className="text-[12px] text-muted-foreground">{label}</Label>
            {field.type === 'select' || field.type === 'combobox' ? (
              <Combobox
                value={value}
                onChange={setValue}
                options={field.options ?? []}
                placeholder={placeholder}
                className={cn(inputClasses, "w-full")}
                emptyOptionLabel={field.type === 'select' ? t('aiProviders.kindParams.default', 'Default') : undefined}
                data-testid={testId}
              />
            ) : (
              <Input
                type={field.type === 'number' ? 'number' : 'text'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={placeholder}
                min={field.type === 'number' ? field.min : undefined}
                max={field.type === 'number' ? field.max : undefined}
                step={field.type === 'number' ? field.step : undefined}
                className={cn(inputClasses, "w-full")}
                data-testid={testId}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
