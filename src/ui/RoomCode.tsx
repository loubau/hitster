import { canShare, copyText, roomLink, shareRoom } from '../room/code';

/** A room code as four big tiles, easy to read out across a table. */
export function RoomCode({ code }: { code: string }) {
  return (
    <div className="room-code" role="img" aria-label={`Room code ${code.split('').join(' ')}`}>
      {code.split('').map((c, i) => (
        <span key={i} aria-hidden="true">
          {c}
        </span>
      ))}
    </div>
  );
}

/** Copy or share the room's link; `say` puts how it went in a toast. Share is null where the browser can't. */
export function inviteTo(code: string, say: (text: string) => void) {
  return {
    copy: () => void copyText(roomLink(code)).then((ok) => say(ok ? 'Link copied' : "Couldn't copy; read out the code")),
    share: canShare() ? () => void shareRoom(code) : null,
  };
}
