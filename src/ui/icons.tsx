import type { SVGProps } from 'react';

const base: SVGProps<SVGSVGElement> = {
  width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
};

export const PenIcon = () => (
  <svg {...base}><path d="M4 20l4-1 11-11a2.1 2.1 0 0 0-3-3L5 16l-1 4z" /><path d="M14 7l3 3" /></svg>
);
export const PlusIcon = () => (
  <svg {...base}><path d="M12 5v14M5 12h14" /></svg>
);
export const MicIcon = () => (
  <svg {...base}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
);
export const CameraIcon = () => (
  <svg {...base}><path d="M4 8h3l1.5-2h7L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
);
export const SendIcon = () => (
  <svg {...base}><path d="M5 12h13M13 6l6 6-6 6" /></svg>
);
export const CheckIcon = () => (
  <svg {...base} strokeWidth={2.6}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
export const CloseIcon = () => (
  <svg {...base}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
