# /// script
# requires-python = ">=3.10"
# dependencies = ["yt-dlp"]
# ///
"""Find embeddable YouTube videos for the cards in data/sets/<set>/*.json.

    uv run scripts/resolve_youtube.py regular jazz classical
    uv run scripts/resolve_youtube.py regular --limit 10
    uv run scripts/resolve_youtube.py jazz --refresh

A plain re-run searches cards that are new or whose search query or track duration changed since.

Writes
  data/youtube.json         {cardId: ["videoId", "videoId@37", ...]}, best first; bundled into the app.
                            "@37" is the card's track.start, kept only where the video's length is
                            within 10% of track.duration (else the review marks it "start-unverified").
  data/youtube-review.json  per card: query, picked candidates with scores, and a "flag" when weak.
Reads
  data/youtube-overrides.json  optional, hand-edited {cardId: ["videoId", "videoId@37", ...]}; always wins.

Only searches and checks oEmbed metadata; nothing is downloaded.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from yt_dlp import YoutubeDL

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'
SETS = DATA / 'sets'
OUT = DATA / 'youtube.json'
REVIEW = DATA / 'youtube-review.json'
OVERRIDES = DATA / 'youtube-overrides.json'

SEARCH_SIZE = 8
KEEP = 3
CHECK_TOP = 6  # oEmbed-check at most this many, best first, to find KEEP embeddable ones
WEAK_SCORE = 65
SAVE_EVERY = 20
START_FIT = 0.10  # a theme start only carries over to a video this close to track.duration

STOP = {
    'the', 'a', 'an', 'and', 'of', 'his', 'her', 'their', 'feat', 'ft', 'featuring', 'with', 'to', 'in', 'on',
    'no', 'op', 'de', 'het', 'een', 'van', 'der', 'den', 'la', 'le', 'les', 'el', 'los', 'y', 'et', 'und', 'die', 'das',
}
# Words in a video title that usually mean "not the record on the card": (pattern, penalty).
PENALTIES = [
    (r'live', 15), (r'en vivo|ao vivo|unplugged|in concert|acoustic|akoestisch', 12), (r'cover', 25), (r'karaoke', 40),
    (r'remix|rework|bootleg', 20), (r'sped up|speed up', 40), (r'slowed', 40), (r'nightcore', 40), (r'reverb', 20),
    (r'reaction|reacts?', 40), (r'tutorial|lesson|how to play', 40), (r'instrumental', 20), (r'8d', 35),
    (r'full album|compilation|playlist|greatest hits|best of|top \d+', 30), (r'medley|megamix|mashup', 25),
    (r'parody', 30), (r'bass boosted', 35), (r'backing track|minus one', 40), (r'a ?cappella', 20),
    (r'1 hour|\d+ hours?', 30), (r'shorts|tiktok', 30),
    (r'interview|documentary|trailer|making of|footnotes|behind the scenes|explained|breakdown|analysis', 40),
    (r'rehearsal|demo', 10), (r'extended', 8), (r'piano version|guitar version', 15),
    # TV appearances: often live vocals or a shortened edit.
    (r'top of the pops|totp|midnight special|ed sullivan|soul train|beat club|musikladen|countdown|beste zangers', 10),
]
ROMAN = {'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9, 'X': 10}
# Classical concert recordings are often billed as live; that is not a warning sign there.
SOFT_LIVE = {'classical': 5, 'jazz': 8}
NOISE = {'official', 'video', 'audio', 'music', 'hd', 'hq', 'remastered', 'remaster', 'lyrics', 'lyric', 'mono', 'stereo'}

print_lock = threading.Lock()


def log(*parts: object) -> None:
    with print_lock:
        print(*parts, flush=True)


# ---------- text matching ----------

def fold(text: str) -> str:
    """Lowercase, strip accents, '&' -> and, possessives off, punctuation to spaces."""
    text = unicodedata.normalize('NFKD', text or '')
    text = ''.join(c for c in text if not unicodedata.combining(c)).lower()
    text = text.replace('&', ' and ').replace('ß', 'ss').replace('ø', 'o').replace('æ', 'ae').replace('ł', 'l')
    text = re.sub(r"['’`´]s\b", '', text)
    text = re.sub(r"['’`´]", '', text)
    return re.sub(r'[^a-z0-9]+', ' ', text).strip()


def tokens(text: str) -> list[str]:
    toks = fold(text).split()
    keep = [t for t in toks if t not in STOP]
    return keep or toks


def compact(text: str) -> str:
    return fold(text).replace(' ', '')


def unbracket(text: str) -> str:
    """Drop bracketed asides: '(We're Gonna) Rock Around the Clock' -> 'Rock Around the Clock'."""
    core = re.sub(r'\([^)]*\)|\[[^\]]*\]', ' ', text or '').strip()
    return core or text or ''


def coverage(needle: list[str], hay: set[str]) -> float:
    if not needle:
        return 0.0
    hits = sum(1 for t in needle if t in hay or (len(t) > 3 and t.rstrip('s') in hay))
    return hits / len(needle)


def title_match(card_title: str, video_title: str, hay: set[str]) -> float:
    core = unbracket(card_title)
    if len(compact(core)) >= 4 and compact(core) in compact(video_title):
        return 1.0
    return max(coverage(tokens(core), hay), 0.9 * coverage(tokens(card_title), hay))


def names_match(a: str, b: str) -> bool:
    ta, tb = set(tokens(a)), set(tokens(b))
    if not ta or not tb:
        return False
    return ta <= tb or tb <= ta or compact(a) == compact(b)


def own_channel(channel: str, artist: str) -> bool:
    """'Bill Haley' or 'BillHaleyVEVO' for 'Bill Haley & His Comets'; not 'Best of Bill Haley'."""
    ch = set(tokens(channel)) - {'official', 'vevo', 'tv', 'channel', 'music'}
    return compact(channel) in (compact(artist), compact(artist) + 'vevo') or (bool(ch) and ch <= set(tokens(artist)))


def movement(text: str, anchored: bool = False) -> int | None:
    """'I. Moderato' -> 1, '3. Rondo' -> 3; with anchored, only at the start (a card's excerpt)."""
    m = re.match(r'\s*([IVX]{1,4}|\d{1,2})\.\s', text or '') if anchored else re.match(r'([IVX]{1,4}|\d{1,2})\.', text)
    if not m:
        return None
    return int(m.group(1)) if m.group(1).isdigit() else ROMAN.get(m.group(1))


def parse_duration(text: str | int | float | None) -> tuple[int | None, bool]:
    """'2:10' -> (130, False); '~4:00' -> (240, True); 130 -> (130, False)."""
    if isinstance(text, (int, float)) and not isinstance(text, bool):
        return (round(text), False) if text > 0 else (None, False)
    if not text or not isinstance(text, str):
        return None, False
    m = re.search(r'(\d+):(\d{2})(?::(\d{2}))?', text)
    if not m:
        return None, False
    h, mm, ss = (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m.group(3) else (0, int(m.group(1)), int(m.group(2)))
    return h * 3600 + mm * 60 + ss, '~' in text or 'c.' in text


# ---------- cards ----------

def describe(set_id: str, raw: dict) -> dict:
    track = raw.get('track') or {}
    if set_id == 'classical':
        artist = raw.get('composer') or ''
        names = [artist, raw.get('composer_short') or '']
        title = raw.get('work') or ''
        excerpt = raw.get('excerpt') or ''
        query = track.get('query') or ' '.join(x for x in (raw.get('composer_short') or artist, title, excerpt) if x)
        label = f'{artist}: {title}' + (f' / {excerpt}' if excerpt else '')
    else:
        artist = track.get('artist') or raw.get('artist') or ''
        names = [artist]
        title = track.get('title') or raw.get('title') or ''
        excerpt = ''
        query = track.get('query') or f'{artist} {title}'
        label = f'{artist} - {title}'
    expected, approx = parse_duration(track.get('duration'))
    start = track.get('start')  # seconds into the track where the recognisable theme begins
    start = parse_duration(start)[0] if isinstance(start, str) and ':' in start else start
    start = start if isinstance(start, (int, float)) and not isinstance(start, bool) and start > 0 else None
    years ={raw.get(k) for k in ('year', 'recording_year', 'release_year')} - {None}
    name_words = {t for n in names if n for t in tokens(n)}
    query_words = [t for t in tokens(track['query']) if t not in name_words and not t.isdigit()] if track.get('query') else []
    return {
        'id': raw['id'], 'set': set_id, 'label': label, 'query': query.strip(), 'artist': artist,
        'names': [n for n in names if n], 'title': title, 'excerpt': excerpt, 'query_words': query_words,
        'expected': expected, 'approx': approx or set_id == 'classical', 'years': {str(y) for y in years},
        'start': start,
    }


def load_cards(sets: list[str]) -> list[dict]:
    cards, seen = [], set()
    for set_id in sets:
        folder = SETS / set_id
        if not folder.is_dir():
            log(f'! no such set: {folder}')
            continue
        for path in sorted(folder.glob('*.json')):
            try:
                content = json.loads(path.read_text(encoding='utf-8'))
            except (OSError, ValueError) as err:
                # Curation agents may be mid-write; the next run picks the file up.
                log(f'! skipping {path.relative_to(ROOT)}: {err}')
                continue
            for raw in content if isinstance(content, list) else []:
                if isinstance(raw, dict) and isinstance(raw.get('id'), str) and raw['id'] not in seen:
                    seen.add(raw['id'])
                    cards.append(describe(set_id, raw))
    return cards


# ---------- scoring ----------

def score(card: dict, e: dict) -> tuple[float, dict]:
    vt, channel = e.get('title') or '', e.get('channel') or e.get('uploader') or ''
    title_hay = set(fold(vt).split())
    all_hay = title_hay | set(fold(channel).split())
    s, why = 0.0, {}

    t = title_match(card['title'], vt, title_hay)
    if card['excerpt']:
        # Classical: the movement often stands in for the work's name in Topic titles.
        t = max(t, 0.5 * t + 0.5 * coverage(tokens(card['excerpt']), title_hay))
    if card['query_words']:
        # Curated queries name the piece the way recordings do; long formal work titles rarely appear verbatim.
        t = max(t, coverage(card['query_words'], title_hay))
    s += 40 * t
    why['title'] = round(t, 2)

    a = max((coverage(tokens(n), all_hay) for n in card['names']), default=0.0)
    s += 25 * a
    why['artist'] = round(a, 2)

    if card['query'] != f"{card['artist']} {card['title']}":
        q = coverage(tokens(card['query']), all_hay)
        s += 15 * q
        why['query'] = round(q, 2)

    if channel.endswith(' - Topic'):
        own = any(names_match(channel[: -len(' - Topic')], n) for n in card['names'])
        s += 22 if own else 6
        why['topic'] = 'artist' if own else 'other'
    elif any(own_channel(channel, n) for n in card['names']):
        s += 12
        why['channel'] = 'artist'

    dur, exp = e.get('duration'), card['expected']
    if dur and exp:
        tol = max(30, 0.25 * exp) if card['approx'] else max(8, 0.06 * exp)
        r = abs(dur - exp) / tol
        s += 15 if r <= 1 else 15 * (1 - (r - 1) / 3) if r <= 4 else -min(15, 2 * (r - 4))
        if dur > 2 * exp + 60:
            s -= 10
        why['dur'] = f'{int(dur)}s vs {exp}s'
    elif dur and dur > 15 * 60 and card['set'] != 'classical':
        s -= 10

    own_words = fold(f"{card['title']} {card['query']} {card['excerpt']}")
    for pattern, penalty in PENALTIES:
        if re.search(rf'\b(?:{pattern})\b', fold(vt)) and not re.search(rf'\b(?:{pattern})\b', own_words):
            if pattern == 'live':
                penalty = SOFT_LIVE.get(card['set'], penalty)
            s -= penalty
            why.setdefault('penalty', []).append(re.search(rf'\b(?:{pattern})\b', fold(vt)).group(0))

    want = movement(card['excerpt'], anchored=True)
    if want:
        found = {movement(m) for m in re.findall(r'(?<![\w.])(?:[IVX]{1,4}|\d{1,2})\.\s+[A-Z]', vt)} - {None}
        if found and want not in found:
            s -= 20
            why['movement'] = sorted(found)

    years = set(re.findall(r'\b(1[89]\d\d|20[0-2]\d)\b(?!\s*remaster)', fold(vt)))
    if years & card['years']:
        s += 3
    elif years and card['set'] != 'regular':
        s -= 4

    s += 0.8 * math.log10(1 + (e.get('view_count') or 0))
    return round(s, 1), why


# ---------- YouTube ----------

def search(query: str) -> list[dict]:
    opts = {'quiet': True, 'no_warnings': True, 'extract_flat': True, 'skip_download': True}
    for attempt in range(3):
        try:
            with YoutubeDL(opts) as ydl:
                info = ydl.extract_info(f'ytsearch{SEARCH_SIZE}:{query}', download=False)
            return [e for e in (info or {}).get('entries') or [] if e and e.get('id')]
        except Exception as err:  # yt-dlp raises many kinds; retry, then give up on this card
            if attempt == 2:
                raise
            log(f'  search retry ({err.__class__.__name__}): {query}')
            time.sleep(3 * (attempt + 1))
    return []


def embeddable(video_id: str) -> bool | None:
    """True/False from YouTube's oEmbed; None when the check itself failed (keep the video then)."""
    url = f'https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json'
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 hitster-resolver'})
    try:
        with urllib.request.urlopen(req, timeout=10):
            return True
    except urllib.error.HTTPError as err:
        return False if err.code in (401, 403, 404) else None
    except (urllib.error.URLError, TimeoutError, OSError):
        return None


def on_topic(cand: dict) -> bool:
    # Off-topic hits are worse than no audio: they would play the wrong song for the round.
    return cand['why']['title'] >= 0.34 or cand['why'].get('query', 0) >= 0.6


def queries(card: dict) -> list[str]:
    """The card's query first; reworded fallbacks because some queries come back empty from ytsearch."""
    title = unbracket(card['title'])
    out = []
    for q in (card['query'], f"{title} {card['artist']}", title if len(compact(title)) >= 4 else ''):
        if q.strip() and q.strip() not in out:
            out.append(q.strip())
    return out


def resolve(card: dict) -> dict:
    seen, scored, searched = set(), [], []
    for query in queries(card):
        searched.append(query)
        for e in search(query):
            if e['id'] in seen or e.get('live_status') in ('is_live', 'is_upcoming') or not e.get('duration'):
                continue
            if e['duration'] < 45 and (card['expected'] or 999) > 60:
                continue  # Shorts and snippets
            seen.add(e['id'])
            sc, why = score(card, e)
            scored.append({
                'id': e['id'], 'title': e.get('title'), 'channel': e.get('channel') or e.get('uploader'),
                'duration': int(e['duration']), 'views': e.get('view_count'), 'score': sc, 'why': why,
            })
        scored.sort(key=lambda c: -c['score'])
        if any(on_topic(c) and c['score'] >= WEAK_SCORE for c in scored):
            break

    picked, dropped = [], []
    for cand in scored[:CHECK_TOP]:
        if len(picked) == KEEP:
            break
        if not on_topic(cand):
            dropped.append({'id': cand['id'], 'reason': 'title mismatch'})
            continue
        ok = embeddable(cand['id'])
        if ok is False:
            dropped.append({'id': cand['id'], 'reason': 'not embeddable or gone'})
            continue
        if ok is None:
            cand['oembed'] = 'unchecked'
        picked.append(cand)

    flags = []
    if not picked:
        flags.append('no candidate')
    else:
        best = picked[0]
        if best['score'] < WEAK_SCORE:
            flags.append(f"weak score {best['score']}")
        if best['why']['title'] < 0.67:
            flags.append('title partly matches')
        exp = card['expected']
        if exp and not card['approx'] and abs(best['duration'] - exp) > max(20, 0.25 * exp):
            flags.append(f"duration {best['duration']}s vs {exp}s")
    review = {'set': card['set'], 'card': card['label'], 'query': card['query'], 'expected': card['expected'],
              'picked': picked}
    if len(searched) > 1:
        review['searched'] = searched
    if dropped:
        review['dropped'] = dropped
    if flags:
        review['flag'] = '; '.join(flags)
    return review


def with_start(card: dict, entry: dict) -> list[str]:
    """The youtube.json ids for a resolved card; marks each picked candidate's start in the review."""
    start, exp = card['start'], card['expected']
    out = []
    for cand in entry['picked']:
        cand.pop('start', None)
        if start:
            if exp and abs(cand['duration'] - exp) <= START_FIT * exp:
                cand['start'] = start
                out.append(f"{cand['id']}@{start:g}")
                continue
            # Another cut or a whole-work upload: the theme is probably somewhere else in it.
            cand['start'] = 'start-unverified'
        out.append(cand['id'])
    return out


# ---------- files ----------

def searched_stale(card: dict, entry: dict) -> bool:
    """The card's recording changed since it was searched (a curator rewrote its track). Older
    entries don't record the expected duration, so only the query counts for them."""
    if entry.get('query') != card['query']:
        return True
    return 'expected' in entry and entry['expected'] != card['expected']


def read_json(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}


def write_atomic(path: Path, text: str) -> None:
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(text, encoding='utf-8')
    os.replace(tmp, path)


def save(ids: dict, review: dict) -> None:
    # One card per line keeps the bundled file small and diffs readable.
    lines = [f'  {json.dumps(k)}: {json.dumps(v)}' for k, v in sorted(ids.items())]
    write_atomic(OUT, '{\n' + ',\n'.join(lines) + '\n}\n')
    write_atomic(REVIEW, json.dumps(dict(sorted(review.items())), ensure_ascii=False, indent=1) + '\n')


def main() -> int:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('sets', nargs='*', default=['regular', 'jazz', 'classical'])
    ap.add_argument('--refresh', action='store_true', help='re-resolve cards already in youtube.json')
    ap.add_argument('--limit', type=int, help='resolve at most N cards (for testing)')
    ap.add_argument('--workers', type=int, default=6)
    args = ap.parse_args()

    ids, review, overrides = read_json(OUT), read_json(REVIEW), read_json(OVERRIDES)
    cards = load_cards(args.sets)
    for card_id, vids in overrides.items():
        if isinstance(vids, list) and vids:
            ids[card_id] = [str(v) for v in vids]
            review.setdefault(card_id, {})['override'] = ids[card_id]

    todo = [c for c in cards if c['id'] not in overrides
            and (args.refresh or c['id'] not in ids or searched_stale(c, review.get(c['id'], {})))]
    if args.limit is not None:
        todo = todo[: args.limit]
    log(f'{len(cards)} cards in {", ".join(args.sets)}; resolving {len(todo)}')

    done = flagged = failed = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(resolve, c): c for c in todo}
        for fut in as_completed(futures):
            card = futures[fut]
            done += 1
            try:
                entry = fut.result()
            except Exception as err:
                failed += 1
                review[card['id']] = {'set': card['set'], 'card': card['label'], 'query': card['query'],
                                      'picked': [], 'flag': f'search failed: {err}'}
                log(f'[{done}/{len(todo)}] {card["id"]}: search failed: {err}')
                continue
            review[card['id']] = entry
            if entry['picked']:
                ids[card['id']] = with_start(card, entry)
            flagged += 'flag' in entry
            best = entry['picked'][0] if entry['picked'] else None
            note = f"{best['score']:>5} {best['channel']} | {best['title']}" if best else '   --'
            log(f"[{done}/{len(todo)}] {card['label'][:60]:<60} {note[:90]}" + (f"  !! {entry['flag']}" if 'flag' in entry else ''))
            if done % SAVE_EVERY == 0:
                save(ids, review)

    # Starts come from the set files, so a plain re-run applies new or changed ones without searching again.
    starts = unverified = 0
    for card in cards:
        entry = review.get(card['id'])
        if card['id'] in overrides or not entry or not entry.get('picked'):
            continue
        ids[card['id']] = with_start(card, entry)
        starts += sum(1 for c in entry['picked'] if isinstance(c.get('start'), (int, float)))
        unverified += sum(1 for c in entry['picked'] if c.get('start') == 'start-unverified')
    save(ids, review)

    in_scope = [c for c in cards if c['id'] in review]
    total_flags = sum(1 for c in in_scope if 'flag' in review[c['id']])
    resolved = sum(1 for c in cards if c['id'] in ids)
    log(f'\nthis run: {done} cards, {flagged} flagged, {failed} failed')
    log(f'{", ".join(args.sets)}: {resolved}/{len(cards)} cards have videos, {total_flags} flagged for review')
    if starts or unverified:
        log(f'theme starts: {starts} videos start at track.start, {unverified} marked start-unverified')
    return 0


if __name__ == '__main__':
    sys.exit(main())
