import { Switch } from '@varve/ui';

export function BooleanRow({
  label,
  checked,
  onChange,
  ariaLabel,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="adj-editor__row">
      <Switch
        className="adj-editor__checkbox-row"
        label={label}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={ariaLabel ?? label}
      />
    </div>
  );
}
