import {
  BloomEditor,
  CausticsEditor,
  CrtEditor,
  LensFlareEditor,
  LightLeakEditor,
  LightShaftsEditor,
  PaletteSnapEditor,
  RgbSplitEditor,
  VhsEditor,
} from '../../LiveEffectEditors';
import { SpatialEffectEditor } from '../../SpatialEffectEditors';
import type { LegacyEditorContext } from './useLegacyEditorContext';

export function renderEffectCases(context: LegacyEditorContext) {
  const { adjustment, onChange, doc, sourceImageData, sourceCoordSpace } = context;

  switch (adjustment.kind) {
    case 'paletteSnap':
      return (
        <PaletteSnapEditor
          adjustment={adjustment}
          onChange={onChange}
          doc={doc}
          sourceImageData={sourceImageData}
          sourceCoordSpace={sourceCoordSpace ?? undefined}
        />
      );

    case 'motionBlur':
    case 'mosaic':
    case 'surfaceSmooth':
    case 'edgeInk':
      return <SpatialEffectEditor adjustment={adjustment} onChange={onChange} />;

    case 'bloom':
      return (
        <BloomEditor
          adjustment={adjustment}
          onChange={onChange}
          doc={doc}
          sourceImageData={sourceImageData}
          sourceCoordSpace={sourceCoordSpace ?? undefined}
        />
      );

    case 'rgbSplit':
      return (
        <RgbSplitEditor
          adjustment={adjustment}
          onChange={onChange}
          doc={doc}
          sourceImageData={sourceImageData}
          sourceCoordSpace={sourceCoordSpace ?? undefined}
        />
      );

    case 'crt':
      return (
        <CrtEditor
          adjustment={adjustment}
          onChange={onChange}
          doc={doc}
          sourceImageData={sourceImageData}
          sourceCoordSpace={sourceCoordSpace ?? undefined}
        />
      );

    case 'vhs':
      return (
        <VhsEditor
          adjustment={adjustment}
          onChange={onChange}
          doc={doc}
          sourceImageData={sourceImageData}
          sourceCoordSpace={sourceCoordSpace ?? undefined}
        />
      );

    case 'lightShafts':
      return (
        <LightShaftsEditor
          adjustment={adjustment}
          onChange={onChange}
          doc={doc}
          sourceImageData={sourceImageData}
          sourceCoordSpace={sourceCoordSpace ?? undefined}
        />
      );

    case 'lensFlare':
      return (
        <LensFlareEditor
          adjustment={adjustment}
          onChange={onChange}
          doc={doc}
          sourceImageData={sourceImageData}
          sourceCoordSpace={sourceCoordSpace ?? undefined}
        />
      );

    case 'lightLeak':
      return (
        <LightLeakEditor
          adjustment={adjustment}
          onChange={onChange}
          doc={doc}
          sourceImageData={sourceImageData}
          sourceCoordSpace={sourceCoordSpace ?? undefined}
        />
      );

    case 'caustics':
      return (
        <CausticsEditor
          adjustment={adjustment}
          onChange={onChange}
          doc={doc}
          sourceImageData={sourceImageData}
          sourceCoordSpace={sourceCoordSpace ?? undefined}
        />
      );
  }
  return undefined;
}
