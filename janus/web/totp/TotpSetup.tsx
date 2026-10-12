import { useEffect, useRef, useState } from "react";
import { Camera, ClipboardPaste, ImageUp, ScanLine } from "lucide-react";
import {
  TOTP_ALGORITHMS,
  checkTotpParams,
  formatOtpauth,
  parseTotpInput,
  type TotpAlgorithm,
  type TotpParams,
} from "../../shared/totp.ts";
import { LIMITS } from "../../shared/protocol.ts";
import { Dialog } from "../ui/Dialog.tsx";
import { closeDialog } from "../ui/closeDialog.ts";
import { label, primaryButton, secondaryButton, textInput } from "../ui/buttons.ts";
import { LocalCode } from "./CodeDisplay.tsx";
import { readQr, readQrFromImage } from "./qr.ts";

interface TotpSetupProps {
  /** for a bare secret, which has no names of its own: the entry's title and username */
  defaultIssuer: string;
  defaultLabel: string;
  /** called with the otpauth:// link to store */
  onDone: (uri: string) => void;
  onClose: () => void;
}

/**
 * Sets up a TOTP: from the site's otpauth:// link or secret key, typed or pasted, or from its QR
 * code (a pasted screenshot, an image file, or the camera). Shows the current code before saving,
 * so it can be checked against the site.
 */
export function TotpSetup({ defaultIssuer, defaultLabel, onDone, onClose }: TotpSetupProps) {
  const [text, setText] = useState("");
  const [params, setParams] = useState<TotpParams | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  /** Reads what was typed, pasted or scanned. */
  function accept(input: string) {
    setText(input);
    if (!input.trim()) {
      setParams(null);
      setError("");
      return;
    }
    if (/^otpauth-migration:/i.test(input.trim())) {
      setParams(null);
      setError(
        "That is a Google Authenticator export, which packs several accounts in a format Janus can't read. " +
          "Use the site's own setup QR code, or its secret key.",
      );
      return;
    }
    const parsed = parseTotpInput(input);
    if (typeof parsed === "string") {
      setParams(null);
      setError(parsed);
      return;
    }
    setError("");
    setParams({
      ...parsed,
      issuer: parsed.issuer || defaultIssuer.trim(),
      label: parsed.label || defaultLabel.trim(),
    });
  }

  async function scanImage(image: Blob) {
    setBusy(true);
    setError("");
    try {
      const found = await readQrFromImage(image);
      if (found) accept(found);
      else setError("No QR code was found in that image. Try a sharper or closer screenshot.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // A screenshot pasted anywhere in the dialog (Ctrl+V) is scanned for a QR code.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const image = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (!image) return;
      e.preventDefault();
      setCamera(false);
      scanImage(image);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });

  /** Changes one setting of what was read, checking it again. */
  function change(update: Partial<TotpParams>) {
    if (!params) return;
    const checked = checkTotpParams({ ...params, ...update });
    if (typeof checked === "string") setError(checked);
    else {
      setError("");
      setParams(checked);
    }
  }

  return (
    <Dialog title="Set up TOTP" onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          On the site, choose to add an authenticator app. Then paste its setup link or secret key below, paste a
          screenshot of its QR code (Ctrl+V), choose an image of it, or scan it with the camera.
        </p>

        <div>
          <label htmlFor="totp-input" className={label}>
            Setup link or secret key
          </label>
          <input
            id="totp-input"
            data-autofocus
            autoComplete="off"
            spellCheck={false}
            maxLength={LIMITS.totpInputChars}
            value={text}
            onChange={(e) => accept(e.target.value)}
            placeholder="otpauth://totp/… or JBSW Y3DP EHPK 3PXP"
            className={`${textInput} font-mono`}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" className={secondaryButton} onClick={() => fileInput.current?.click()} disabled={busy}>
            <ImageUp className="w-4 h-4" /> Choose image
          </button>
          <button type="button" className={secondaryButton} onClick={() => setCamera((c) => !c)} disabled={busy}>
            <Camera className="w-4 h-4" /> {camera ? "Stop camera" : "Scan with camera"}
          </button>
          <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
            <ClipboardPaste className="w-3.5 h-3.5" /> or paste a screenshot
          </span>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) scanImage(file);
            }}
          />
        </div>

        {camera && (
          <CameraScanner
            onFound={(found) => {
              setCamera(false);
              accept(found);
            }}
            onError={(message) => {
              setCamera(false);
              setError(message);
            }}
          />
        )}

        {busy && <p className="text-sm text-gray-500">Looking for a QR code…</p>}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        {params && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-4">
            <div>
              <p className={label}>Current code: check it against the site</p>
              <LocalCode params={params} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="totp-issuer" className={label}>
                  Issuer
                </label>
                <input
                  id="totp-issuer"
                  value={params.issuer}
                  onChange={(e) => setParams({ ...params, issuer: e.target.value })}
                  className={textInput}
                />
              </div>
              <div>
                <label htmlFor="totp-label" className={label}>
                  Account
                </label>
                <input
                  id="totp-label"
                  value={params.label}
                  onChange={(e) => setParams({ ...params, label: e.target.value })}
                  className={textInput}
                />
              </div>
            </div>
            <details>
              <summary className="text-xs text-gray-500 cursor-pointer select-none">
                Settings: {params.algorithm}, {params.digits} digits, every {params.period} s
              </summary>
              <p className="text-xs text-gray-400 mt-2 mb-3">
                Setup links carry these; a bare secret key uses the usual ones. Change them only if the site says so.
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor="totp-algorithm" className={label}>
                    Algorithm
                  </label>
                  <select
                    id="totp-algorithm"
                    value={params.algorithm}
                    onChange={(e) => change({ algorithm: e.target.value as TotpAlgorithm })}
                    className={textInput}
                  >
                    {TOTP_ALGORITHMS.map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="totp-digits" className={label}>
                    Digits
                  </label>
                  <select
                    id="totp-digits"
                    value={params.digits}
                    onChange={(e) => change({ digits: Number(e.target.value) })}
                    className={textInput}
                  >
                    {[6, 7, 8].map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="totp-period" className={label}>
                    Seconds
                  </label>
                  <input
                    id="totp-period"
                    type="number"
                    min={1}
                    max={3600}
                    value={params.period}
                    onChange={(e) => change({ period: Number(e.target.value) })}
                    className={textInput}
                  />
                </div>
              </div>
            </details>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={secondaryButton} onClick={(e) => closeDialog(e.currentTarget)}>
            Cancel
          </button>
          <button
            type="button"
            className={primaryButton}
            disabled={!params || !!error}
            onClick={(e) => {
              if (!params) return;
              onDone(formatOtpauth({ ...params, issuer: params.issuer.trim(), label: params.label.trim() }));
              closeDialog(e.currentTarget);
            }}
          >
            Use this TOTP
          </button>
        </div>
      </div>
    </Dialog>
  );
}

interface CameraScannerProps {
  onFound: (text: string) => void;
  onError: (message: string) => void;
}

/** The camera's picture, scanned for a QR code about five times a second. */
function CameraScanner({ onFound, onError }: CameraScannerProps) {
  const video = useRef<HTMLVideoElement>(null);
  const callbacks = useRef({ onFound, onError });
  callbacks.current = { onFound, onError };

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const scan = async () => {
      const v = video.current;
      if (stopped || !v) return;
      if (v.readyState >= v.HAVE_CURRENT_DATA && v.videoWidth > 0) {
        const found = await readQr(v, v.videoWidth, v.videoHeight).catch(() => null);
        if (stopped) return;
        if (found) return callbacks.current.onFound(found);
      }
      timer = setTimeout(scan, 200);
    };

    if (!navigator.mediaDevices?.getUserMedia) {
      callbacks.current.onError("This browser can't use a camera here.");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          video.current.play().catch(() => {});
        }
        scan();
      })
      .catch((err: unknown) => {
        if (stopped) return;
        const name = err instanceof DOMException ? err.name : "";
        callbacks.current.onError(
          name === "NotAllowedError"
            ? "Janus wasn't allowed to use the camera. Allow it in the browser's site settings to scan."
            : "No camera could be opened.",
        );
      });

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="relative">
      <video ref={video} muted playsInline className="w-full max-h-80 rounded-lg bg-black object-contain" />
      <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded bg-black/60 px-2 py-1 text-xs text-white">
        <ScanLine className="w-3.5 h-3.5" /> Point the camera at the QR code
      </span>
    </div>
  );
}
