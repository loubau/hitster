import { SET_INFO, cardsFor, countBySet } from '../data/cards';
import { BUY_COST, SKIP_COST, buyAllowed, skipAllowed } from '../engine/game';
import type { SetId, Settings, Variant } from '../engine/types';
import { TIMER_SECONDS, timerMs } from '../room/timer';
import { Icon } from './Icon';

const VARIANTS: { id: Variant; name: string; blurb: string }[] = [
  { id: 'original', name: 'Original', blurb: 'Place it right, keep it' },
  { id: 'pro', name: 'Pro', blurb: 'Also name it to keep it' },
  { id: 'expert', name: 'Expert', blurb: 'Name it and the exact year' },
];

const SET_SAMPLE: Record<SetId, { year: string; top: string; bottom: string }> = {
  regular: { year: '1975', top: 'Pop', bottom: 'Elvis to Eilish' },
  jazz: { year: '1959', top: 'Jazz', bottom: 'Ellington to Esperanza Spalding' },
  classical: { year: '1808', top: 'Classical', bottom: 'Palestrina to Pärt' },
};

const chips = (n: number) => `${n} chip${n === 1 ? '' : 's'}`;
const BUY_LABEL = `Buy a card (${chips(BUY_COST)})`;
const SKIP_LABEL = `Skip a song (${chips(SKIP_COST)})`;
const TIMER_LABEL = `Challenge timer (${TIMER_SECONDS} s)`;

/** Why these settings can't be dealt to this many players, if they can't. */
export function dealProblem(settings: Settings, players: number): string | null {
  if (settings.sets.length === 0) return 'Pick at least one set of cards';
  if (cardsFor(settings).length < players + 10) return 'Not enough cards in these sets yet';
  return null;
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="stepper">
      <span>{label}</span>
      <div>
        <button type="button" aria-label={`Fewer: ${label}`} onClick={() => onChange(Math.max(min, value - 1))}>
          <Icon name="minus" size={16} />
        </button>
        <b>{value}</b>
        <button type="button" aria-label={`More: ${label}`} onClick={() => onChange(Math.min(max, value + 1))}>
          <Icon name="plus" size={16} />
        </button>
      </div>
    </div>
  );
}

/** Which cards and the house rules: the table's setup and a room host's lobby. */
export function Rules({ settings, onChange, room = false }: { settings: Settings; onChange: (s: Settings) => void; room?: boolean }) {
  const counts = countBySet();
  const update = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });
  const toggleSet = (id: SetId) =>
    update({ sets: settings.sets.includes(id) ? settings.sets.filter((s) => s !== id) : [...settings.sets, id] });

  return (
    <>
      <section className="setup-block">
        <h2>Which cards</h2>
        <div className="set-picker">
          {(Object.keys(SET_INFO) as SetId[]).map((id) => {
            const on = settings.sets.includes(id);
            const s = SET_SAMPLE[id];
            return (
              <button key={id} type="button" className={`set-card${on ? ' is-on' : ''}`} onClick={() => toggleSet(id)} aria-pressed={on}>
                <div className={`face card-${id} sample-${id}`}>
                  {id === 'jazz' ? (
                    <div className="face-band">
                      <span>{s.top}</span>
                    </div>
                  ) : (
                    <div className="face-top">{s.top}</div>
                  )}
                  <div className="face-year">{s.year}</div>
                  <div className="face-bottom">
                    <span className="face-title">{s.bottom}</span>
                  </div>
                </div>
                <span className="set-count">
                  {on && <Icon name="check" size={14} />} {counts[id]} cards
                </span>
              </button>
            );
          })}
        </div>
        {settings.sets.includes('regular') && (
          <label className="switch">
            <input type="checkbox" checked={settings.includeDutch} onChange={(e) => update({ includeDutch: e.target.checked })} />
            <span>Include Dutch and Flemish hits</span>
          </label>
        )}
      </section>

      <section className="setup-block">
        <h2>House rules</h2>
        <div className="variants">
          {VARIANTS.map((v) => (
            <button key={v.id} type="button" className={`variant${settings.variant === v.id ? ' is-on' : ''}`} onClick={() => update({ variant: v.id })}>
              <b>{v.name}</b>
              <small>{v.blurb}</small>
            </button>
          ))}
        </div>
        <Stepper label="Cards to win" value={settings.target} min={5} max={20} onChange={(target) => update({ target })} />
        <Stepper label="Starting chips" value={settings.startChips} min={0} max={settings.maxChips} onChange={(startChips) => update({ startChips })} />
        <Stepper label="Most chips you can hold" value={settings.maxChips} min={1} max={10} onChange={(maxChips) => update({ maxChips, startChips: Math.min(settings.startChips, maxChips) })} />
        <label className="switch">
          <input type="checkbox" checked={buyAllowed(settings)} onChange={(e) => update({ allowBuy: e.target.checked })} />
          <span>{BUY_LABEL}</span>
        </label>
        <label className="switch">
          <input type="checkbox" checked={skipAllowed(settings)} onChange={(e) => update({ allowSkip: e.target.checked })} />
          <span>{SKIP_LABEL}</span>
        </label>
        {/* At the table everyone sees everyone hesitate; on separate phones a clock keeps it moving. */}
        {room && (
          <label className="switch">
            <input
              type="checkbox"
              checked={timerMs(settings) > 0}
              onChange={(e) => update({ challengeTimer: e.target.checked ? TIMER_SECONDS : 0 })}
            />
            <span>{TIMER_LABEL}</span>
          </label>
        )}
      </section>
    </>
  );
}

/** The rules as a room guest sees them: the host sets them. */
export function RulesSummary({ settings, host }: { settings: Settings; host: string }) {
  const variant = VARIANTS.find((v) => v.id === settings.variant) ?? VARIANTS[0];
  const sets = settings.sets.map((id) => SET_INFO[id].name).join(', ') || 'None yet';
  const rows: [string, string][] = [
    ['Cards', settings.sets.includes('regular') && settings.includeDutch ? `${sets}, with Dutch and Flemish hits` : sets],
    ['Game', `${variant.name}: ${variant.blurb.toLowerCase()}`],
    ['Cards to win', String(settings.target)],
    ['Starting chips', `${settings.startChips}, at most ${settings.maxChips}`],
    [BUY_LABEL, buyAllowed(settings) ? 'Yes' : 'No'],
    [SKIP_LABEL, skipAllowed(settings) ? 'Yes' : 'No'],
    ['Challenge timer', timerMs(settings) > 0 ? `${settings.challengeTimer} s` : 'Off'],
  ];
  return (
    <section className="setup-block">
      <h2>House rules, set by {host}</h2>
      <dl className="rules-summary">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
