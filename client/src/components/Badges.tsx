import { HTTP_METHODS } from "../lib/types";
import { statusTone } from "../lib/format";

export const MethodBadge = ({ method }: { method: string }) => {
  return <span className={`method method-${method.toLowerCase()}`}>{method}</span>;
};

export const StatusBadge = ({ status, errorCode }: { status: number; errorCode?: string }) => {
  const tone = statusTone(status);
  return (
    <span className={`status status-${tone}`} title={errorCode}>
      {status === 0 ? (errorCode ? errorCode.replace(/_/g, " ").toLowerCase() : "error") : status}
    </span>
  );
};

// Options for HTTP method dropdowns, coloured per method
export const METHOD_OPTIONS = HTTP_METHODS.map((m) => ({ value: m, label: m, className: `method-${m.toLowerCase()}` }));
