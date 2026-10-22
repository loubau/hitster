import { SET_INFO, cardsFor, countBySet } from '../data/cards';
import { BUY_COST, SKIP_COST, buyAllowed, skipAllowed } from '../engine/game';
import type { SetId, Settings, Variant } from '../engine/types';
import { timerSeconds } from '../room/timer';
import { Icon } from './Icon';

const VARIANTS: { id: Variant; name: string; blurb: string }[] = [
  { id: 'original', name: 'Original', blurb: 'Place it right, keep it' },
  { id: 'pro', name: 'Pro', blurb: 'Also name it to keep it' },
  { id: 'expert', name: 'Expert', blurb: 'Name it and the exact year' },
];

const SET_SAMPLE: Record<SetId, { year: string; top: string; bottom: string }> = {
  regular: { year: '1975', top: 'Pop', bottom: 'Elvis to Eilish' },
  jazz: { year: '1959', top: 'Jazz', bottom: 'Ellington to Ezra Collective' },
  classical: { year: '1808', top: 'Classical', bottom: 'Palestrina to Pärt' },
};

const chips = (n: number) => `${n} chip${n === 1 ? '' : 's'}`;
const BUY_LABEL = `Buy a card (${chips(BUY_COST)})`;
const SKIP_LABEL = `Skip a song (${chips(SKIP_COST)})`;
const TIMER_LABEL = 'Seconds to challenge';
const TARGET_MIN = 5;

/** The chosen sets by name, in the picker's order whatever order they were tapped in. */
const setNames = (settings: Settings) =>
  (Object.keys(SET_INFO) as SetId[])
    .filter((id) => settings.sets.includes(id))
    .map((id) => SET_INFO[id].name)
    .join(', ');

/** Why these settings can't be dealt to this many players, if they can't. */
export function dealProblem(settings: Settings, players: number): string | null {
  if (settings.sets.length === 0) return 'Pick at least one set of cards';
  if (cardsFor(settings).length < players + 10) return 'Not enough cards in these sets yet';
  return null;
}

function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="stepper">
      <span>{label}</span>
      <div>
        <button type="button" aria-label={`Fewer: ${label}`} onClick={() => onChange(Math.max(min, value - step))}>
          <Icon name="minus" size={16} />
        </button>
        <b>{value}</b>
        <button type="button" aria-label={`More: ${label}`} onClick={() => onChange(Math.min(max, value + step))}>
          <Icon name="plus" size={16} />
        </button>
      </div>
    </div>
  );
}

/**
 * Which cards and the house rules: the table's setup, a room host's lobby, and both mid-game
 * (`playing`), where the target can't drop to `minTarget` and starting chips are long gone.
 */
export function Rules({
  settings,
  onChange,
  room = false,
  playing = false,
  minTarget = TARGET_MIN,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  room?: boolean;
  playing?: boolean;
  minTarget?: number;
}) {
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
        <Stepper
          label="Cards to win"
          value={settings.target}
          min={Math.max(TARGET_MIN, minTarget)}
          max={Math.max(20, minTarget)}
          onChange={(target) => update({ target })}
        />
        {!playing && (
          <Stepper label="Starting chips" value={settings.startChips} min={0} max={settings.maxChips} onChange={(startChips) => update({ startChips })} />
        )}
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
          <Stepper label={TIMER_LABEL} value={timerSeconds(settings)} min={5} max={30} step={5} onChange={(challengeTimer) => update({ challengeTimer })} />
        )}
      </section>
    </>
  );
}

/** The rules as a room guest sees them: the host sets them. */
export function RulesSummary({
  settings,
  host,
  playing = false,
  title = `House rules, set by ${host}`,
}: {
  settings: Settings;
  host: string;
  playing?: boolean;
  title?: string;
}) {
  const variant = VARIANTS.find((v) => v.id === settings.variant) ?? VARIANTS[0];
  const sets = setNames(settings) || 'None yet';
  const rows: [string, string][] = [
    ['Cards', settings.sets.includes('regular') && settings.includeDutch ? `${sets}, with Dutch and Flemish hits` : sets],
    ['Game', `${variant.name}: ${variant.blurb.toLowerCase()}`],
    ['Cards to win', String(settings.target)],
    playing ? ['Most chips you can hold', String(settings.maxChips)] : ['Starting chips', `${settings.startChips}, at most ${settings.maxChips}`],
    [BUY_LABEL, buyAllowed(settings) ? 'Yes' : 'No'],
    [SKIP_LABEL, skipAllowed(settings) ? 'Yes' : 'No'],
    ['Challenge timer', `${timerSeconds(settings)} s`],
  ];
  return (
    <section className="setup-block">
      <h2>{title}</h2>
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

const onOff = (on: boolean) => (on ? 'on' : 'off');

/** What changed between two sets of rules, one short phrase each: "Cards to win 10 → 12". */
export function describeChanges(a: Settings, b: Settings): string[] {
  const variant = (s: Settings) => VARIANTS.find((v) => v.id === s.variant)?.name ?? s.variant;
  const out: string[] = [];
  if (setNames(a) !== setNames(b)) out.push(`Cards: ${setNames(b)}`);
  if (a.includeDutch !== b.includeDutch && b.sets.includes('regular')) out.push(`Dutch and Flemish hits ${onOff(b.includeDutch)}`);
  if (a.variant !== b.variant) out.push(`${variant(a)} → ${variant(b)} rules`);
  if (a.target !== b.target) out.push(`Cards to win ${a.target} → ${b.target}`);
  if (a.maxChips !== b.maxChips) out.push(`Most chips ${a.maxChips} → ${b.maxChips}`);
  if (buyAllowed(a) !== buyAllowed(b)) out.push(`Buying cards ${onOff(buyAllowed(b))}`);
  if (skipAllowed(a) !== skipAllowed(b)) out.push(`Skipping songs ${onOff(skipAllowed(b))}`);
  if (timerSeconds(a) !== timerSeconds(b)) out.push(`Challenge timer ${timerSeconds(a)} → ${timerSeconds(b)} s`);
  return out;
}
