// Heavy Chain Custom Icons
// Premium, luxurious SVG icons for the apparel AI platform

import React from 'react';

interface IconProps {
  className?: string;
  size?: number;
}

// AI Image Generation - Magic Sparkles
export const IconSparkles: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <defs>
      <linearGradient id="sparkleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#c9a227" />
        <stop offset="100%" stopColor="#f4d03f" />
      </linearGradient>
    </defs>
    <path d="M12 2L13.5 8.5L20 10L13.5 11.5L12 18L10.5 11.5L4 10L10.5 8.5L12 2Z" fill="url(#sparkleGrad)" />
    <path d="M19 14L19.75 16.25L22 17L19.75 17.75L19 20L18.25 17.75L16 17L18.25 16.25L19 14Z" fill="url(#sparkleGrad)" opacity="0.8" />
    <path d="M5 14L5.5 15.5L7 16L5.5 16.5L5 18L4.5 16.5L3 16L4.5 15.5L5 14Z" fill="url(#sparkleGrad)" opacity="0.6" />
  </svg>
);

// Color Variations - Palette
export const IconPalette: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <defs>
      <linearGradient id="paletteGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#1a1a2e" />
        <stop offset="100%" stopColor="#2d2d44" />
      </linearGradient>
    </defs>
    <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C12.83 22 13.5 21.33 13.5 20.5C13.5 20.11 13.35 19.76 13.11 19.49C12.88 19.23 12.73 18.88 12.73 18.5C12.73 17.67 13.4 17 14.23 17H16C19.31 17 22 14.31 22 11C22 6.03 17.52 2 12 2Z" fill="url(#paletteGrad)" stroke="#c9a227" strokeWidth="1.5" />
    <circle cx="6.5" cy="11.5" r="1.5" fill="#e74c3c" />
    <circle cx="9.5" cy="7.5" r="1.5" fill="#f39c12" />
    <circle cx="14.5" cy="7.5" r="1.5" fill="#27ae60" />
    <circle cx="17.5" cy="11.5" r="1.5" fill="#3498db" />
  </svg>
);

// Background Removal - Scissors
export const IconScissors: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <defs>
      <linearGradient id="scissorGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#c9a227" />
        <stop offset="100%" stopColor="#a67c00" />
      </linearGradient>
    </defs>
    <circle cx="6" cy="6" r="3" stroke="url(#scissorGrad)" strokeWidth="2" fill="none" />
    <circle cx="6" cy="18" r="3" stroke="url(#scissorGrad)" strokeWidth="2" fill="none" />
    <path d="M20 4L8.12 15.88" stroke="url(#scissorGrad)" strokeWidth="2" strokeLinecap="round" />
    <path d="M14.47 14.48L20 20" stroke="url(#scissorGrad)" strokeWidth="2" strokeLinecap="round" />
    <path d="M8.12 8.12L12 12" stroke="url(#scissorGrad)" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

// Variations - Refresh/Cycle
export const IconRefresh: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <defs>
      <linearGradient id="refreshGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#c9a227" />
        <stop offset="100%" stopColor="#f4d03f" />
      </linearGradient>
    </defs>
    <path d="M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C15.3313 3 18.2214 4.84269 19.7578 7.5" stroke="url(#refreshGrad)" strokeWidth="2" strokeLinecap="round" />
    <path d="M21 3V8H16" stroke="url(#refreshGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Scene Photography - Camera
export const IconCamera: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <defs>
      <linearGradient id="cameraGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#1a1a2e" />
        <stop offset="100%" stopColor="#2d2d44" />
      </linearGradient>
    </defs>
    <path d="M23 19C23 19.5304 22.7893 20.0391 22.4142 20.4142C22.0391 20.7893 21.5304 21 21 21H3C2.46957 21 1.96086 20.7893 1.58579 20.4142C1.21071 20.0391 1 19.5304 1 19V8C1 7.46957 1.21071 6.96086 1.58579 6.58579C1.96086 6.21071 2.46957 6 3 6H7L9 3H15L17 6H21C21.5304 6 22.0391 6.21071 22.4142 6.58579C22.7893 6.96086 23 7.46957 23 8V19Z" fill="url(#cameraGrad)" stroke="#c9a227" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="12" cy="13" r="4" stroke="#c9a227" strokeWidth="1.5" fill="none" />
    <circle cx="12" cy="13" r="2" fill="#c9a227" opacity="0.3" />
  </svg>
);

// E-commerce - Shopping Bag
export const IconShoppingBag: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <defs>
      <linearGradient id="bagGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#1a1a2e" />
        <stop offset="100%" stopColor="#2d2d44" />
      </linearGradient>
    </defs>
    <path d="M6 2L3 6V20C3 20.5304 3.21071 21.0391 3.58579 21.4142C3.96086 21.7893 4.46957 22 5 22H19C19.5304 22 20.0391 21.7893 20.4142 21.4142C20.7893 21.0391 21 20.5304 21 20V6L18 2H6Z" fill="url(#bagGrad)" stroke="#c9a227" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3 6H21" stroke="#c9a227" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M16 10C16 11.0609 15.5786 12.0783 14.8284 12.8284C14.0783 13.5786 13.0609 14 12 14C10.9391 14 9.92172 13.5786 9.17157 12.8284C8.42143 12.0783 8 11.0609 8 10" stroke="#c9a227" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Model Matrix - Users
export const IconUsers: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <defs>
      <linearGradient id="usersGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#c9a227" />
        <stop offset="100%" stopColor="#a67c00" />
      </linearGradient>
    </defs>
    <path d="M17 21V19C17 17.9391 16.5786 16.9217 15.8284 16.1716C15.0783 15.4214 14.0609 15 13 15H5C3.93913 15 2.92172 15.4214 2.17157 16.1716C1.42143 16.9217 1 17.9391 1 19V21" stroke="url(#usersGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="9" cy="7" r="4" stroke="url(#usersGrad)" strokeWidth="2" fill="none" />
    <path d="M23 21V19C22.9993 18.1137 22.7044 17.2528 22.1614 16.5523C21.6184 15.8519 20.8581 15.3516 20 15.13" stroke="url(#usersGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M16 3.13C16.8604 3.35031 17.623 3.85071 18.1676 4.55232C18.7122 5.25392 19.0078 6.11683 19.0078 7.005C19.0078 7.89318 18.7122 8.75608 18.1676 9.45769C17.623 10.1593 16.8604 10.6597 16 10.88" stroke="url(#usersGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Multilingual - Globe
export const IconGlobe: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <defs>
      <linearGradient id="globeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#1a1a2e" />
        <stop offset="100%" stopColor="#2d2d44" />
      </linearGradient>
    </defs>
    <circle cx="12" cy="12" r="10" fill="url(#globeGrad)" stroke="#c9a227" strokeWidth="1.5" />
    <path d="M2 12H22" stroke="#c9a227" strokeWidth="1" opacity="0.5" />
    <path d="M12 2C14.5 4.5 15.5 8 15.5 12C15.5 16 14.5 19.5 12 22" stroke="#c9a227" strokeWidth="1.5" />
    <path d="M12 2C9.5 4.5 8.5 8 8.5 12C8.5 16 9.5 19.5 12 22" stroke="#c9a227" strokeWidth="1.5" />
    <path d="M4 7H20" stroke="#c9a227" strokeWidth="1" opacity="0.3" />
    <path d="M4 17H20" stroke="#c9a227" strokeWidth="1" opacity="0.3" />
  </svg>
);

// Design Gacha - Grid Layout
export const IconGrid: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <defs>
      <linearGradient id="gridGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#c9a227" />
        <stop offset="100%" stopColor="#f4d03f" />
      </linearGradient>
    </defs>
    <rect x="3" y="3" width="7" height="7" rx="2" fill="url(#gridGrad)" opacity="0.9" />
    <rect x="14" y="3" width="7" height="7" rx="2" fill="url(#gridGrad)" opacity="0.7" />
    <rect x="3" y="14" width="7" height="7" rx="2" fill="url(#gridGrad)" opacity="0.7" />
    <rect x="14" y="14" width="7" height="7" rx="2" fill="url(#gridGrad)" opacity="0.5" />
  </svg>
);

// Prompt Optimization - Magic Wand
export const IconWand: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <defs>
      <linearGradient id="wandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#c9a227" />
        <stop offset="100%" stopColor="#f4d03f" />
      </linearGradient>
    </defs>
    <path d="M15 4V2" stroke="url(#wandGrad)" strokeWidth="2" strokeLinecap="round" />
    <path d="M15 8V6" stroke="url(#wandGrad)" strokeWidth="2" strokeLinecap="round" />
    <path d="M13 5H11" stroke="url(#wandGrad)" strokeWidth="2" strokeLinecap="round" />
    <path d="M19 5H17" stroke="url(#wandGrad)" strokeWidth="2" strokeLinecap="round" />
    <path d="M21 15L9 3L3 9L15 21L21 15Z" stroke="url(#wandGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9 3L3 9" stroke="url(#wandGrad)" strokeWidth="2" strokeLinecap="round" />
    <path d="M6 6L18 18" stroke="url(#wandGrad)" strokeWidth="2" strokeLinecap="round" opacity="0.3" />
  </svg>
);

// Chat Edit - Message
export const IconMessage: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <defs>
      <linearGradient id="msgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#1a1a2e" />
        <stop offset="100%" stopColor="#2d2d44" />
      </linearGradient>
    </defs>
    <path d="M21 15C21 15.5304 20.7893 16.0391 20.4142 16.4142C20.0391 16.7893 19.5304 17 19 17H7L3 21V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H19C19.5304 3 20.0391 3.21071 20.4142 3.58579C20.7893 3.96086 21 4.46957 21 5V15Z" fill="url(#msgGrad)" stroke="#c9a227" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="8" cy="10" r="1" fill="#c9a227" />
    <circle cx="12" cy="10" r="1" fill="#c9a227" />
    <circle cx="16" cy="10" r="1" fill="#c9a227" />
  </svg>
);

// Upscale - Maximize
export const IconMaximize: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <defs>
      <linearGradient id="maxGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#c9a227" />
        <stop offset="100%" stopColor="#f4d03f" />
      </linearGradient>
    </defs>
    <path d="M15 3H21V9" stroke="url(#maxGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9 21H3V15" stroke="url(#maxGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M21 3L14 10" stroke="url(#maxGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3 21L10 14" stroke="url(#maxGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <text x="12" y="14" fill="#c9a227" fontSize="6" fontWeight="bold" textAnchor="middle">HD</text>
  </svg>
);

// Clock / Timer
export const IconClock: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <defs>
      <linearGradient id="clockGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#1a1a2e" />
        <stop offset="100%" stopColor="#2d2d44" />
      </linearGradient>
    </defs>
    <circle cx="12" cy="12" r="10" fill="url(#clockGrad)" stroke="#c9a227" strokeWidth="1.5" />
    <path d="M12 6V12L16 14" stroke="#c9a227" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Dollar / Savings
export const IconDollar: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <defs>
      <linearGradient id="dollarGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#c9a227" />
        <stop offset="100%" stopColor="#f4d03f" />
      </linearGradient>
    </defs>
    <circle cx="12" cy="12" r="10" stroke="url(#dollarGrad)" strokeWidth="2" fill="none" />
    <path d="M12 6V18" stroke="url(#dollarGrad)" strokeWidth="2" strokeLinecap="round" />
    <path d="M16 9C16 7.34315 14.2091 6 12 6C9.79086 6 8 7.34315 8 9C8 10.6569 9.79086 12 12 12C14.2091 12 16 13.3431 16 15C16 16.6569 14.2091 18 12 18C9.79086 18 8 16.6569 8 15" stroke="url(#dollarGrad)" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

// Lightning / Zap
export const IconZap: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <defs>
      <linearGradient id="zapGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#c9a227" />
        <stop offset="100%" stopColor="#f4d03f" />
      </linearGradient>
    </defs>
    <path d="M13 2L3 14H12L11 22L21 10H12L13 2Z" fill="url(#zapGrad)" stroke="#a67c00" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Home
export const IconHome: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <defs>
      <linearGradient id="homeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#1a1a2e" />
        <stop offset="100%" stopColor="#2d2d44" />
      </linearGradient>
    </defs>
    <path d="M3 9L12 2L21 9V20C21 20.5304 20.7893 21.0391 20.4142 21.4142C20.0391 21.7893 19.5304 22 19 22H5C4.46957 22 3.96086 21.7893 3.58579 21.4142C3.21071 21.0391 3 20.5304 3 20V9Z" fill="url(#homeGrad)" stroke="#c9a227" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9 22V12H15V22" stroke="#c9a227" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Canvas / Pen Tool
export const IconPen: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <defs>
      <linearGradient id="penGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#c9a227" />
        <stop offset="100%" stopColor="#f4d03f" />
      </linearGradient>
    </defs>
    <path d="M12 19L19 12L22 15L15 22L12 19Z" fill="url(#penGrad)" />
    <path d="M18 13L16.5 5.5L2 2L5.5 16.5L13 18L18 13Z" stroke="url(#penGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M2 2L9.586 9.586" stroke="url(#penGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="11" cy="11" r="2" stroke="url(#penGrad)" strokeWidth="2" fill="none" />
  </svg>
);

// Gallery / Image
export const IconImage: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <defs>
      <linearGradient id="imgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#1a1a2e" />
        <stop offset="100%" stopColor="#2d2d44" />
      </linearGradient>
    </defs>
    <rect x="3" y="3" width="18" height="18" rx="2" fill="url(#imgGrad)" stroke="#c9a227" strokeWidth="1.5" />
    <circle cx="8.5" cy="8.5" r="1.5" fill="#c9a227" />
    <path d="M21 15L16 10L5 21" stroke="#c9a227" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Settings / Gear
export const IconSettings: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <defs>
      <linearGradient id="settingsGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#c9a227" />
        <stop offset="100%" stopColor="#a67c00" />
      </linearGradient>
    </defs>
    <circle cx="12" cy="12" r="3" stroke="url(#settingsGrad)" strokeWidth="2" fill="none" />
    <path d="M19.4 15C19.2669 15.3016 19.2272 15.6362 19.286 15.9606C19.3448 16.285 19.4995 16.5843 19.73 16.82L19.79 16.88C19.976 17.0657 20.1235 17.2863 20.2241 17.5291C20.3248 17.7719 20.3766 18.0322 20.3766 18.295C20.3766 18.5578 20.3248 18.8181 20.2241 19.0609C20.1235 19.3037 19.976 19.5243 19.79 19.71C19.6043 19.896 19.3837 20.0435 19.1409 20.1441C18.8981 20.2448 18.6378 20.2966 18.375 20.2966C18.1122 20.2966 17.8519 20.2448 17.6091 20.1441C17.3663 20.0435 17.1457 19.896 16.96 19.71L16.9 19.65C16.6643 19.4195 16.365 19.2648 16.0406 19.206C15.7162 19.1472 15.3816 19.1869 15.08 19.32C14.7842 19.4468 14.532 19.6572 14.3543 19.9255C14.1766 20.1938 14.0813 20.5082 14.08 20.83V21C14.08 21.5304 13.8693 22.0391 13.4942 22.4142C13.1191 22.7893 12.6104 23 12.08 23C11.5496 23 11.0409 22.7893 10.6658 22.4142C10.2907 22.0391 10.08 21.5304 10.08 21V20.91C10.0723 20.579 9.96512 20.258 9.77251 19.9887C9.5799 19.7194 9.31074 19.5143 9 19.4C8.69838 19.2669 8.36381 19.2272 8.03941 19.286C7.71502 19.3448 7.41568 19.4995 7.18 19.73L7.12 19.79C6.93425 19.976 6.71368 20.1235 6.47088 20.2241C6.22808 20.3248 5.96783 20.3766 5.705 20.3766C5.44217 20.3766 5.18192 20.3248 4.93912 20.2241C4.69632 20.1235 4.47575 19.976 4.29 19.79C4.10405 19.6043 3.95653 19.3837 3.85588 19.1409C3.75523 18.8981 3.70343 18.6378 3.70343 18.375C3.70343 18.1122 3.75523 17.8519 3.85588 17.6091C3.95653 17.3663 4.10405 17.1457 4.29 16.96L4.35 16.9C4.58054 16.6643 4.73519 16.365 4.794 16.0406C4.85282 15.7162 4.81312 15.3816 4.68 15.08C4.55324 14.7842 4.34276 14.532 4.07447 14.3543C3.80618 14.1766 3.49179 14.0813 3.17 14.08H3C2.46957 14.08 1.96086 13.8693 1.58579 13.4942C1.21071 13.1191 1 12.6104 1 12.08C1 11.5496 1.21071 11.0409 1.58579 10.6658C1.96086 10.2907 2.46957 10.08 3 10.08H3.09C3.42099 10.0723 3.742 9.96512 4.0113 9.77251C4.28059 9.5799 4.48572 9.31074 4.6 9C4.73312 8.69838 4.77282 8.36381 4.714 8.03941C4.65519 7.71502 4.50054 7.41568 4.27 7.18L4.21 7.12C4.02405 6.93425 3.87653 6.71368 3.77588 6.47088C3.67523 6.22808 3.62343 5.96783 3.62343 5.705C3.62343 5.44217 3.67523 5.18192 3.77588 4.93912C3.87653 4.69632 4.02405 4.47575 4.21 4.29C4.39575 4.10405 4.61632 3.95653 4.85912 3.85588C5.10192 3.75523 5.36217 3.70343 5.625 3.70343C5.88783 3.70343 6.14808 3.75523 6.39088 3.85588C6.63368 3.95653 6.85425 4.10405 7.04 4.29L7.1 4.35C7.33568 4.58054 7.63502 4.73519 7.95941 4.794C8.28381 4.85282 8.61838 4.81312 8.92 4.68H9C9.29577 4.55324 9.54802 4.34276 9.72569 4.07447C9.90337 3.80618 9.99872 3.49179 10 3.17V3C10 2.46957 10.2107 1.96086 10.5858 1.58579C10.9609 1.21071 11.4696 1 12 1C12.5304 1 13.0391 1.21071 13.4142 1.58579C13.7893 1.96086 14 2.46957 14 3V3.09C14.0013 3.41179 14.0966 3.72618 14.2743 3.99447C14.452 4.26276 14.7042 4.47324 15 4.6C15.3016 4.73312 15.6362 4.77282 15.9606 4.714C16.285 4.65519 16.5843 4.50054 16.82 4.27L16.88 4.21C17.0657 4.02405 17.2863 3.87653 17.5291 3.77588C17.7719 3.67523 18.0322 3.62343 18.295 3.62343C18.5578 3.62343 18.8181 3.67523 19.0609 3.77588C19.3037 3.87653 19.5243 4.02405 19.71 4.21C19.896 4.39575 20.0435 4.61632 20.1441 4.85912C20.2448 5.10192 20.2966 5.36217 20.2966 5.625C20.2966 5.88783 20.2448 6.14808 20.1441 6.39088C20.0435 6.63368 19.896 6.85425 19.71 7.04L19.65 7.1C19.4195 7.33568 19.2648 7.63502 19.206 7.95941C19.1472 8.28381 19.1869 8.61838 19.32 8.92V9C19.4468 9.29577 19.6572 9.54802 19.9255 9.72569C20.1938 9.90337 20.5082 9.99872 20.83 10H21C21.5304 10 22.0391 10.2107 22.4142 10.5858C22.7893 10.9609 23 11.4696 23 12C23 12.5304 22.7893 13.0391 22.4142 13.4142C22.0391 13.7893 21.5304 14 21 14H20.91C20.5882 14.0013 20.2738 14.0966 20.0055 14.2743C19.7372 14.452 19.5268 14.7042 19.4 15Z" stroke="url(#settingsGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Logout
export const IconLogout: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M9 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H9" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M16 17L21 12L16 7" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M21 12H9" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Star / Favorite
export const IconStar: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <defs>
      <linearGradient id="starGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#c9a227" />
        <stop offset="100%" stopColor="#f4d03f" />
      </linearGradient>
    </defs>
    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="url(#starGrad)" stroke="#a67c00" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Check
export const IconCheck: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M20 6L9 17L4 12" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Plus / Add
export const IconPlus: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <defs>
      <linearGradient id="plusGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#c9a227" />
        <stop offset="100%" stopColor="#f4d03f" />
      </linearGradient>
    </defs>
    <path d="M12 5V19" stroke="url(#plusGrad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5 12H19" stroke="url(#plusGrad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Folder
export const IconFolder: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <defs>
      <linearGradient id="folderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#1a1a2e" />
        <stop offset="100%" stopColor="#2d2d44" />
      </linearGradient>
    </defs>
    <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" fill="url(#folderGrad)" stroke="#c9a227" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Trending Up
export const IconTrending: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <defs>
      <linearGradient id="trendGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#c9a227" />
        <stop offset="100%" stopColor="#f4d03f" />
      </linearGradient>
    </defs>
    <path d="M23 6L13.5 15.5L8.5 10.5L1 18" stroke="url(#trendGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M17 6H23V12" stroke="url(#trendGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Arrow Right
export const IconArrowRight: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M12 5L19 12L12 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Chevron Right
export const IconChevronRight: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Moon (Dark Mode)
export const IconMoon: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M21 12.79C20.8427 14.4922 20.2039 16.1144 19.1582 17.4668C18.1126 18.8192 16.7035 19.8458 15.0957 20.4265C13.4879 21.0073 11.748 21.1181 10.0795 20.7461C8.41104 20.3741 6.88302 19.5345 5.67425 18.3258C4.46548 17.117 3.62596 15.589 3.25393 13.9205C2.8819 12.252 2.99274 10.5121 3.57348 8.9043C4.15423 7.29651 5.18085 5.88737 6.53324 4.84175C7.88563 3.79614 9.50782 3.15731 11.21 3C10.2134 4.34827 9.73387 6.00945 9.85856 7.68141C9.98324 9.35338 10.7039 10.9251 11.8894 12.1106C13.0749 13.2961 14.6466 14.0168 16.3186 14.1414C17.9906 14.2661 19.6517 13.7866 21 12.79Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Sun (Light Mode)
export const IconSun: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <defs>
      <linearGradient id="sunGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#c9a227" />
        <stop offset="100%" stopColor="#f4d03f" />
      </linearGradient>
    </defs>
    <circle cx="12" cy="12" r="5" fill="url(#sunGrad)" />
    <path d="M12 1V3" stroke="url(#sunGrad)" strokeWidth="2" strokeLinecap="round" />
    <path d="M12 21V23" stroke="url(#sunGrad)" strokeWidth="2" strokeLinecap="round" />
    <path d="M4.22 4.22L5.64 5.64" stroke="url(#sunGrad)" strokeWidth="2" strokeLinecap="round" />
    <path d="M18.36 18.36L19.78 19.78" stroke="url(#sunGrad)" strokeWidth="2" strokeLinecap="round" />
    <path d="M1 12H3" stroke="url(#sunGrad)" strokeWidth="2" strokeLinecap="round" />
    <path d="M21 12H23" stroke="url(#sunGrad)" strokeWidth="2" strokeLinecap="round" />
    <path d="M4.22 19.78L5.64 18.36" stroke="url(#sunGrad)" strokeWidth="2" strokeLinecap="round" />
    <path d="M18.36 5.64L19.78 4.22" stroke="url(#sunGrad)" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

// Upload
export const IconUpload: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M17 8L12 3L7 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M12 3V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Type / Text
export const IconType: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M4 7V4H20V7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9 20H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M12 4V20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Layout
export const IconLayout: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <defs>
      <linearGradient id="layoutGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#1a1a2e" />
        <stop offset="100%" stopColor="#2d2d44" />
      </linearGradient>
    </defs>
    <rect x="3" y="3" width="18" height="18" rx="2" fill="url(#layoutGrad)" stroke="#c9a227" strokeWidth="1.5" />
    <path d="M3 9H21" stroke="#c9a227" strokeWidth="1.5" />
    <path d="M9 21V9" stroke="#c9a227" strokeWidth="1.5" />
  </svg>
);

// Help Circle
export const IconHelp: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
    <path d="M9.09 9C9.3251 8.33167 9.78915 7.76811 10.4 7.40913C11.0108 7.05016 11.7289 6.91894 12.4272 7.03871C13.1255 7.15849 13.7588 7.52152 14.2151 8.06353C14.6713 8.60553 14.9211 9.29152 14.92 10C14.92 12 11.92 13 11.92 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="12" cy="17" r="1" fill="currentColor" />
  </svg>
);

// Layers (Logo)
export const IconLayers: React.FC<IconProps> = ({ className = '', size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <defs>
      <linearGradient id="layersGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#c9a227" />
        <stop offset="100%" stopColor="#f4d03f" />
      </linearGradient>
    </defs>
    <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="url(#layersGrad)" stroke="#a67c00" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M2 17L12 22L22 17" stroke="url(#layersGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M2 12L12 17L22 12" stroke="url(#layersGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Heavy Chain Logo - Full Logo with Chain Links
interface LogoProps {
  className?: string;
  height?: number;
  showText?: boolean;
}

export const HeavyChainLogo: React.FC<LogoProps> = ({ className = '', height = 56, showText = true }) => {
  const aspectRatio = showText ? 4 : 1.5;
  const width = height * aspectRatio;
  
  return (
    <svg width={width} height={height} viewBox={showText ? "0 0 400 100" : "0 0 150 100"} fill="none" className={className}>
      <defs>
        <linearGradient id="goldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#d4af37" />
          <stop offset="50%" stopColor="#f4d03f" />
          <stop offset="100%" stopColor="#c9a227" />
        </linearGradient>
        <linearGradient id="darkGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1a1a2e" />
          <stop offset="100%" stopColor="#2d2d44" />
        </linearGradient>
        <linearGradient id="goldGradient2" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#f4d03f" />
          <stop offset="50%" stopColor="#d4af37" />
          <stop offset="100%" stopColor="#a67c00" />
        </linearGradient>
      </defs>
      
      {/* Left Chain Link - Dark with gold inner border */}
      <g transform="translate(10, 10)">
        {/* Outer dark shape */}
        <path 
          d="M25 0 L65 0 Q80 0 80 15 L80 25 L60 45 L60 55 Q60 70 45 70 L15 70 Q0 70 0 55 L0 15 Q0 0 15 0 Z" 
          fill="url(#darkGradient)"
          stroke="#c9a227"
          strokeWidth="2"
        />
        {/* Inner gold border */}
        <path 
          d="M25 8 L60 8 Q70 8 70 18 L70 22 L52 40 L52 52 Q52 62 42 62 L18 62 Q8 62 8 52 L8 18 Q8 8 18 8 Z" 
          fill="none"
          stroke="#c9a227"
          strokeWidth="1.5"
          opacity="0.6"
        />
      </g>
      
      {/* Right Chain Link - Gold */}
      <g transform="translate(55, 20)">
        {/* Outer gold shape */}
        <path 
          d="M35 0 L65 0 Q80 0 80 15 L80 55 Q80 70 65 70 L25 70 Q10 70 10 55 L10 45 L30 25 L30 15 Q30 0 45 0 Z" 
          fill="url(#goldGradient2)"
          stroke="#a67c00"
          strokeWidth="1"
        />
        {/* Inner dark border */}
        <path 
          d="M38 8 L62 8 Q72 8 72 18 L72 52 Q72 62 62 62 L28 62 Q18 62 18 52 L18 42 L38 22 L38 18 Q38 8 48 8 Z" 
          fill="url(#darkGradient)"
          stroke="#c9a227"
          strokeWidth="1"
        />
        {/* Innermost gold line */}
        <path 
          d="M42 16 L58 16 Q64 16 64 22 L64 48 Q64 54 58 54 L32 54 Q26 54 26 48 L26 40 L44 22 L44 22 Q44 16 50 16 Z" 
          fill="none"
          stroke="#c9a227"
          strokeWidth="1"
          opacity="0.5"
        />
      </g>

      {/* Connection point / AI circuit element */}
      <circle cx="85" cy="55" r="3" fill="#c9a227" />
      <path d="M85 55 L95 45" stroke="#c9a227" strokeWidth="1.5" />
      <circle cx="95" cy="45" r="2" fill="#1a1a2e" stroke="#c9a227" strokeWidth="1" />

      {showText && (
        <>
          {/* HEAVY CHAIN Text */}
          <text 
            x="155" 
            y="58" 
            fontFamily="system-ui, -apple-system, sans-serif" 
            fontSize="32" 
            fontWeight="600" 
            letterSpacing="3"
            fill="#1a1a2e"
          >
            HEAVY CHAIN
          </text>
          
          {/* AI APPAREL PLATFORM Tagline */}
          <text 
            x="155" 
            y="82" 
            fontFamily="system-ui, -apple-system, sans-serif" 
            fontSize="12" 
            fontWeight="500" 
            letterSpacing="4"
            fill="#1a1a2e"
            opacity="0.7"
          >
            AI APPAREL PLATFORM
          </text>
        </>
      )}
    </svg>
  );
};

