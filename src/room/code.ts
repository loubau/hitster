/* Room codes are four capitals read out across a table, so no I or O (they pass for 1 and 0). */
export const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function newCode(random: () => number = Math.random): string {
  return Array.from({ length: 4 }, () => CODE_LETTERS[Math.floor(random() * CODE_LETTERS.length)]).join('');
}

/** "ab cd", "abcd " → "ABCD"; null unless it is four code letters. */
export function normaliseCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[^A-Z]/g, '');
  return code.length === 4 && [...code].every((c) => CODE_LETTERS.includes(c)) ? code : null;
}

/** The room in this page's address (?room=ABCD), if any. */
export function codeFromUrl(search: string = location.search): string | null {
  const raw = new URLSearchParams(search).get('room');
  return raw ? normaliseCode(raw) : null;
}

export function roomLink(code: string): string {
  return `${location.origin}${location.pathname}?room=${code}`;
}

/** Puts ?room=CODE in the address bar (or takes it out), so a reload lands back in the room. */
export function showRoomInUrl(code: string | null) {
  const url = new URL(location.href);
  if (code) url.searchParams.set('room', code);
  else url.searchParams.delete('room');
  history.replaceState(history.state, '', url);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // No async clipboard (plain http, older WebViews): the old textarea trick.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

export const canShare = (): boolean => typeof navigator.share === 'function';

/** Opens the phone's share sheet (WhatsApp and friends). Resolves false when it was dismissed. */
export async function shareRoom(code: string): Promise<boolean> {
  try {
    await navigator.share({ text: `Join my Hitster room: ${roomLink(code)}` });
    return true;
  } catch {
    return false;
  }
}
