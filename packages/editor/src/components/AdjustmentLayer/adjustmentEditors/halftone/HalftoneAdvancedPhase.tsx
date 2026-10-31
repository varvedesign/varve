import type { Adjustment } from '@varve/scene';
import { Select } from '@varve/ui';
import { DisclosureSection } from '../../../Inspector/controls/DisclosureSection';
import { RangeValueControl } from '../../../Inspector/controls/RangeValueControl';
import type { HalftoneEditorModel } from './useHalftoneModel';

export function HalftoneAdvancedPhase({ model }: { model: HalftoneEditorModel }) {
  const {
    onChange,
    adj,
    handleSelect,
    isCmyk,
    channelAngles,
    registrationOffset,
    setChannelAngle,
    setRegistrationOffset,
    isMonoChannel,
  } = model;

  return (
    <>
      {(isMonoChannel || isCmyk) && (
        <DisclosureSection title="Advanced" id="halftone-advanced" defaultExpanded={false}>
          {isCmyk && (
            <>
              <div className="adj-editor__row">
                <span className="adj-editor__label">Black</span>
                <Select
                  label="Black generation"
                  value={adj.blackGeneration ?? 'none'}
                  options={[
                    { value: 'none', label: 'None (CMY only)' },
                    { value: 'gcr', label: 'GCR (full gray component)' },
                    { value: 'ucr', label: 'UCR (shadows only)' },
                  ]}
                  onChange={handleSelect('blackGeneration')}
                />
              </div>
              {(adj.blackGeneration ?? 'none') !== 'none' && (
                <div className="adj-editor__slider-row">
                  <div className="adj-editor__slider-label">
                    <span>Black strength</span>
                    <span>{Math.round((adj.gcrStrength ?? 0.5) * 100)}%</span>
                  </div>
                  <RangeValueControl
                    label="Black generation strength"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round((adj.gcrStrength ?? 0.5) * 100)}
                    unit="%"
                    onChange={(value) =>
                      onChange({ gcrStrength: value / 100 } as unknown as Partial<Adjustment>)
                    }
                  />
                </div>
              )}
              <div className="adj-editor__slider-row">
                <div className="adj-editor__slider-label">
                  <span>Total ink limit</span>
                  <span>{Math.round((adj.tacLimit ?? 1) * 100)}%</span>
                </div>
                <RangeValueControl
                  label="Total area coverage limit"
                  min={50}
                  max={100}
                  step={1}
                  value={Math.round((adj.tacLimit ?? 1) * 100)}
                  unit="%"
                  onChange={(value) =>
                    onChange({ tacLimit: value / 100 } as unknown as Partial<Adjustment>)
                  }
                />
              </div>
              <div className="adj-editor__row">
                <span className="adj-editor__label">Show ink</span>
                <Select
                  label="Channel preview"
                  value={adj.previewChannel ?? 'composite'}
                  options={[
                    { value: 'composite', label: 'Composite' },
                    { value: 'c', label: 'Cyan' },
                    { value: 'm', label: 'Magenta' },
                    { value: 'y', label: 'Yellow' },
                    { value: 'k', label: 'Black' },
                  ]}
                  onChange={handleSelect('previewChannel')}
                />
              </div>
              {(['c', 'm', 'y', 'k'] as const).map((ink) => (
                <div className="adj-editor__row" key={ink}>
                  <span className="adj-editor__label">{ink.toUpperCase()} angle / offset</span>
                  <div className="adj-editor__ink-row">
                    <input
                      type="number"
                      className="adj-editor__number"
                      min={0}
                      max={360}
                      step={1}
                      value={channelAngles[ink] ?? ''}
                      placeholder={
                        ink === 'c' ? '15' : ink === 'm' ? '75' : ink === 'y' ? '0' : '45'
                      }
                      aria-label={`${ink.toUpperCase()} screen angle`}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (event.target.value === '') {
                          const next = { ...channelAngles };
                          delete next[ink];
                          onChange({ channelAngles: next } as unknown as Partial<Adjustment>);
                        } else {
                          setChannelAngle(ink)(value);
                        }
                      }}
                    />
                    <input
                      type="number"
                      className="adj-editor__number"
                      step={1}
                      value={registrationOffset[ink]?.[0] ?? 0}
                      aria-label={`${ink.toUpperCase()} registration X offset`}
                      onChange={(event) =>
                        setRegistrationOffset(ink, 0)(Number(event.target.value))
                      }
                    />
                    <input
                      type="number"
                      className="adj-editor__number"
                      step={1}
                      value={registrationOffset[ink]?.[1] ?? 0}
                      aria-label={`${ink.toUpperCase()} registration Y offset`}
                      onChange={(event) =>
                        setRegistrationOffset(ink, 1)(Number(event.target.value))
                      }
                    />
                  </div>
                </div>
              ))}
              <p className="adj-editor__hint">
                CMYK is an uncalibrated process-screen preview, not an ICC separation. Per-channel
                angles override the standard press angles (C 15°, M 75°, Y 0°, K 45°); offsets are
                in document pixels.
              </p>
            </>
          )}
          {isMonoChannel && (
            <>
              <div className="adj-editor__slider-row">
                <div className="adj-editor__slider-label">
                  <span>Dot gain</span>
                  <span>{Math.round((adj.dotGain ?? 0) * 100)}%</span>
                </div>
                <RangeValueControl
                  label="Dot gain compensation"
                  min={0}
                  max={50}
                  step={1}
                  value={Math.round((adj.dotGain ?? 0) * 100)}
                  unit="%"
                  onChange={(value) =>
                    onChange({ dotGain: value / 100 } as unknown as Partial<Adjustment>)
                  }
                />
              </div>
              <p className="adj-editor__hint">
                Dot gain expands midtone coverage as printed ink spreads, without changing the paper
                or solid endpoints.
              </p>
            </>
          )}
        </DisclosureSection>
      )}
    </>
  );
}
