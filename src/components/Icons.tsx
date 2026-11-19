import type { SVGProps } from 'react';
type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 24) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true });

export const IconHeart = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p} fill="currentColor" stroke="none"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.1 0 3.6 1.1 5.2 3 1.6-1.9 3.1-3 5.2-3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z" /></svg>
);
export const IconX = ({ size, ...p }: P) => (<svg {...base(size)} {...p} strokeWidth={3}><path d="M6 6l12 12M18 6L6 18" /></svg>);
export const IconUndo = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M9 14l-5-5 5-5" /><path d="M4 9h10.5a5.5 5.5 0 010 11H11" /></svg>);
export const IconBack = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M9 6l6 6-6 6" /></svg>);
export const IconPin = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M12 21s7-6.1 7-11.5A7 7 0 005 9.5C5 14.9 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>);
export const IconShare = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M12 3v13M7 8l5-5 5 5" /><path d="M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6" /></svg>);
export const IconNav = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M3 11l18-8-8 18-2-8-8-2z" /></svg>);
export const IconBag = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M6 8h12l-1 12H7L6 8z" /><path d="M9 8V7a3 3 0 016 0v1" /></svg>
);
export const IconStar = ({ size, ...p }: P) => (<svg {...base(size)} {...p} fill="currentColor" stroke="none"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8z" /></svg>);
export const IconCopy = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M15 9V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7a2 2 0 002 2h3" /></svg>);
/** Generic chat bubble. The button text says WhatsApp; this is not their logo. */
export const IconWhatsApp = ({ size = 22, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...p} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round"><path d="M5 16.5V7.2A2.2 2.2 0 017.2 5h9.6A2.2 2.2 0 0119 7.2v6.1a2.2 2.2 0 01-2.2 2.2H9.2L5 18.5z" /></svg>
);
