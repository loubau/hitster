/* Hand-drawn SVG characters for the steal animations. Colours of the loot card come from --loot. */

export function JazzCat() {
  const fur = '#131318';
  return (
    <svg className="cat" viewBox="0 0 280 210" aria-hidden="true">
      <g className="cat-tail">
        <path d="M72 122 C 34 118, 24 80, 40 54 C 48 42, 62 46, 56 58 C 45 78, 50 102, 80 112 Z" fill={fur} />
      </g>
      <g className="cat-legs" fill={fur}>
        <rect className="leg leg-a" x="86" y="136" width="13" height="50" rx="6.5" />
        <rect className="leg leg-b" x="105" y="136" width="13" height="50" rx="6.5" />
        <rect className="leg leg-b" x="164" y="136" width="13" height="50" rx="6.5" />
        <rect className="leg leg-a cat-paw" x="183" y="136" width="13" height="50" rx="6.5" />
      </g>
      <ellipse cx="132" cy="126" rx="68" ry="31" fill={fur} stroke="#2a2a35" strokeWidth="2" />
      <g className="cat-head">
        <path d="M176 82 L178 48 L198 70 Z M214 70 L236 48 L238 82 Z" fill={fur} />
        <path d="M180 60 L182 66 L190 69 Z M230 60 L229 66 L222 69 Z" fill="#3a2a2e" />
        <circle cx="207" cy="94" r="31" fill={fur} stroke="#2a2a35" strokeWidth="2" />
        {/* half-closed, sly eyes looking right */}
        <path d="M189 93 Q197 85 205 93 Q197 98 189 93 Z M210 93 Q218 85 226 93 Q218 98 210 93 Z" fill="#f2c14e" />
        <ellipse cx="200" cy="93.5" rx="1.6" ry="3.2" fill="#111" />
        <ellipse cx="221" cy="93.5" rx="1.6" ry="3.2" fill="#111" />
        <path d="M187 87 L207 87 L207 92 Q197 89.5 187 92 Z M208 87 L228 87 L228 92 Q218 89.5 208 92 Z" fill={fur} />
        <path d="M205 102 h7 l-3.5 4 z" fill="#e9a0a8" />
        <path d="M200 110 q8 5 16 -3" stroke="#a7a7b4" strokeWidth="2" fill="none" strokeLinecap="round" />
        <g stroke="#d4d4dc" strokeWidth="1.3" strokeLinecap="round">
          <path d="M190 104 L162 99 M190 108 L163 111 M224 104 L254 97 M224 108 L254 110" />
        </g>
        <g className="cat-loot">
          <rect x="214" y="104" width="34" height="27" transform="rotate(14 231 117)" fill="var(--loot, #f3e9d2)" stroke="#111" strokeWidth="2" />
          <path d="M224 113 h14 M224 119 h10" stroke="#111" strokeWidth="2" transform="rotate(14 231 117)" />
        </g>
        <g className="cat-hat">
          <path d="M190 66 C 189 46, 196 36, 207 36 C 218 36, 225 46, 224 66 Z" fill="#2b2420" />
          <path d="M196 43 q11 7 22 0" stroke="#17120f" strokeWidth="3" fill="none" />
          <rect x="190" y="57" width="34" height="7" fill="#d9a84e" />
          <ellipse cx="207" cy="66" rx="36" ry="7" fill="#2b2420" transform="rotate(-7 207 66)" />
        </g>
      </g>
    </svg>
  );
}

export function GrabbyHand() {
  return (
    <svg className="glove" viewBox="0 0 160 330" aria-hidden="true">
      <defs>
        <pattern id="sleeve-stripes" width="20" height="20" patternUnits="userSpaceOnUse" patternTransform="rotate(-20)">
          <rect width="20" height="20" fill="#ff4f9a" />
          <rect width="10" height="20" fill="#fff" />
        </pattern>
      </defs>
      <rect x="50" y="-10" width="60" height="215" fill="url(#sleeve-stripes)" stroke="#111" strokeWidth="5" />
      <rect x="42" y="196" width="76" height="26" rx="10" fill="#fff" stroke="#111" strokeWidth="5" />
      <g className="glove-fingers" stroke="#111" strokeWidth="5" fill="#fff">
        <rect x="40" y="250" width="19" height="52" rx="9.5" />
        <rect x="61" y="256" width="19" height="58" rx="9.5" />
        <rect x="82" y="256" width="19" height="56" rx="9.5" />
        <rect x="103" y="250" width="19" height="48" rx="9.5" />
      </g>
      <ellipse cx="80" cy="248" rx="44" ry="34" fill="#fff" stroke="#111" strokeWidth="5" />
      <path d="M62 236 q18 -8 36 0" stroke="#111" strokeWidth="3.5" fill="none" strokeLinecap="round" />
      <g className="glove-loot">
        <rect x="52" y="292" width="56" height="34" fill="var(--loot, #ffe14d)" stroke="#111" strokeWidth="4" />
      </g>
    </svg>
  );
}

export function Phantom() {
  return (
    <svg className="phantom" viewBox="0 0 420 300" aria-hidden="true">
      <path d="M0 50 C 120 0, 270 8, 420 84 C 345 150, 312 236, 210 300 C 160 232, 70 206, 0 262 Z" fill="#0b0808" />
      <path d="M26 82 C 130 46, 250 52, 372 100 C 318 150, 292 210, 214 262 C 168 214, 92 196, 26 228 Z" fill="#7a1626" />
      <path d="M40 98 C 140 70, 240 76, 340 110" stroke="#d8b45a" strokeWidth="2" fill="none" opacity="0.7" />
      <g className="phantom-mask">
        <path d="M318 60 C 340 38, 386 42, 396 72 C 402 100, 380 126, 352 120 C 334 114, 322 92, 318 60 Z" fill="#f4efe6" stroke="#cdbfa6" strokeWidth="2" />
        <ellipse cx="360" cy="76" rx="10" ry="6" fill="#0b0808" />
        <path d="M384 92 q-8 10 -22 10" stroke="#cdbfa6" strokeWidth="2" fill="none" />
      </g>
      <g className="phantom-loot">
        <rect x="150" y="150" width="60" height="44" fill="var(--loot, #f6efdf)" stroke="#d8b45a" strokeWidth="3" transform="rotate(-10 180 172)" />
      </g>
    </svg>
  );
}

export function Vinyl() {
  return (
    <svg className="vinyl" viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="100" cy="100" r="96" fill="#0d0d0d" />
      {[86, 76, 66, 56, 46].map((r) => (
        <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="#262626" strokeWidth="2" />
      ))}
      <circle cx="100" cy="100" r="30" fill="#ff4f9a" />
      <circle cx="100" cy="100" r="4" fill="#0d0d0d" />
      <path d="M40 46 A 80 80 0 0 1 120 22" stroke="#fff" strokeOpacity="0.25" strokeWidth="6" fill="none" strokeLinecap="round" />
    </svg>
  );
}
