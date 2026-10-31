export const HALFTONE_SHAPE_OPTIONS = [
  { value: 'round', label: 'Round' },
  { value: 'elliptical', label: 'Elliptical' },
  { value: 'square', label: 'Square' },
  { value: 'diamond', label: 'Diamond' },
  { value: 'line', label: 'Line' },
  { value: 'cross', label: 'Cross' },
  { value: 'circle', label: 'Ring' },
];
export function patternForShape(shape: string): string {
  return shape === 'line' || shape === 'cross' || shape === 'circle' ? shape : 'dot';
}
