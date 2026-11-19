export interface Area { id: string; label: string; group: string; lat: number; lng: number }

// Default: Tel Aviv center. Areas outside the seeded grid will show the "no results" state.
export const AREAS: Area[] = [
  { id: 'tlv-center', label: 'תל אביב – מרכז העיר', group: 'תל אביב-יפו', lat: 32.0775, lng: 34.7745 },
  { id: 'tlv-rothschild', label: 'רוטשילד ונחלת בנימין', group: 'תל אביב-יפו', lat: 32.0655, lng: 34.7765 },
  { id: 'tlv-florentin', label: 'פלורנטין ונווה צדק', group: 'תל אביב-יפו', lat: 32.0580, lng: 34.7690 },
  { id: 'tlv-jaffa', label: 'יפו', group: 'תל אביב-יפו', lat: 32.0525, lng: 34.7570 },
  { id: 'tlv-sarona', label: 'שרונה והקריה', group: 'תל אביב-יפו', lat: 32.0725, lng: 34.7880 },
  { id: 'tlv-north', label: 'הצפון הישן', group: 'תל אביב-יפו', lat: 32.0880, lng: 34.7790 },
  { id: 'tlv-port', label: 'הנמל ובזל', group: 'תל אביב-יפו', lat: 32.0985, lng: 34.7760 },
  { id: 'tlv-ramat-aviv', label: 'רמת אביב', group: 'תל אביב-יפו', lat: 32.1120, lng: 34.8020 },
  { id: 'ramat-gan', label: 'רמת גן', group: 'ערים נוספות', lat: 32.0830, lng: 34.8110 },
  { id: 'herzliya', label: 'הרצליה', group: 'ערים נוספות', lat: 32.1630, lng: 34.8050 },
  { id: 'rishon', label: 'ראשון לציון', group: 'ערים נוספות', lat: 31.9700, lng: 34.7900 },
  { id: 'jerusalem', label: 'ירושלים – מרכז', group: 'ערים נוספות', lat: 31.7810, lng: 35.2170 },
  { id: 'haifa', label: 'חיפה', group: 'ערים נוספות', lat: 32.8110, lng: 34.9900 },
];

export const DEFAULT_AREA = AREAS[0];
