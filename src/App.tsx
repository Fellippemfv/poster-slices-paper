import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Upload, 
  Download, 
  Settings, 
  Image as ImageIcon, 
  FileText, 
  Layout, 
  Monitor, 
  ChevronRight, 
  ChevronLeft, 
  Info,
  Maximize2,
  Minimize2,
  Trash2,
  Printer,
  FileImage,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import jsPDF from 'jspdf';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { Document, Packer, Paragraph, ImageRun, PageOrientation } from 'docx';
import { Orientation, PosterConfig, GridDimensions, SlicedImagePage } from './types';

// Constants for A4 dimensions in mm
const A4_PORTRAIT = { w: 210, h: 297 };
const A4_LANDSCAPE = { w: 297, h: 210 };

export default function App() {
  const [image, setImage] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState<{ w: number, h: number } | null>(null);
  const [config, setConfig] = useState<PosterConfig>({
    sheetCount: 4,
    orientation: 'portrait',
    paperType: 'A4',
    margin: 10, // mm (printing margin)
    overlap: 0,  // mm (glue overlap)
  });
  const [grid, setGrid] = useState<GridDimensions | null>(null);
  const [pages, setPages] = useState<SlicedImagePage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [scaleMultiplier, setScaleMultiplier] = useState(1.0);

  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 }); // mm
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number, y: number, offset: { x: number, y: number } } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset pan and scale when image or sheet count changes
  useEffect(() => {
    setPanOffset({ x: 0, y: 0 });
    setScaleMultiplier(1.0);
  }, [image, config.sheetCount, config.orientation, config.paperType]);

  // Consolidated calculations for the poster layout
  const posterLayout = useMemo(() => {
    if (!imageSize || !grid) return null;

    const paper = config.orientation === 'portrait' ? A4_PORTRAIT : A4_LANDSCAPE;
    const { rows, cols } = grid;
    const overlapMm = config.overlap;

    // The actual physical span of the assembled poster considering glue overlap
    const totalWidthMm = cols * paper.w - (cols - 1) * overlapMm;
    const totalHeightMm = rows * paper.h - (rows - 1) * overlapMm;
    
    // Scaling logic: "Cover" by default, then modified by multiplier
    const baseScale = Math.max(totalWidthMm / imageSize.w, totalHeightMm / imageSize.h);
    const scale = baseScale * scaleMultiplier;

    const finalWidthMm = imageSize.w * scale;
    const finalHeightMm = imageSize.h * scale;

    // Base centered offsets to fill the space balancedly
    const baseOffsetX = (totalWidthMm - finalWidthMm) / 2;
    const baseOffsetY = (totalHeightMm - finalHeightMm) / 2;

    // Apply manual pan offset on top of base alignment
    const offsetX = baseOffsetX + panOffset.x;
    const offsetY = baseOffsetY + panOffset.y;

    return {
      totalWidthMm,
      totalHeightMm,
      finalWidthMm,
      finalHeightMm,
      offsetX,
      offsetY,
      paper,
      rows,
      cols,
      overlapMm,
      scale
    };
  }, [imageSize, grid, config.overlap, config.orientation, panOffset, scaleMultiplier]);

  // Handle Image Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setImage(dataUrl);

      const img = new Image();
      img.onload = () => {
        setImageSize({ w: img.width, h: img.height });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  // Automatically calculate the best grid based on image ratio and sheet count
  useEffect(() => {
    if (!imageSize || !config.sheetCount) return;

    const paper = config.orientation === 'portrait' ? A4_PORTRAIT : A4_LANDSCAPE;
    const count = config.sheetCount;
    const overlapMm = config.overlap;
    
    const factors: [number, number][] = [];
    for (let i = 1; i <= count; i++) {
        if (count % i === 0) {
            factors.push([i, count / i]);
        }
    }

    const imageRatio = imageSize.w / imageSize.h;
    
    // Physical assembled aspect ratio calculation
    const getGridRatio = (r: number, c: number) => {
      const totalWidthMm = c * paper.w - (c - 1) * overlapMm;
      const totalHeightMm = r * paper.h - (r - 1) * overlapMm;
      return totalWidthMm / totalHeightMm;
    };

    let bestGrid: [number, number] = [1, count];
    let minScore = Infinity;

    factors.forEach(([rows, cols]) => {
      const canvasRatio = getGridRatio(rows, cols);
      const ratioDiff = Math.abs(canvasRatio - imageRatio);
      
    // We add a much stronger penalty for non-square grids to prefer balanced layouts (like 2x2 instead of 1x4)
    // This is especially important for murais escolares where 2x2 is the standard block.
    const balancePenalty = Math.pow(Math.abs(rows - cols), 2.5) * 0.5;
    const score = ratioDiff + balancePenalty;

      if (score < minScore) {
        minScore = score;
        bestGrid = [rows, cols];
      }
    });

    setGrid({
      rows: bestGrid[0],
      cols: bestGrid[1],
      cellWidthMm: paper.w,
      cellHeightMm: paper.h
    });
  }, [imageSize, config.sheetCount, config.orientation, config.overlap]);

  // Handle Dragging
  const handlePointerDown = (e: React.PointerEvent) => {
    if (!posterLayout) return;
    setIsDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      offset: { ...panOffset }
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !dragStartRef.current || !posterLayout) return;

    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;

    // Convert pixels to mm
    // We need to know the scale of the preview vs reality
    const visualizer = document.getElementById('poster-visualizer');
    if (!visualizer) return;
    
    const rect = visualizer.getBoundingClientRect();
    const pxToMmWidth = posterLayout.totalWidthMm / rect.width;
    const pxToMmHeight = posterLayout.totalHeightMm / rect.height;

    setPanOffset({
      x: dragStartRef.current.offset.x + (dx * pxToMmWidth),
      y: dragStartRef.current.offset.y + (dy * pxToMmHeight)
    });
  };

  const handlePointerUp = () => {
    setIsDragging(false);
    dragStartRef.current = null;
  };

  const adjustScale = (delta: number) => {
    setScaleMultiplier(prev => Math.max(0.2, Math.min(10, prev + delta)));
  };

  const generatePDF = async () => {
    if (!image || !posterLayout) return;
    
    setIsProcessing(true);
    const { 
      finalWidthMm, finalHeightMm, 
      offsetX, offsetY, paper, rows, cols, overlapMm 
    } = posterLayout;

    const img = new Image();
    img.src = image;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });

    const nativeDpiW = (img.naturalWidth / finalWidthMm) * 25.4;
    const nativeDpiH = (img.naturalHeight / finalHeightMm) * 25.4;
    const exportDpi = Math.max(300, Math.min(Math.max(nativeDpiW, nativeDpiH), 600));
    const pxPerMm = exportDpi / 25.4;

    const doc = new jsPDF({
      orientation: config.orientation,
      unit: 'mm',
      format: config.paperType,
      compress: false
    });

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    canvas.width = Math.round(paper.w * pxPerMm);
    canvas.height = Math.round(paper.h * pxPerMm);
    
    // Recalculate precise scale to avoid rounding drift
    const pxPerMmX = canvas.width / paper.w;
    const pxPerMmY = canvas.height / paper.h;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (r > 0 || c > 0) doc.addPage(config.paperType, config.orientation);
        
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const paperX = c * (paper.w - overlapMm);
        const paperY = r * (paper.h - overlapMm);

        const drawX = (offsetX - paperX) * pxPerMmX;
        const drawY = (offsetY - paperY) * pxPerMmY;
        const drawW = finalWidthMm * pxPerMmX;
        const drawH = finalHeightMm * pxPerMmY;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        ctx.drawImage(img, drawX, drawY, drawW, drawH);

        const pageData = canvas.toDataURL('image/jpeg', 0.95);
        doc.addImage(pageData, 'JPEG', 0, 0, paper.w, paper.h, undefined, 'FAST');
        
        const rowLabel = String.fromCharCode(65 + r);
        const colLabel = c + 1;
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text(`${rowLabel}${colLabel}`, 5, 5);
        
        await new Promise(r => setTimeout(r, 10));
      }
    }

    doc.save(`poster-hq-${Date.now()}.pdf`);
    setIsProcessing(false);
    setIsDownloadModalOpen(false);
  };

  const generateImages = async () => {
    if (!image || !posterLayout) return;
    
    setIsProcessing(true);
    const { 
      finalWidthMm, finalHeightMm, 
      offsetX, offsetY, paper, rows, cols, overlapMm 
    } = posterLayout;

    const img = new Image();
    img.src = image;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });

    const nativeDpiW = (img.naturalWidth / finalWidthMm) * 25.4;
    const nativeDpiH = (img.naturalHeight / finalHeightMm) * 25.4;
    const exportDpi = Math.max(300, Math.min(Math.max(nativeDpiW, nativeDpiH), 600));
    const pxPerMm = exportDpi / 25.4;

    const zip = new JSZip();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    canvas.width = Math.round(paper.w * pxPerMm);
    canvas.height = Math.round(paper.h * pxPerMm);
    
    const pxPerMmX = canvas.width / paper.w;
    const pxPerMmY = canvas.height / paper.h;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const paperX = c * (paper.w - overlapMm);
        const paperY = r * (paper.h - overlapMm);

        const drawX = (offsetX - paperX) * pxPerMmX;
        const drawY = (offsetY - paperY) * pxPerMmY;
        const drawW = finalWidthMm * pxPerMmX;
        const drawH = finalHeightMm * pxPerMmY;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        ctx.drawImage(img, drawX, drawY, drawW, drawH);

        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.95));
        if (blob) {
          const rowLabel = String.fromCharCode(65 + r);
          const colLabel = c + 1;
          zip.file(`poster_parte_${rowLabel}${colLabel}.jpg`, blob);
        }
        await new Promise(r => setTimeout(r, 10));
      }
    }

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, `poster-imagens-${Date.now()}.zip`);
    setIsProcessing(false);
    setIsDownloadModalOpen(false);
  };

  const generateDocx = async () => {
    if (!image || !posterLayout) return;
    
    setIsProcessing(true);
    const { 
      finalWidthMm, finalHeightMm, 
      offsetX, offsetY, paper, rows, cols, overlapMm 
    } = posterLayout;

    const img = new Image();
    img.src = image;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });

    const nativeDpiW = (img.naturalWidth / finalWidthMm) * 25.4;
    const nativeDpiH = (img.naturalHeight / finalHeightMm) * 25.4;
    const exportDpi = Math.max(300, Math.min(Math.max(nativeDpiW, nativeDpiH), 600));
    const pxPerMm = exportDpi / 25.4;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    canvas.width = Math.round(paper.w * pxPerMm);
    canvas.height = Math.round(paper.h * pxPerMm);
    
    const pxPerMmX = canvas.width / paper.w;
    const pxPerMmY = canvas.height / paper.h;

    const sections = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const paperX = c * (paper.w - overlapMm);
        const paperY = r * (paper.h - overlapMm);

        const drawX = (offsetX - paperX) * pxPerMmX;
        const drawY = (offsetY - paperY) * pxPerMmY;
        const drawW = finalWidthMm * pxPerMmX;
        const drawH = finalHeightMm * pxPerMmY;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        ctx.drawImage(img, drawX, drawY, drawW, drawH);

        const base64Data = canvas.toDataURL('image/jpeg', 0.95).split(',')[1];
        const buffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

        sections.push({
          properties: {
            page: {
              size: {
                width: `${paper.w}mm`,
                height: `${paper.h}mm`,
              },
              margin: { top: 0, right: 0, bottom: 0, left: 0 },
              orientation: config.orientation === 'portrait' ? PageOrientation.PORTRAIT : PageOrientation.LANDSCAPE,
            },
          },
          children: [
            new Paragraph({
              children: [
                new ImageRun({
                  data: buffer,
                  transformation: {
                    width: paper.w * 36000, 
                    height: paper.h * 36000,
                  },
                } as any),
              ],
            }),
          ],
        });
        await new Promise(r => setTimeout(r, 10));
      }
    }

    const doc = new Document({
      sections: sections
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `poster-word-${Date.now()}.docx`);
    setIsProcessing(false);
    setIsDownloadModalOpen(false);
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#e5e7eb] overflow-hidden text-brand-text">
      {/* Sidebar Control Panel - Ultra compact - width reduced further */}
      <aside className="w-full md:w-56 lg:w-60 bg-brand-sidebar border-r border-brand-border p-3 flex-shrink-0 flex flex-col overflow-y-auto z-10 transition-all shadow-xl">
        <header className="mb-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-7 h-7 bg-brand-accent text-white rounded-lg flex items-center justify-center font-bold text-base shadow-lg shadow-brand-accent/20">
              P
            </div>
            <h1 className="text-base font-bold tracking-tight text-brand-text">PosterSlice</h1>
          </div>
          <p className="text-[11px] leading-tight text-brand-muted">
            Fatie fotos para murais escolares rapidamente.
          </p>
        </header>

        <section className="space-y-4">
          {/* Upload Image */}
          <div className="space-y-1">
            <label className="text-[9px] font-bold uppercase tracking-wider text-brand-muted">Imagem Original</label>
            {!image ? (
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-20 border-2 border-dashed border-brand-border rounded-lg flex flex-col items-center justify-center gap-1 hover:border-brand-accent hover:bg-slate-50 transition-all group cursor-pointer"
              >
                <Upload className="w-4 h-4 text-brand-muted group-hover:text-brand-accent" />
                <span className="text-[11px] font-medium text-brand-muted group-hover:text-brand-accent">Escolher Foto</span>
              </button>
            ) : (
              <div className="relative aspect-video rounded-xl overflow-hidden border border-brand-border group shadow-sm">
                <img src={image} alt="Uploaded" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity gap-1.5">
                  <button onClick={() => fileInputRef.current?.click()} className="p-1.5 bg-white rounded-full text-brand-text shadow-lg hover:scale-110 transition-transform cursor-pointer">
                    <Upload className="w-4 h-4" />
                  </button>
                  <button onClick={() => setImage(null)} className="p-1.5 bg-white rounded-full text-red-500 shadow-lg hover:scale-110 transition-transform cursor-pointer">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept="image/*" 
              onChange={handleFileUpload}
            />
          </div>

          <hr className="border-brand-border" />

          {/* Configuration */}
          <div className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[9px] font-bold uppercase tracking-wider text-brand-muted flex items-center gap-1.5">
                Folhas <Info className="w-2.5 h-2.5 cursor-help text-brand-muted/50" />
              </label>
              <div className="grid grid-cols-2 gap-1">
                {[2, 4, 6, 8, 9, 12, 16, 20].map((n) => (
                  <button
                    key={n}
                    onClick={() => setConfig({ ...config, sheetCount: n })}
                    className={`py-1.5 rounded-md text-[11px] font-medium border transition-all cursor-pointer ${
                      config.sheetCount === n 
                        ? 'bg-indigo-50 text-brand-accent border-brand-accent font-bold' 
                        : 'bg-white text-brand-text border-brand-border hover:border-brand-accent hover:text-brand-accent'
                    }`}
                  >
                    {n} Folhas {n === 4 && grid?.rows === 2 && '(2x2)'}
                    {n === 4 && grid?.rows !== 2 && grid && `(${grid.rows}x${grid.cols})`}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[9px] font-bold uppercase tracking-wider text-brand-muted">Página A4</label>
              <div className="grid grid-cols-2 gap-1">
                <button
                  onClick={() => setConfig({ ...config, orientation: 'portrait' })}
                  className={`py-1.5 flex items-center justify-center gap-1.5 rounded-md text-[11px] font-medium border transition-all cursor-pointer ${
                    config.orientation === 'portrait' ? 'bg-indigo-50 text-brand-accent border-brand-accent font-bold' : 'bg-white text-brand-text border-brand-border hover:border-brand-accent'
                  }`}
                >
                  <Monitor className="w-3 h-3 rotate-90" /> Retr.
                </button>
                <button
                  onClick={() => setConfig({ ...config, orientation: 'landscape' })}
                  className={`py-1.5 flex items-center justify-center gap-1.5 rounded-md text-[11px] font-medium border transition-all cursor-pointer ${
                    config.orientation === 'landscape' ? 'bg-indigo-50 text-brand-accent border-brand-accent font-bold' : 'bg-white text-brand-text border-brand-border hover:border-brand-accent'
                  }`}
                >
                  <Monitor className="w-3 h-3" /> Pais.
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between items-end">
                <label className="text-[9px] font-bold uppercase tracking-wider text-brand-muted">Sobreposição</label>
                <span className="text-[10px] font-mono text-brand-muted">{config.overlap}mm</span>
              </div>
              <div className="relative">
                <input 
                  type="range" 
                  min="0" 
                  max="30" 
                  value={config.overlap}
                  onChange={(e) => setConfig({ ...config, overlap: parseInt(e.target.value) })}
                  className="w-full h-1 bg-brand-border rounded-lg appearance-none cursor-pointer accent-brand-accent"
                />
              </div>
            </div>
          </div>
        </section>

        <div className="mt-auto pt-4">
          <button
            disabled={!image || isProcessing}
            onClick={() => setIsDownloadModalOpen(true)}
            className="w-full h-10 bg-brand-accent text-white rounded-lg font-bold flex items-center justify-center gap-2 shadow-lg shadow-brand-accent/20 hover:bg-brand-accent-hover active:scale-[0.98] transition-all disabled:opacity-50 disabled:grayscale disabled:cursor-not-allowed text-sm cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 stroke-[2.5]" /> Baixar
          </button>
        </div>
      </aside>

      {/* Main Viewport - Compact */}
      <main className="flex-1 overflow-hidden relative flex flex-col dot-pattern bg-[#d1d5db] p-8 lg:p-10 gap-6">
        {!image ? (
          <div className="flex-1 flex flex-col items-center justify-center text-brand-muted">
            <div className="w-16 h-16 bg-white rounded-3xl shadow-sm flex items-center justify-center border border-brand-border mb-4">
              <ImageIcon className="w-8 h-8 opacity-20" />
            </div>
            <p className="text-base font-bold opacity-50 text-center">Envie uma imagem para<br />criar seu pôster gigante</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full gap-5">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-bold text-brand-text">Prévia da Composição</h1>
                <p className="text-[13px] font-medium text-brand-muted">
                  Tamanho Total: {(posterLayout?.totalWidthMm ? posterLayout.totalWidthMm / 10 : 0).toFixed(1)} x {(posterLayout?.totalHeightMm ? posterLayout.totalHeightMm / 10 : 0).toFixed(1)} cm
                </p>
              </div>
              <div className="bg-white text-brand-accent px-3 py-1 rounded-full text-[11px] font-bold ring-1 ring-brand-accent/20 shadow-sm">
                Qualidade Máxima
              </div>
            </div>

            {/* Assembly Visualizer - More compact */}
            <div className="flex-1 min-h-0 bg-black/5 rounded-2xl border border-black/10 shadow-inner flex flex-col items-center justify-center relative p-12">
              <div className="absolute top-3 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 z-30 pointer-events-none">
                <p className="text-[9px] font-bold uppercase tracking-widest text-brand-muted/80 bg-white/50 px-2 py-0.5 rounded-full backdrop-blur-sm">
                  Arraste para mover o papel
                </p>
              </div>

              {/* Float Zoom Controls - Smaller buttons */}
              <div className="absolute bottom-4 right-4 flex flex-col gap-1.5 z-40">
                <button 
                  onClick={() => adjustScale(0.1)}
                  className="w-9 h-9 bg-white rounded-full shadow-lg border border-brand-border flex items-center justify-center text-brand-text hover:text-brand-accent hover:border-brand-accent active:scale-95 transition-all cursor-pointer"
                  title="Aumentar Zoom"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => adjustScale(-0.1)}
                  className="w-9 h-9 bg-white rounded-full shadow-lg border border-brand-border flex items-center justify-center text-brand-text hover:text-brand-accent hover:border-brand-accent active:scale-95 transition-all cursor-pointer"
                  title="Diminuir Zoom"
                >
                  <Minimize2 className="w-4 h-4" />
                </button>
                <div className="bg-white/90 backdrop-blur-sm px-1.5 py-0.5 rounded border border-brand-border text-[9px] font-mono text-center shadow-sm">
                  {(scaleMultiplier * 100).toFixed(0)}%
                </div>
              </div>
              
              {/* Scale container to keep the grid at a manageable size within the view */}
              <div className="relative w-full h-full flex items-center justify-center">
                {/* The "Cropped" area indicator */}
                <div 
                  id="poster-visualizer"
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  className={`relative shadow-2xl ring-4 ring-brand-accent outline outline-1 outline-brand-accent/40 bg-white flex items-center justify-center cursor-move touch-none transition-transform ${isDragging ? 'scale-[1.02]' : ''}`}
                  style={{ 
                    width: config.orientation === 'portrait' ? 'auto' : '70%',
                    height: config.orientation === 'portrait' ? '70%' : 'auto',
                    aspectRatio: posterLayout ? `${posterLayout.totalWidthMm} / ${posterLayout.totalHeightMm}` : '1'
                  }}
                >
                    {/* Main Background Image - Cleaned up to be purely for context */}
                    <img 
                      src={image} 
                      draggable={false}
                      className="absolute left-0 top-0 pointer-events-none image-high-quality max-w-none opacity-20 grayscale blur-[1px]" 
                      style={{
                        width: posterLayout ? `${(posterLayout.finalWidthMm / posterLayout.totalWidthMm) * 100}%` : 'auto',
                        height: posterLayout ? `${(posterLayout.finalHeightMm / posterLayout.totalHeightMm) * 100}%` : 'auto',
                        transform: posterLayout ? `translate(${(posterLayout.offsetX / posterLayout.finalWidthMm) * 100}%, ${(posterLayout.offsetY / posterLayout.finalHeightMm) * 100}%)` : 'none',
                      }}
                      alt="" 
                    />
                    
                    {/* Dim layer for everything outside the paper grid */}
                    <div className="absolute -inset-[10000px] pointer-events-none border-[10000px] border-slate-900/40 z-[10]" />
                    
                    {/* Grid Overlay with individual sheets for pixel-perfect preview */}
                    <div 
                      className="absolute inset-0 pointer-events-none z-[20]" 
                    >
                      {posterLayout && Array.from({ length: posterLayout.rows * posterLayout.cols }).map((_, i) => {
                        const r = Math.floor(i / posterLayout.cols);
                        const c = i % posterLayout.cols;
                        const paperX = c * (posterLayout.paper.w - posterLayout.overlapMm);
                        const paperY = r * (posterLayout.paper.h - posterLayout.overlapMm);
                        
                        return (
                          <motion.div 
                            key={i}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="absolute bg-white overflow-hidden border border-brand-accent/20 shadow-sm shadow-black/5"
                            style={{ 
                              width: `${(posterLayout.paper.w / posterLayout.totalWidthMm) * 100}%`,
                              height: `${(posterLayout.paper.h / posterLayout.totalHeightMm) * 100}%`,
                              left: `${(paperX / posterLayout.totalWidthMm) * 100}%`,
                              top: `${(paperY / posterLayout.totalHeightMm) * 100}%`,
                              zIndex: i + 1
                            }}
                          >
                            {/* The image inside the page, positioned exactly like in the PDF */}
                            <img 
                              src={image} 
                              draggable={false}
                              className="absolute left-0 top-0 pointer-events-none image-high-quality max-w-none origin-top-left" 
                              style={{
                                width: `${(posterLayout.finalWidthMm / posterLayout.paper.w) * 100}%`,
                                height: `${(posterLayout.finalHeightMm / posterLayout.paper.h) * 100}%`,
                                transform: `translate(${( (posterLayout.offsetX - paperX) / posterLayout.finalWidthMm) * 100}%, ${( (posterLayout.offsetY - paperY) / posterLayout.finalHeightMm) * 100}%)`,
                                opacity: 1
                              }}
                              alt="" 
                            />

                            {/* Label Overlay */}
                            <div className="absolute top-1.5 left-1.5 sm:top-2 sm:left-2 z-[30]">
                              <span className="text-[10px] sm:text-xs font-black text-brand-accent bg-white/95 px-1.5 py-0.5 rounded shadow-sm ring-1 ring-brand-accent/20">
                                {String.fromCharCode(65 + r)}{ c + 1 }
                              </span>
                            </div>

                            {/* Corner Cut Guides (Visual only) */}
                            <div className="absolute inset-0 border border-brand-accent/10 border-dashed pointer-events-none" />
                          </motion.div>
                        );
                      })}
                    </div>
                </div>
              </div>
            </div>

            <div className="bg-white/50 p-2.5 rounded-xl border border-black/5 flex items-center gap-3 text-brand-muted">
              <div className="w-7 h-7 bg-white rounded-lg flex items-center justify-center text-brand-accent flex-shrink-0 shadow-sm">
                <Printer className="w-3.5 h-3.5" />
              </div>
              <div className="text-[10px] leading-tight">
                <p className="font-bold text-brand-text">Dica para Professor(a)</p>
                <p>A prévia acima reflete exatamente o PDF. As folhas se encaixam usando a sobreposição configurada.</p>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Download Selection Modal */}
      <AnimatePresence>
        {isDownloadModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsDownloadModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm cursor-pointer"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden border border-brand-border"
            >
              <div className="p-5 border-b border-brand-border flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-brand-text">Baixar Pôster</h3>
                  <p className="text-[10px] text-brand-muted uppercase font-bold tracking-wider">Escolha o formato</p>
                </div>
                <button 
                  onClick={() => setIsDownloadModalOpen(false)}
                  className="p-1.5 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <X className="w-4 h-4 text-brand-muted" />
                </button>
              </div>

              <div className="p-4 space-y-3">
                <button
                  disabled={isProcessing}
                  onClick={generatePDF}
                  className="w-full flex items-center gap-4 p-3 rounded-xl border border-brand-border hover:border-brand-accent hover:bg-indigo-50 transition-all group group-disabled:opacity-50 cursor-pointer"
                >
                  <div className="w-10 h-10 bg-red-50 rounded-lg flex items-center justify-center text-red-500 group-hover:scale-110 transition-transform">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-brand-text text-sm">Documento PDF</p>
                    <p className="text-[11px] text-brand-muted">Recomendado para impressão facial</p>
                  </div>
                </button>

                <button
                  disabled={isProcessing}
                  onClick={generateImages}
                  className="w-full flex items-center gap-4 p-3 rounded-xl border border-brand-border hover:border-brand-accent hover:bg-indigo-50 transition-all group group-disabled:opacity-50 cursor-pointer"
                >
                  <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center text-blue-500 group-hover:scale-110 transition-transform">
                    <FileImage className="w-6 h-6" />
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-brand-text text-sm">Imagens (ZIP)</p>
                    <p className="text-[11px] text-brand-muted">Arquivos JPG individuais para cada folha</p>
                  </div>
                </button>

                <button
                  disabled={isProcessing}
                  onClick={generateDocx}
                  className="w-full flex items-center gap-4 p-3 rounded-xl border border-brand-border hover:border-brand-accent hover:bg-indigo-50 transition-all group group-disabled:opacity-50 cursor-pointer"
                >
                  <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center text-brand-accent group-hover:scale-110 transition-transform">
                    <Printer className="w-6 h-6" />
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-brand-text text-sm">Arquivo Word (DOCX)</p>
                    <p className="text-[11px] text-brand-muted">Uma folha por página no Word</p>
                  </div>
                </button>
              </div>

              {isProcessing && (
                <div className="px-4 pb-4">
                  <div className="bg-brand-accent/10 rounded-lg p-3 flex items-center gap-3">
                    <div className="w-4 h-4 border-2 border-brand-accent border-t-transparent rounded-full animate-spin" />
                    <p className="text-xs font-bold text-brand-accent italic">Processando alta qualidade...</p>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

