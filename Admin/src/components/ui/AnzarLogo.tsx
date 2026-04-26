/**
 * ANZAR Logo — SVG fidele au design officiel
 * "A" blanc sur fond navy, barre indigo horizontale avec point violet lumineux
 */

interface AnzarLogoProps {
  size?: number;
  className?: string;
  iconOnly?: boolean;
}

export default function AnzarLogo({ size = 32, className = '', iconOnly = false }: AnzarLogoProps) {
  if (iconOnly) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
      >
        <path d="M50 10L18 85H30L38 65H62L70 85H82L50 10Z" fill="white" />
        <path d="M42 55L50 33L58 55H42Z" fill="#1a1a3e" />
        <rect x="32" y="52" width="42" height="8" rx="4" fill="#6366f1" />
        <circle cx="74" cy="56" r="6" fill="#a78bfa" />
        <circle cx="74" cy="56" r="3" fill="#c4b5fd" opacity="0.7" />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <rect x="4" y="4" width="112" height="112" rx="26" fill="#141432" />
      <rect x="4" y="4" width="112" height="112" rx="26" stroke="#2a2a5a" strokeWidth="1.5" />
      <path d="M60 22L28 95H40L48 75H72L80 95H92L60 22Z" fill="white" fillOpacity="0.95" />
      <path d="M52 65L60 43L68 65H52Z" fill="#141432" />
      <rect x="40" y="62" width="44" height="8" rx="4" fill="#6366f1" />
      <circle cx="84" cy="66" r="6.5" fill="#a78bfa" />
      <circle cx="84" cy="66" r="3.5" fill="#c4b5fd" opacity="0.6" />
    </svg>
  );
}

export { AnzarLogo };
