/* Flat-cute blue bird in the charmArt visual language. Serves as the picker
   thumbnail, the loading placeholder, and the permanent fallback if WebGL or
   the GLB fails — so it must never import three. */
export function BirdGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" style={{ display: "block", overflow: "visible" }}>
      {/* tail feathers */}
      <path d="M16 38 L3 28 L8 40 L2 42 L12 46 Z" fill="#4a90d9" />
      <path d="M15 40 L7 36 L11 43 Z" fill="#6db3f2" opacity="0.9" />

      {/* body */}
      <circle cx="34" cy="38" r="21" fill="#4a90d9" />
      {/* crown highlight */}
      <path d="M15 30 A21 21 0 0 1 51 25 Q44 20 34 20 Q22 20 15 30 Z" fill="#6db3f2" />
      {/* belly */}
      <ellipse cx="31" cy="47" rx="13" ry="10" fill="#fff3d6" />

      {/* wing */}
      <ellipse cx="26" cy="38" rx="10" ry="7" fill="#3d7ec2" transform="rotate(-24 26 38)" />
      <ellipse cx="25" cy="36" rx="7" ry="4.4" fill="#6db3f2" opacity="0.55" transform="rotate(-24 25 36)" />

      {/* beak */}
      <path d="M53 33 L62 36.5 L53 40 Q54.5 36.5 53 33 Z" fill="#f5a623" />
      <path d="M53 36.5 L62 36.5 L53 40 Q53.8 38.2 53 36.5 Z" fill="#d98d13" />

      {/* eye */}
      <circle cx="45" cy="31" r="5.2" fill="#ffffff" />
      <circle cx="46.2" cy="31.6" r="3" fill="#241811" />
      <circle cx="47.3" cy="30.4" r="1.1" fill="#ffffff" />

      {/* cheek blush */}
      <ellipse cx="49" cy="39" rx="3" ry="2" fill="#f7b6a0" opacity="0.7" />

      {/* feet gripping the seat */}
      <path d="M28 58 L28 62 M26 62 L30 62" stroke="#f5a623" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M38 58 L38 62 M36 62 L40 62" stroke="#f5a623" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
