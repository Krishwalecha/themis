export type Shell = "bash" | "powershell" | "cmd";

export const SHELLS: Array<{ id: Shell; label: string; hint: string }> = [
  { id: "bash", label: "macOS / Linux", hint: "bash, zsh, Git Bash or WSL" },
  { id: "powershell", label: "PowerShell", hint: "Windows PowerShell 5.1 or PowerShell 7" },
  { id: "cmd", label: "cmd", hint: "Windows Command Prompt" },
];

export type Req = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: string;
  // "save" signs in and keeps the session, "send" reuses it
  auth?: "save" | "send";
  // exit non-zero when the call fails; pair with ?strict=1 to also fail on a bad verdict
  fail?: boolean;
};

// VITE_THEMIS_API_URL wins; otherwise the local API in dev, or this site's own origin
export const API_BASE = (
  (import.meta.env.VITE_THEMIS_API_URL as string | undefined) || (import.meta.env.DEV ? "localhost:4000" : window.location.origin)
).replace(/\/+$/, "");

export const PROMPT: Record<Shell, string> = { bash: "$", powershell: "PS>", cmd: ">" };

const SHELL_KEY = "themis.shell";

export const preferredShell = (): Shell => {
  try {
    const saved = localStorage.getItem(SHELL_KEY);
    if (saved === "bash" || saved === "powershell" || saved === "cmd") return saved;
  } catch {
    /* storage unavailable */
  }
  return /Windows/i.test(navigator.userAgent) ? "powershell" : "bash";
};

export const rememberShell = (shell: Shell) => {
  try {
    localStorage.setItem(SHELL_KEY, shell);
  } catch {
    /* storage unavailable */
  }
};

export const comment = (text: string, shell: Shell) => (shell === "cmd" ? `:: ${text}` : `# ${text}`);

const withScheme = (base: string) => (/^https?:\/\//.test(base) ? base : `http://${base}`);

const curlHead = (r: Req, header: string) =>
  [
    r.fail ? "curl -sf" : "curl -s",
    r.method && r.method !== "GET" && !(r.method === "POST" && r.body) && `-X ${r.method}`,
    r.auth === "save" && "-c .themis",
    r.auth === "send" && "-b .themis",
    r.body && header,
  ]
    .filter(Boolean)
    .join(" ");

// quote URLs with ? or & so zsh and cmd don't treat them as globs or separators
const bash = (r: Req, base: string) => {
  const url = /[?&]/.test(r.path) ? `'${base}${r.path}'` : `${base}${r.path}`;
  return [curlHead(r, "-H 'content-type: application/json'"), r.body && `-d '${r.body}'`, url].filter(Boolean).join(" \\\n  ");
};

const cmd = (r: Req, base: string) => {
  const url = /[?&]/.test(r.path) ? `"${base}${r.path}"` : `${base}${r.path}`;
  const body = r.body && `-d "${r.body.replace(/"/g, '\\"')}"`;
  return [curlHead(r, '-H "content-type: application/json"'), body, url].filter(Boolean).join(" ^\n  ");
};

const psMethod = (r: Req) => {
  const m = r.method ?? (r.body ? "POST" : "GET");
  return m === "GET" ? "" : ` -Method ${m[0]}${m.slice(1).toLowerCase()}`;
};

// curl is an alias in Windows PowerShell, so use its own client; the session lives in $themis
const powershell = (r: Req, base: string) =>
  [
    `Invoke-RestMethod${psMethod(r)} -Uri '${withScheme(base)}${r.path}'`,
    r.body && `-ContentType 'application/json' -Body '${r.body}'`,
    r.auth === "save" && "-SessionVariable themis",
    r.auth === "send" && "-WebSession $themis",
  ]
    .filter(Boolean)
    .join(" `\n  ");

export const toCommand = (r: Req, shell: Shell, base: string) =>
  shell === "powershell" ? powershell(r, base) : shell === "cmd" ? cmd(r, base) : bash(r, base);
