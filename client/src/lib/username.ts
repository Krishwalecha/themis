import { useEffect, useState } from "react";
import { api } from "./api";

type Availability = { state: "idle" | "checking" | "ok" | "bad"; reason?: string | null };

export const USERNAME = /^[a-z0-9_]{3,20}$/;

// live "is this handle free" check, a beat after typing stops; your current handle counts as free
export const useUsernameCheck = (value: string, current: string) => {
  const [avail, setAvail] = useState<Availability>({ state: "idle" });
  useEffect(() => {
    const next = value.trim().toLowerCase();
    if (!next || next === current) return setAvail({ state: "idle" });
    if (!USERNAME.test(next)) return setAvail({ state: "bad", reason: "3 to 20 lowercase letters, numbers or _" });
    setAvail({ state: "checking" });
    let alive = true;
    const t = window.setTimeout(() => {
      api.auth
        .usernameAvailable(next)
        .then((r) => alive && setAvail(r.available ? { state: "ok" } : { state: "bad", reason: r.reason }))
        .catch(() => alive && setAvail({ state: "idle" }));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [value, current]);
  return avail;
};
