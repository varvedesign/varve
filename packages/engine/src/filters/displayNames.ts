import { imageTreatmentSchema, isImageTreatmentKind } from '../imageTreatments';
import type { AdjustmentKind } from './types';

export function filterKindDisplayName(kind: AdjustmentKind): string {
  if (isImageTreatmentKind(kind)) return imageTreatmentSchema(kind).label;

  switch (kind) {
    case 'whiteBalance':
      return 'White Balance';
    case 'splitTone':
      return 'Split Toning';
    case 'hueRotate':
      return 'Hue Rotate';
    case 'hueSaturation':
      return 'Hue / Saturation';
    case 'colorBalance':
      return 'Color Balance';
    case 'channelMixer':
      return 'Channel Mixer';
    case 'photoFilter':
      return 'Photo Filter';
    case 'shadowHighlight':
      return 'Shadow / Highlight';
    case 'selectiveColor':
      return 'Selective Color';
    case 'gradientMap':
      return 'Gradient Map';
    case 'lut':
      return 'LUT';
    case 'tritone':
      return 'Tritone';
    case 'colorHalftone':
      return 'Color Halftone';
    case 'duotone':
      return 'Duotone';
    case 'blackAndWhite':
      return 'Black & White';
    case 'posterize':
      return 'Posterize';
    case 'threshold':
      return 'Threshold';
    case 'dither':
      return 'Dither';
    case 'paletteSnap':
      return 'Palette Snap';
    case 'bloom':
      return 'Bloom';
    case 'rgbSplit':
      return 'RGB Split';
    case 'crt':
      return 'CRT';
    case 'vhs':
      return 'VHS';
    case 'lightShafts':
      return 'Light Shafts';
    case 'lensFlare':
      return 'Lens Flare';
    case 'lightLeak':
      return 'Light Leak';
    case 'caustics':
      return 'Caustics';
    case 'motionBlur':
      return 'Motion Blur';
    case 'mosaic':
      return 'Mosaic';
    case 'surfaceSmooth':
      return 'Surface Smooth';
    case 'edgeInk':
      return 'Edge Ink';
    default:
      return kind.charAt(0).toUpperCase() + kind.slice(1);
  }
}
