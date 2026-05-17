export type Orientation = 'portrait' | 'landscape';
export type PaperType = 'A4';

export interface PosterConfig {
  sheetCount: number;
  orientation: Orientation;
  paperType: PaperType;
  margin: number; // mm
  overlap: number; // mm
}

export interface GridDimensions {
  rows: number;
  cols: number;
  cellWidthMm: number;
  cellHeightMm: number;
}

export interface SlicedImagePage {
  dataUrl: string;
  row: number;
  col: number;
}
