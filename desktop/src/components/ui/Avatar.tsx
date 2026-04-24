/**
 * Avatar component for user and agent representation.
 * Supports generative geometric avatars with cyber-minimal styling.
 */
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const avatarVariants = cva(
  'inline-flex items-center justify-center overflow-hidden rounded-full border transition-all duration-150 ease-in-out',
  {
    variants: {
      size: {
        xs: 'h-6 w-6 text-xs',
        sm: 'h-8 w-8 text-sm',
        md: 'h-10 w-10 text-base',
        lg: 'h-12 w-12 text-lg',
        xl: 'h-16 w-16 text-xl',
        '2xl': 'h-20 w-20 text-2xl',
      },
      variant: {
        default: 'border-border-subtle bg-bg-tertiary text-text-primary',
        primary: 'border-accent-primary/30 bg-accent-primary/10 text-accent-primary',
        secondary: 'border-accent-secondary/30 bg-accent-secondary/10 text-accent-secondary',
        success: 'border-accent-success/30 bg-accent-success/10 text-accent-success',
        warning: 'border-accent-warning/30 bg-accent-warning/10 text-accent-warning',
        error: 'border-accent-error/30 bg-accent-error/10 text-accent-error',
        ghost: 'border-glass-border bg-glass-bg text-text-secondary',
        glass: 'backdrop-blur-sm border-glass-border bg-glass-bg text-text-primary',
      },
      shape: {
        circle: 'rounded-full',
        square: 'rounded-lg',
        rounded: 'rounded-2xl',
      },
      status: {
        online: 'before:absolute before:right-0 before:top-0 before:z-10 before:h-2.5 before:w-2.5 before:rounded-full before:border-2 before:border-bg-primary before:bg-accent-success before:content-[""]',
        idle: 'before:absolute before:right-0 before:top-0 before:z-10 before:h-2.5 before:w-2.5 before:rounded-full before:border-2 before:border-bg-primary before:bg-accent-warning before:content-[""]',
        offline: 'before:absolute before:right-0 before:top-0 before:z-10 before:h-2.5 before:w-2.5 before:rounded-full before:border-2 before:border-bg-primary before:bg-text-secondary before:content-[""]',
        busy: 'before:absolute before:right-0 before:top-0 before:z-10 before:h-2.5 before:w-2.5 before:rounded-full before:border-2 before:border-bg-primary before:bg-accent-error before:content-[""]',
        none: '',
      },
    },
    defaultVariants: {
      size: 'md',
      variant: 'default',
      shape: 'circle',
      status: 'none',
    },
  }
);

/**
 * Generates a deterministic color from a string (name, id, email)
 * Uses the design system accent colors as base palette
 */
const generateColorFromString = (str: string): string => {
  if (!str) return 'accent-primary';

  const accentColors = [
    'accent-primary',    // #3B82F6
    'accent-secondary',  // #8B5CF6
    'accent-success',    // #10B981
    'accent-warning',    // #F59E0B
    'accent-error',      // #EF4444
  ];

  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % accentColors.length;
  return accentColors[index];
};

/**
 * Generates geometric SVG pattern based on string
 */
const generateGeometricPattern = (seed: string, size: number = 100): string => {
  // Simple deterministic pattern generation
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }

  const color = generateColorFromString(seed);
  const colorMap: Record<string, string> = {
    'accent-primary': '#3B82F6',
    'accent-secondary': '#8B5CF6',
    'accent-success': '#10B981',
    'accent-warning': '#F59E0B',
    'accent-error': '#EF4444',
  };
  const hexColor = colorMap[color] || '#3B82F6';

  const patternType = Math.abs(hash) % 4;
  const rotation = Math.abs(hash) % 360;

  switch (patternType) {
    case 0:
      // Concentric circles
      return `
        <svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
          <circle cx="50" cy="50" r="45" fill="none" stroke="${hexColor}" stroke-width="3" opacity="0.7"/>
          <circle cx="50" cy="50" r="30" fill="none" stroke="${hexColor}" stroke-width="2" opacity="0.5"/>
          <circle cx="50" cy="50" r="15" fill="${hexColor}" opacity="0.8"/>
        </svg>
      `;
    case 1:
      // Triangles
      return `
        <svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
          <polygon points="50,10 90,90 10,90" fill="${hexColor}" opacity="0.6" transform="rotate(${rotation},50,50)"/>
          <polygon points="50,30 70,70 30,70" fill="${hexColor}" opacity="0.8" transform="rotate(${rotation},50,50)"/>
        </svg>
      `;
    case 2:
      // Grid of squares
      return `
        <svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
          <rect x="10" y="10" width="20" height="20" fill="${hexColor}" opacity="0.9"/>
          <rect x="70" y="10" width="20" height="20" fill="${hexColor}" opacity="0.7"/>
          <rect x="10" y="70" width="20" height="20" fill="${hexColor}" opacity="0.5"/>
          <rect x="70" y="70" width="20" height="20" fill="${hexColor}" opacity="0.8"/>
          <rect x="40" y="40" width="20" height="20" fill="${hexColor}" opacity="1"/>
        </svg>
      `;
    case 3:
    default:
      // Hexagon pattern
      return `
        <svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
          <polygon points="50,10 85,30 85,70 50,90 15,70 15,30" fill="none" stroke="${hexColor}" stroke-width="3" opacity="0.7"/>
          <polygon points="50,25 70,35 70,65 50,75 30,65 30,35" fill="${hexColor}" opacity="0.5"/>
        </svg>
      `;
  }
};

export interface AvatarProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'color'>,
    VariantProps<typeof avatarVariants> {
  /**
   * Image source URL
   */
  src?: string | null;
  /**
   * Fallback text for initials (e.g., "JD" for John Doe)
   */
  fallback?: string;
  /**
   * Alt text for the image
   */
  alt?: string;
  /**
   * Seed for generative avatar (used when no src provided)
   */
  seed?: string;
  /**
   * Whether to show generative geometric pattern
   */
  generative?: boolean;
  /**
   * Color variant override (auto-generated from seed if not provided)
   */
  color?: string;
  /**
   * Whether the avatar is clickable
   */
  interactive?: boolean;
}

/**
 * Avatar component with support for images, initials, and generative geometric patterns.
 * Cyber-minimal design with status indicators and glassmorphism effects.
 */
const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  (
    {
      className,
      src,
      fallback,
      alt = 'Avatar',
      seed = '',
      generative = false,
      color,
      size,
      variant,
      shape,
      status,
      interactive = false,
      children,
      ...props
    },
    ref
  ) => {
    const [imgError, setImgError] = React.useState(false);
    const showImage = src && !imgError;
    const effectiveSeed = seed || fallback || 'default';

    // Determine variant based on color or seed
    let effectiveVariant = variant;
    if (!variant && !color) {
      // Auto-generate variant from seed
      const generatedColor = generateColorFromString(effectiveSeed);
      effectiveVariant = generatedColor.replace('accent-', '') as any;
    }

    // Get initials from fallback text
    const getInitials = (text: string): string => {
      if (!text) return '?';
      return text
        .split(' ')
        .map((word) => word[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    };

    // Generate SVG pattern as data URL
    const generatePatternDataUrl = (): string => {
      const svgString = generateGeometricPattern(effectiveSeed, 200);
      const cleanedSvg = svgString.replace(/\s+/g, ' ').trim();
      const base64 = btoa(unescape(encodeURIComponent(cleanedSvg)));
      return `data:image/svg+xml;base64,${base64}`;
    };

    const patternUrl = generative && !showImage ? generatePatternDataUrl() : null;

    return (
      <div
        ref={ref}
        className={cn(
          avatarVariants({ size, variant: effectiveVariant, shape, status }),
          interactive && 'cursor-pointer hover:scale-105 active:scale-95 hover:shadow-glow-primary',
          'relative',
          className
        )}
        role={interactive ? 'button' : 'img'}
        aria-label={alt}
        tabIndex={interactive ? 0 : undefined}
        {...props}
      >
        {showImage ? (
          <img
            src={src}
            alt={alt}
            className="h-full w-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : patternUrl ? (
          <div
            className="h-full w-full bg-cover bg-center"
            style={{ backgroundImage: `url(${patternUrl})` }}
          />
        ) : (
          <span className="font-semibold">{fallback ? getInitials(fallback) : '?'}</span>
        )}
        {children}
      </div>
    );
  }
);
Avatar.displayName = 'Avatar';

// AvatarGroup component for displaying multiple avatars
export interface AvatarGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Maximum number of avatars to show before truncating
   */
  max?: number;
  /**
   * Size of avatars in the group
   */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  /**
   * Spacing between avatars (negative margin)
   */
  spacing?: number;
}

const AvatarGroup: React.FC<AvatarGroupProps> = ({
  children,
  max,
  size = 'md',
  spacing = 4,
  className,
  ...props
}) => {
  const avatars = React.Children.toArray(children);
  const total = avatars.length;
  const displayAvatars = max && total > max ? avatars.slice(0, max) : avatars;
  const extra = max && total > max ? total - max : 0;

  return (
    <div className={cn('flex items-center', className)} {...props}>
      <div className="flex" style={{ marginRight: spacing * 2 }}>
        {displayAvatars.map((avatar, index) => (
          <div
            key={index}
            className="rounded-full border-2 border-bg-primary"
            style={{
              marginLeft: index > 0 ? -spacing : 0,
              zIndex: total - index,
            }}
          >
            {React.isValidElement(avatar)
              ? React.cloneElement(avatar as React.ReactElement<any>, { size })
              : avatar}
          </div>
        ))}
      </div>
      {extra > 0 && (
        <div
          className={cn(
            avatarVariants({ size }),
            'relative z-0 border-border-subtle bg-bg-tertiary text-text-secondary'
          )}
        >
          <span className="text-xs font-semibold">+{extra}</span>
        </div>
      )}
    </div>
  );
};

export { Avatar, AvatarGroup, avatarVariants };