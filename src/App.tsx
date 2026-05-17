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
  Printer
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import jsPDF from 'jspdf';
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
    overlap: 5,  // mm (glue overlap)
  });
  const [grid, setGrid] = useState<GridDimensions | null>(null);
  const [pages, setPages] = useState<SlicedImagePage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

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
    
    // Simple factors for even numbers
    const factors: [number, number][] = [];
    for (let i = 1; i <= Math.sqrt(count); i++) {
        if (count % i === 0) {
            factors.push([i, count / i]);
            if (i !== count / i) factors.push([count / i, i]);
        }
    }

    const imageRatio = imageSize.w / imageSize.h;
    
    let bestGrid: [number, number] = [1, count];
    let minDiff = Infinity;

    factors.forEach(([rows, cols]) => {
      // The total canvas ratio in mm
      const totalWidthMm = cols * paper.w;
      const totalHeightMm = rows * paper.h;
      const canvasRatio = totalWidthMm / totalHeightMm;
      
      const diff = Math.abs(canvasRatio - imageRatio);
      if (diff < minDiff) {
        minDiff = diff;
        bestGrid = [rows, cols];
      }
    });

    setGrid({
      rows: bestGrid[0],
      cols: bestGrid[1],
      cellWidthMm: paper.w,
      cellHeightMm: paper.h
    });
  }, [imageSize, config.sheetCount, config.orientation]);

  // Process image Splicing
  useEffect(() => {
    if (!image || !grid || !imageSize) return;

    const process = async () => {
      setIsProcessing(true);
      const img = new Image();
      img.src = image;
      await new Promise(res => img.onload = res);

      const paper = config.orientation === 'portrait' ? A4_PORTRAIT : A4_LANDSCAPE;
      const rows = grid.rows;
      const cols = grid.cols;

      // We want to scale the image to fill the grid as much as possible
      // but without distortion (contain vs cover depends on preference, 
      // but usually for posters we want to maximize the area on the paper)
      
      // Physical Overlap logic:
      // Each sheet will overlap by config.overlap mm.
      // So the "effective" width of a sheet that is NOT the last one is (paper.w - overlap).
      const overlapMm = config.overlap;

      const totalGridWidthMm = paper.w + (cols - 1) * (paper.w - overlapMm);
      const totalGridHeightMm = paper.h + (rows - 1) * (paper.h - overlapMm);
      
      const scaleX = totalGridWidthMm / imageSize.w;
      const scaleY = totalGridHeightMm / imageSize.h;
      const scale = Math.min(scaleX, scaleY);

      const finalWidthMm = imageSize.w * scale;
      const finalHeightMm = imageSize.h * scale;

      // Center the image in the physical grid
      const offsetX = (totalGridWidthMm - finalWidthMm) / 2;
      const offsetY = (totalGridHeightMm - finalHeightMm) / 2;

      const newPages: SlicedImagePage[] = [];
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { alpha: false });
      
      if (!ctx) return;

      const PREVIEW_DPI = 96; // Fast for browser preview
      const mmToPx = (mm: number) => (mm * PREVIEW_DPI) / 25.4;

      canvas.width = Math.round(mmToPx(paper.w));
      canvas.height = Math.round(mmToPx(paper.h));

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          const paperX = c * (paper.w - overlapMm);
          const paperY = r * (paper.h - overlapMm);

          const drawXMinMm = offsetX - paperX;
          const drawYMinMm = offsetY - paperY;

          ctx.imageSmoothingEnabled = true;

          ctx.drawImage(
            img,
            Math.round(mmToPx(drawXMinMm)),
            Math.round(mmToPx(drawYMinMm)),
            Math.round(mmToPx(finalWidthMm)),
            Math.round(mmToPx(finalHeightMm))
          );

          // Optional: Visual guide for overlap
          if (overlapMm > 0) {
            ctx.strokeStyle = 'rgba(0,0,0,0.1)';
            ctx.setLineDash([mmToPx(2), mmToPx(2)]);
            ctx.lineWidth = 1;
            
            if (c < cols - 1) {
              ctx.strokeRect(mmToPx(paper.w - overlapMm), 0, mmToPx(overlapMm), mmToPx(paper.h));
            }
            if (r < rows - 1) {
              ctx.strokeRect(0, mmToPx(paper.h - overlapMm), mmToPx(paper.w), mmToPx(overlapMm));
            }
          }

          newPages.push({
            dataUrl: canvas.toDataURL('image/jpeg', 0.8), // Lower quality for faster UI
            row: r,
            col: c
          });
        }
      }

      setPages(newPages);
      setIsProcessing(false);
      setCurrentPage(0);
    };

    process();
  }, [image, grid, config.overlap]);

  const generatePDF = async () => {
    if (!image || !grid || !imageSize) return;
    
    setIsProcessing(true);
    
    // 300 DPI é o padrão da indústria para impressão de alta qualidade.
    // Acima disso em navegadores pode causar estouro de memória (OOM).
    const HIGH_DPI = 300;
    const mmToPx = (mm: number) => (mm * HIGH_DPI) / 25.4;
    
    const paper = config.orientation === 'portrait' ? A4_PORTRAIT : A4_LANDSCAPE;
    const rows = grid.rows;
    const cols = grid.cols;
    const overlapMm = config.overlap;

    const totalGridWidthMm = paper.w + (cols - 1) * (paper.w - overlapMm);
    const totalGridHeightMm = paper.h + (rows - 1) * (paper.h - overlapMm);
    
    const scaleX = totalGridWidthMm / imageSize.w;
    const scaleY = totalGridHeightMm / imageSize.h;
    const scale = Math.min(scaleX, scaleY);

    const finalWidthMm = imageSize.w * scale;
    const finalHeightMm = imageSize.h * scale;

    const offsetX = (totalGridWidthMm - finalWidthMm) / 2;
    const offsetY = (totalGridHeightMm - finalHeightMm) / 2;

    const doc = new jsPDF({
      orientation: config.orientation,
      unit: 'mm',
      format: config.paperType,
      compress: true // Ativamos para manter o arquivo final em um tamanho gerenciável
    });

    const img = new Image();
    img.src = image;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { 
      alpha: false
    });
    
    if (!ctx) return;

    canvas.width = Math.round(mmToPx(paper.w));
    canvas.height = Math.round(mmToPx(paper.h));

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (r > 0 || c > 0) doc.addPage();
        
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const paperX = c * (paper.w - overlapMm);
        const paperY = r * (paper.h - overlapMm);

        const drawXMinMm = offsetX - paperX;
        const drawYMinMm = offsetY - paperY;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        ctx.drawImage(
          img,
          Math.round(mmToPx(drawXMinMm)),
          Math.round(mmToPx(drawYMinMm)),
          Math.round(mmToPx(finalWidthMm)),
          Math.round(mmToPx(finalHeightMm))
        );

        // JPEG a 1.0 ou 0.95 é muito mais rápido que PNG e mantém qualidade fotográfica
        const pageData = canvas.toDataURL('image/jpeg', 0.95);
        
        doc.addImage(pageData, 'JPEG', 0, 0, paper.w, paper.h, undefined, 'FAST');
        
        doc.setFontSize(8);
        doc.setTextColor(180);
        doc.text(`Sheet ${(r * cols) + c + 1} | Grid: ${r + 1},${c + 1} | PosterSlice High Quality`, 5, paper.h - 5);
        
        await new Promise(r => setTimeout(r, 10));
      }
    }

    doc.save(`poster-hq-${Date.now()}.pdf`);
    setIsProcessing(false);
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-brand-bg overflow-hidden text-brand-text">
      {/* Sidebar Control Panel */}
      <aside className="w-full md:w-80 lg:w-96 bg-brand-sidebar border-r border-brand-border p-6 flex-shrink-0 flex flex-col overflow-y-auto z-10">
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 bg-brand-accent text-white rounded-lg flex items-center justify-center font-bold text-xl shadow-lg shadow-brand-accent/20">
              P
            </div>
            <h1 className="text-xl font-bold tracking-tight text-brand-text">PosterSlice</h1>
          </div>
          <p className="text-[13px] text-brand-muted">
            Crie pôsteres gigantes fatiando fotos em folhas A4.
          </p>
        </header>

        <section className="space-y-6">
          {/* Upload Image */}
          <div className="space-y-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-brand-muted">Source Image</label>
            {!image ? (
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-32 border-2 border-dashed border-brand-border rounded-xl flex flex-col items-center justify-center gap-2 hover:border-brand-accent hover:bg-indigo-50 transition-all group"
              >
                <Upload className="w-6 h-6 text-brand-muted group-hover:text-brand-accent" />
                <span className="text-sm font-medium text-brand-muted group-hover:text-brand-accent">Enviar Foto</span>
              </button>
            ) : (
              <div className="relative aspect-video rounded-xl overflow-hidden border border-brand-border group shadow-sm">
                <img src={image} alt="Uploaded" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity gap-2">
                  <button onClick={() => fileInputRef.current?.click()} className="p-2 bg-white rounded-full text-brand-text shadow-lg hover:scale-110 transition-transform">
                    <Upload className="w-4 h-4" />
                  </button>
                  <button onClick={() => setImage(null)} className="p-2 bg-white rounded-full text-red-500 shadow-lg hover:scale-110 transition-transform">
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
          <div className="space-y-6">
            <div className="flex flex-col gap-3">
              <label className="text-[11px] font-bold uppercase tracking-wider text-brand-muted flex items-center gap-1.5">
                Grid Layout <Info className="w-3.5 h-3.5 cursor-help text-brand-muted/50" />
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[2, 4, 6, 8, 9, 12, 16, 20].map((n) => (
                  <button
                    key={n}
                    onClick={() => setConfig({ ...config, sheetCount: n })}
                    className={`py-2.5 rounded-lg text-[13px] font-medium border transition-all ${
                      config.sheetCount === n 
                        ? 'bg-indigo-50 text-brand-accent border-brand-accent font-bold' 
                        : 'bg-white text-brand-text border-brand-border hover:border-brand-accent hover:text-brand-accent'
                    }`}
                  >
                    {n} Sheets {n === 4 && '(2x2)'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <label className="text-[11px] font-bold uppercase tracking-wider text-brand-muted">Page Settings</label>
              <div className="w-full py-2.5 px-3 bg-indigo-50 border border-brand-accent rounded-lg text-[13px] font-bold text-brand-accent mb-2 flex items-center gap-2">
                <FileText className="w-4 h-4" /> A4 Standard
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setConfig({ ...config, orientation: 'portrait' })}
                  className={`py-2.5 flex items-center justify-center gap-2 rounded-lg text-[13px] font-medium border transition-all ${
                    config.orientation === 'portrait' ? 'bg-indigo-50 text-brand-accent border-brand-accent font-bold' : 'bg-white text-brand-text border-brand-border hover:border-brand-accent'
                  }`}
                >
                  <Monitor className="w-4 h-4 rotate-90" /> Portrait
                </button>
                <button
                  onClick={() => setConfig({ ...config, orientation: 'landscape' })}
                  className={`py-2.5 flex items-center justify-center gap-2 rounded-lg text-[13px] font-medium border transition-all ${
                    config.orientation === 'landscape' ? 'bg-indigo-50 text-brand-accent border-brand-accent font-bold' : 'bg-white text-brand-text border-brand-border hover:border-brand-accent'
                  }`}
                >
                  <Monitor className="w-4 h-4" /> Landscape
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-end">
                <label className="text-[11px] font-bold uppercase tracking-wider text-brand-muted">Overlap Margin</label>
                <span className="text-xs font-mono text-brand-muted">{config.overlap}mm precise</span>
              </div>
              <div className="relative pt-2">
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

        <div className="mt-auto pt-8">
          <button
            disabled={!image || isProcessing}
            onClick={generatePDF}
            className="w-full h-14 bg-brand-accent text-white rounded-xl font-bold flex items-center justify-center gap-3 shadow-xl shadow-brand-accent/30 hover:bg-brand-accent-hover active:scale-[0.98] transition-all disabled:opacity-50 disabled:grayscale disabled:cursor-not-allowed text-lg"
          >
            {isProcessing ? 'Processing...' : <><Download className="w-5 h-5 stroke-[2.5]" /> Generate PDF</>}
          </button>
        </div>
      </aside>

      {/* Main Viewport */}
      <main className="flex-1 overflow-hidden relative flex flex-col dot-pattern bg-[#f8f9fa] p-10 gap-8">
        {!image ? (
          <div className="flex-1 flex flex-col items-center justify-center text-brand-muted">
            <div className="w-24 h-24 bg-white rounded-3xl shadow-sm flex items-center justify-center border border-brand-border mb-6">
              <ImageIcon className="w-12 h-12 opacity-20" />
            </div>
            <p className="text-xl font-bold opacity-50">Selecione uma imagem para começar</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-brand-text">Composition Preview</h1>
                <p className="text-[14px] font-medium text-brand-muted">
                  Total Size: {(grid ? grid.cols * (config.orientation === 'portrait' ? 21.0 : 29.7) : 0).toFixed(1)} x {(grid ? grid.rows * (config.orientation === 'portrait' ? 29.7 : 21.0) : 0).toFixed(1)} cm
                </p>
              </div>
              <div className="bg-[#dcfce7] text-[#166534] px-4 py-1.5 rounded-full text-xs font-bold ring-1 ring-[#166534]/10 shadow-sm">
                Scale: {pages.length > 0 ? 'Optimal (300DPI)' : 'Calculating...'}
              </div>
            </div>

            {/* Assembly Visualizer */}
            <div className="flex-1 min-h-0 bg-white rounded-2xl border border-brand-border shadow-sm flex items-center justify-center overflow-hidden relative group">
              <div 
                className={`relative shadow-2xl transition-transform duration-500 overflow-hidden ring-4 ring-brand-accent outline outline-1 outline-brand-accent/40`}
                style={{ 
                  width: config.orientation === 'portrait' ? '400px' : '550px',
                  aspectRatio: grid ? `${grid.cols * (config.orientation === 'portrait' ? 210 : 297)} / ${grid.rows * (config.orientation === 'portrait' ? 297 : 210)}` : '1'
                }}
              >
                  <img src={image} className="w-full h-full object-cover image-high-quality brightness-95" alt="Poster Visualization" />
                  
                  {/* Grid Overlay */}
                  <div 
                    className="absolute inset-0 grid" 
                    style={{ 
                      gridTemplateColumns: `repeat(${grid?.cols || 1}, 1fr)`,
                      gridTemplateRows: `repeat(${grid?.rows || 1}, 1fr)`
                    }}
                  >
                    {Array.from({ length: (grid?.rows || 0) * (grid?.cols || 0) }).map((_, i) => (
                      <div key={i} className="border border-brand-accent/40 border-dashed flex items-start p-2">
                        <span className="text-[10px] font-black text-brand-accent bg-white/60 px-1 rounded ring-1 ring-brand-accent/20">
                          {String.fromCharCode(65 + Math.floor(i / (grid?.cols || 1)))}{ (i % (grid?.cols || 1)) + 1 }
                        </span>
                      </div>
                    ))}
                  </div>
              </div>
            </div>

            {/* Carousel / Sheet Preview */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-wider text-brand-muted">Individual Pages ({pages.length} Total)</p>
                <div className="flex items-center gap-2 text-[10px] font-bold text-brand-muted">
                  <Layout className="w-3 h-3" /> Scroll horizontal para ver mais
                </div>
              </div>

              <div className="flex gap-4 overflow-x-auto pb-6 px-1 custom-scrollbar scroll-smooth snap-x">
                {pages.map((page, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className={`bg-white p-2 rounded-lg border border-brand-border shadow-lg relative group h-[200px] flex-shrink-0 snap-center hover:border-brand-accent transition-colors ${
                      config.orientation === 'portrait' ? 'aspect-[210/297]' : 'aspect-[297/210]'
                    }`}
                  >
                    <div className="w-full h-full overflow-hidden relative rounded-sm bg-slate-100">
                      <img 
                        src={page.dataUrl} 
                        className="w-full h-full object-cover image-high-quality" 
                        alt={`Page ${idx + 1}`} 
                      />
                      {/* Overlap guides highlight */}
                      <div className="absolute top-0 right-0 bottom-0 w-[8px] bg-brand-accent/5 border-l border-dashed border-brand-accent/20" />
                      <div className="absolute bottom-0 left-0 right-0 h-[8px] bg-brand-accent/5 border-t border-dashed border-brand-accent/20" />
                      
                      <div className="absolute bottom-2 right-2 bg-brand-accent text-white text-[9px] px-1.5 py-0.5 rounded font-black shadow-sm">
                        P{idx + 1}
                      </div>
                      
                      <div className="absolute top-2 left-2 bg-white/90 text-brand-text text-[8px] px-1 rounded font-mono border border-brand-border">
                        {page.row + 1},{page.col + 1}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
