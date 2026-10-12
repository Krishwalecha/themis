import type { EnvironmentVariable, RequestSpec } from "./types";
import type { Shell } from "./shell";

// shell-safe quoting: bash single quotes, PowerShell single quotes, cmd double quotes
const quote = (s: string, shell: Shell) =>
  shell === "cmd" ? `"${s.replace(/"/g, '\\"')}"` : shell === "powershell" ? `'${s.replace(/'/g, "''")}'` : `'${s.replace(/'/g, `'\\''`)}'`;

const CONTINUE: Record<Shell, string> = { bash: " \\\n  ", powershell: " `\n  ", cmd: " ^\n  " };

// fills in non-secret environment variables; secrets stay as {{name}} so they never reach the clipboard
const resolve = (text: string, vars: EnvironmentVariable[]) =>
  text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, name: string) => {
    const v = vars.find((x) => x.enabled && x.key === name);
    return v && !v.secret ? v.value : whole;
  });

// the request as a curl command for the user's shell (PowerShell uses curl.exe, not its Invoke-WebRequest alias)
export const toCurl = (spec: RequestSpec, vars: EnvironmentVariable[], shell: Shell): string => {
  const r = (s: string) => resolve(s, vars);
  const parts: string[] = [];
  let url = r(spec.url);
  const params = spec.params.filter((p) => p.enabled && p.key && !url.includes(`${p.key}=`));
  if (params.length) url += (url.includes("?") ? "&" : "?") + params.map((p) => `${encodeURIComponent(r(p.key))}=${encodeURIComponent(r(p.value))}`).join("&");
  if (spec.auth.type === "apiKey" && spec.auth.in === "query")
    url += `${url.includes("?") ? "&" : "?"}${encodeURIComponent(r(spec.auth.key))}=${encodeURIComponent(r(spec.auth.value))}`;

  if (spec.method !== "GET" || spec.body.mode !== "none") parts.push(`-X ${spec.method}`);
  parts.push(quote(url, shell));
  for (const h of spec.headers.filter((h) => h.enabled && h.key)) parts.push(`-H ${quote(`${r(h.key)}: ${r(h.value)}`, shell)}`);
  if (spec.auth.type === "bearer") parts.push(`-H ${quote(`Authorization: Bearer ${r(spec.auth.token)}`, shell)}`);
  if (spec.auth.type === "basic") parts.push(`-u ${quote(`${r(spec.auth.username)}:${r(spec.auth.password)}`, shell)}`);
  if (spec.auth.type === "apiKey" && spec.auth.in === "header") parts.push(`-H ${quote(`${r(spec.auth.key)}: ${r(spec.auth.value)}`, shell)}`);

  const has = (name: string) => spec.headers.some((h) => h.enabled && h.key.toLowerCase() === name);
  let body: string | null = null;
  if (spec.body.mode === "json") {
    if (!has("content-type")) parts.push(`-H ${quote("Content-Type: application/json", shell)}`);
    body = r(spec.body.content);
    try {
      body = JSON.stringify(JSON.parse(body));
    } catch {
      /* send as written */
    }
  } else if (spec.body.mode === "text") {
    body = r(spec.body.content);
  } else if (spec.body.mode === "form-urlencoded") {
    for (const f of spec.body.form.filter((f) => f.enabled && f.key)) parts.push(`--data-urlencode ${quote(`${r(f.key)}=${r(f.value)}`, shell)}`);
  } else if (spec.body.mode === "multipart") {
    // files are referenced by name: curl reads them from the current folder
    for (const p of spec.body.parts.filter((p) => p.enabled && p.key)) {
      if (p.kind === "file" && p.file) parts.push(`-F ${quote(`${r(p.key)}=@${p.file.name};type=${p.file.type}`, shell)}`);
      else if (p.kind === "text") parts.push(`-F ${quote(`${r(p.key)}=${r(p.value)}`, shell)}`);
    }
  } else if (spec.body.mode === "binary" && spec.body.file) {
    if (!has("content-type")) parts.push(`-H ${quote(`Content-Type: ${spec.body.file.type}`, shell)}`);
    parts.push(`--data-binary ${quote(`@${spec.body.file.name}`, shell)}`);
  }
  if (!spec.followRedirects) parts.push("--max-redirs 0");
  else parts.push("-L");
  if (spec.timeoutMs) parts.push(`-m ${Math.ceil(spec.timeoutMs / 1000)}`);

  // PowerShell mangles double quotes in native arguments, so the body goes in through stdin instead
  if (body !== null && shell === "powershell")
    return `@'
${body}
'@ | curl.exe ${[...parts, "--data-binary '@-'"].join(CONTINUE.powershell)}`;
  if (body !== null) parts.push(`--data-raw ${quote(body, shell)}`);
  return `${shell === "powershell" ? "curl.exe" : "curl"} ${parts.join(CONTINUE[shell])}`;
};
