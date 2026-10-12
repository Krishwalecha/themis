import { useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import { formatBytes } from "../lib/format";
import { MAX_FILE_BYTES, readFile } from "../lib/files";
import type { FileData } from "../lib/types";

// a file slot: pick or drop a file, see its name and size, clear it
export const FilePick = ({ file, onChange, compact = false }: { file?: FileData | null; onChange: (f: FileData | null) => void; compact?: boolean }) => {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  const take = async (f?: File) => {
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) return setError(`${f.name} is ${formatBytes(f.size)}; files can be at most 5 MB.`);
    setError(null);
    onChange(await readFile(f));
  };

  // history keeps a file's name but not its contents
  const missing = file && !file.data;
  return (
    <div className={`file-pick${compact ? " compact" : ""}`}>
      <input ref={input} type="file" hidden onChange={(e) => void take(e.target.files?.[0]).finally(() => (e.target.value = ""))} />
      {file ? (
        <div className={`file-chip${missing ? " missing" : ""}`} title={missing ? "Files aren't kept in history: attach it again" : file.type}>
          <Paperclip size={13} />
          <button
            type="button"
            className="file-name truncate"
            title={missing ? "Attach the file again" : "Replace the file"}
            onClick={() => input.current?.click()}
          >
            {file.name}
          </button>
          <span className="muted small">{missing ? "attach again" : formatBytes(file.size)}</span>
          {!compact && (
            <button type="button" className="link-btn" onClick={() => input.current?.click()}>
              {missing ? "Attach" : "Replace"}
            </button>
          )}
          <button type="button" className="icon-btn" aria-label="Remove file" onClick={() => onChange(null)}>
            <X size={12} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={`file-drop${over ? " over" : ""}`}
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void take(e.dataTransfer.files[0]);
          }}
        >
          <Paperclip size={13} />
          {compact ? "Choose a file" : "Choose a file or drop it here"}
          {!compact && <span className="muted small">up to 5 MB</span>}
        </button>
      )}
      {error && <p className="hint warn">{error}</p>}
    </div>
  );
};
