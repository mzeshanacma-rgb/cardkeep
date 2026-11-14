"use client";

import { useEffect, useRef, useState } from "react";
import { CameraIcon, XIcon } from "./icons";

export default function LiveCamera({ onCapture, onClose }: { onCapture: (dataURL: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setReady(true);
        }
      } catch (e) {
        const name = (e as Error).name;
        setError(
          name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access in your browser settings, or use Take Photo."
            : "Couldn't open the camera on this device. Use Take Photo or Choose Photo instead.",
        );
      }
    })();
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    onCapture(c.toDataURL("image/jpeg", 0.92));
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black" role="dialog" aria-modal="true" aria-label="Live camera">
      <div className="flex items-center justify-between p-4 text-white">
        <span className="font-medium">Fit the card inside the frame</span>
        <button onClick={onClose} className="rounded-full p-2 hover:bg-white/10" aria-label="Close camera">
          <XIcon className="h-6 w-6" />
        </button>
      </div>
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        <video ref={videoRef} playsInline muted className="h-full w-full object-contain" />
        {ready && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="aspect-[1.75] w-[85%] max-w-xl rounded-2xl border-4 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
          </div>
        )}
        {error && <p className="absolute max-w-sm px-6 text-center text-white">{error}</p>}
      </div>
      <div className="flex justify-center p-6">
        <button
          onClick={capture}
          disabled={!ready}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-blue-700 shadow-lg disabled:opacity-40"
          aria-label="Capture photo"
        >
          <CameraIcon className="h-7 w-7" />
        </button>
      </div>
    </div>
  );
}
