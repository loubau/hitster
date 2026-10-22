import { useEffect, useState } from 'react';
import { Icon } from './Icon';

export interface MenuItem {
  id: string;
  label: string;
  /** Asked in place on the first tap ("Sure? End game"); the second tap runs it. */
  confirm?: string;
  onSelect: () => void;
}

/** The menu button in the game header and the slip of paper it drops. */
export function Menu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const close = () => {
    setOpen(false);
    setArmed(null);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="menu">
      <button
        type="button"
        className="menu-btn"
        aria-label="Menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Icon name={open ? 'cross' : 'menu'} />
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={close} />
          <div className="menu-slip" role="menu">
            {items.map((item) => {
              const asking = armed === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  className={`menu-item${asking ? ' is-armed' : ''}`}
                  onClick={() => {
                    if (item.confirm && !asking) return setArmed(item.id);
                    close();
                    item.onSelect();
                  }}
                >
                  {asking ? item.confirm : item.label}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
