import type { CuisineKey } from './types';

export const CUISINES: Record<CuisineKey, { label: string; emoji: string; from: string; to: string }> = {
  italian: { label: 'איטלקי', emoji: '🍝', from: '#F7C59F', to: '#E4572E' },
  pizza: { label: 'פיצה', emoji: '🍕', from: '#FFD166', to: '#EF476F' },
  sushi: { label: 'סושי', emoji: '🍣', from: '#FFB4A2', to: '#E5989B' },
  burger: { label: 'המבורגר', emoji: '🍔', from: '#FFC971', to: '#C8553D' },
  asian: { label: 'אסייתי', emoji: '🥢', from: '#F4A259', to: '#BC4B51' },
  middle_eastern: { label: 'מזרח תיכוני', emoji: '🧆', from: '#E9C46A', to: '#8AB17D' },
  meat: { label: 'בשרים', emoji: '🥩', from: '#E76F51', to: '#9B2226' },
  vegetarian: { label: 'צמחוני', emoji: '🥗', from: '#B5E48C', to: '#52B69A' },
  cafe: { label: 'בית קפה', emoji: '☕', from: '#E6CCB2', to: '#9C6644' },
  other: { label: 'אחר', emoji: '🍽️', from: '#FFE8D6', to: '#CB997E' },
};

export const CUISINE_ORDER: CuisineKey[] = ['pizza', 'burger', 'sushi', 'asian', 'italian', 'middle_eastern', 'meat', 'vegetarian', 'cafe', 'other'];
