import { useEffect, useRef, useState, useCallback } from "react";
import { Camera, ScanLine, Zap, ZapOff } from "lucide-react";
import { Modal } from "./ui";

interface BarcodeScannerProps {
  open: boolean;
  onClose: () => void;
  onScan: (barcode: string) => void;
  title?: string;
}

/**
 * Browser-based barcode/QR scanner.
 * Uses BarcodeDetector API (Chrome/Edge) with fallback to camera preview.
 * No external dependencies.
 */
export default function BarcodeScanner({
  open,
  onClose,
  onScan,
  title = "Scan Barcode",
}: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(true);
  const [lastScan, setLastScan] = useState("");
  const [hasBarcodeDetector, setHasBarcodeDetector] = useState(false);

  // Check BarcodeDetector availability
  useEffect(() => {
    if ("BarcodeDetector" in window) {
      setHasBarcodeDetector(true);
    }
  }, []);

  // Debounce scans to avoid duplicates
  const debounceRef = useRef(0);
  const handleBarcode = useCallback(
    (code: string) => {
      const now = Date.now();
      if (now - debounceRef.current < 1500) return; // 1.5s debounce
      if (!code.trim()) return;
      debounceRef.current = now;
      setLastScan(code);
      onScan(code);
    },
    [onScan]
  );

  // Manual barcode input
  const [manualCode, setManualCode] = useState("");
  const submitManual = () => {
    if (!manualCode.trim()) return;
    handleBarcode(manualCode.trim());
    setManualCode("");
  };

  // Start camera
  useEffect(() => {
    if (!open) return;
    setError("");
    setScanning(true);
    setLastScan("");

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          startScanning();
        }
      } catch (e: any) {
        setError(
          e?.name === "NotAllowedError"
            ? "Camera access denied. Please allow camera access and try again."
            : e?.name === "NotFoundError"
            ? "No camera found on this device."
            : `Camera error: ${e?.message || "Could not access camera"}`
        );
      }
    };

    startCamera();

    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const stopCamera = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const startScanning = () => {
    if (!hasBarcodeDetector || !videoRef.current) {
      // Fallback: just show camera preview, user uses manual input
      return;
    }

    const detector = new (window as any).BarcodeDetector({
      formats: [
        "qr_code",
        "ean_13",
        "ean_8",
        "upc_a",
        "upc_e",
        "code_128",
        "code_39",
        "code_93",
        "codabar",
        "itf",
        "data_matrix",
        "pdf417",
        "aztec",
      ],
    });

    const tick = async () => {
      if (!videoRef.current || !scanning) return;
      try {
        const barcodes = await detector.detect(videoRef.current);
        if (barcodes.length > 0) {
          handleBarcode(barcodes[0].rawValue);
        }
      } catch {
        // BarcodeDetector may throw on some frames
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  };

  const toggleScanning = () => {
    setScanning((s) => !s);
    if (!scanning) startScanning();
  };

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      <div className="space-y-4">
        {/* Camera view */}
        <div className="relative bg-black rounded-xl overflow-hidden aspect-[4/3]">
          {error ? (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900 text-white text-sm p-4 text-center">
              <div>
                <Camera size={32} className="mx-auto mb-2 opacity-40" />
                <p>{error}</p>
                <p className="text-brand-400 text-xs mt-2">
                  You can still type a barcode below.
                </p>
              </div>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
              />
              {/* Scanning overlay */}
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute inset-[15%] border-2 border-primary-400/60 rounded-2xl">
                  <div className="absolute top-0 left-0 w-8 h-8 border-t-3 border-l-3 border-primary-400 rounded-tl-xl" />
                  <div className="absolute top-0 right-0 w-8 h-8 border-t-3 border-r-3 border-primary-400 rounded-tr-xl" />
                  <div className="absolute bottom-0 left-0 w-8 h-8 border-b-3 border-l-3 border-primary-400 rounded-bl-xl" />
                  <div className="absolute bottom-0 right-0 w-8 h-8 border-b-3 border-r-3 border-primary-400 rounded-br-xl" />
                </div>
              </div>
              {/* Scan line animation */}
              {scanning && (
                <div
                  className="absolute left-[15%] right-[15%] h-0.5 bg-primary-400 animate-barcode-scan"
                  style={{
                    animation: "barcodeScan 2s ease-in-out infinite",
                    boxShadow: "0 0 8px 2px rgba(255,214,0,0.4)",
                  }}
                />
              )}
            </>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          {hasBarcodeDetector && (
            <button
              className={`btn-ghost text-xs ${scanning ? "text-success" : "text-brand-400"}`}
              onClick={toggleScanning}
            >
              {scanning ? (
                <>
                  <Zap size={14} /> Auto-scanning
                </>
              ) : (
                <>
                  <ZapOff size={14} /> Resume scan
                </>
              )}
            </button>
          )}
          {lastScan && (
            <span className="text-xs text-success font-mono font-semibold">
              <ScanLine size={12} className="inline mr-1" />
              {lastScan}
            </span>
          )}
        </div>

        {/* Manual input */}
        <div>
          <p className="text-xs font-semibold text-brand-400 mb-2">
            Or type a barcode / SKU
          </p>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="Scan or type barcode…"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitManual();
              }}
              autoFocus
            />
            <button
              className="btn-primary"
              onClick={submitManual}
              disabled={!manualCode.trim()}
            >
              <ScanLine size={14} /> Look up
            </button>
          </div>
          <p className="text-[11px] text-brand-400 mt-1.5">
            Supports QR codes, EAN-13/UPC barcodes, Code-128, Data Matrix
          </p>
        </div>
      </div>

      <style>{`
        @keyframes barcodeScan {
          0%, 100% { top: 15%; }
          50% { top: 85%; }
        }
      `}</style>
    </Modal>
  );
}
