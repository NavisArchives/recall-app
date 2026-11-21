import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { WorkspaceTheme } from "@/lib/workspaceTheme";
import { clearSessionCache } from "@/lib/sessionCache";

export type Role = "user" | "admin" | "co_author";

export interface ActiveProfile {
  id: string;
  name: string;
  role: Role;
  /**
   * The workspace colour this person chose (058). Absent on an older
   * response, which reads as "dark" — the original, and the default.
   */
  workspace_theme?: WorkspaceTheme;
}

interface SessionResponse {
  device: boolean;
  /**
   * Signed in with the family password, from anywhere (M40).
   *
   * Its own field rather than folded into `device`, because they are
   * different powers: a device is a machine the family trusts and may show
   * the subject's own profile; a family session is a person somewhere else
   * and never may.
   */
  family?: boolean;
  profile: ActiveProfile | null;
}

interface AuthContextValue {
  /** Level 1: is this a trusted machine? */
  hasDevice: boolean;
  /** Signed in remotely with the family password. */
  hasFamily: boolean;
  /** Either way in — enough to be somebody here. */
  signedIn: boolean;
  /** Level 2: who is at the keyboard right now? */
  profile: ActiveProfile | null;
  role: Role | null;
  isAdmin: boolean;
  isCoAuthor: boolean;
  isUser: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  /**
   * A person signing in from anywhere with the family password (M40).
   *
   * Says a *person* is here, on whatever they happen to be holding, and it is
   * revocable server-side the moment somebody says so.
   *
   * Returns where to go, because the answer depends on who signed in — a
   * family lands on its chooser, the platform owner on the one page that is
   * theirs.
   *
   * `code` is the platform owner's authenticator code (access-5). The server
   * asks for it only after a right password, by refusing with
   * `code: "needs_code"`; the page then shows the field and sends it here.
   */
  signInFamily: (email: string, password: string, code?: string) => Promise<{ next: string }>;
  /**
   * The same family credential, electing this machine as the family screen
   * (M111). Different from `signInFamily` in kind, not degree: this pairs the
   * *machine* — the one trusted device per family — and starts the subject's
   * own session, so her display is never interrupted. The old installation
   * username that used to do this is gone as a user-facing concept.
   */
  /*
   * Since access-2 an administrator of the family confirms with their own
   * PIN: the password alone, which every member knows, no longer makes a
   * machine that reads every channel. `pairingAdmins` is the first step —
   * the password, then who may confirm.
   */
  pairingAdmins: (email: string, password: string) => Promise<PairingAdmin[]>;
  pairScreen: (email: string, password: string, adminId: string, pin: string) => Promise<void>;
  /**
   * The replacement ceremony's last step (M117): an emailed single-use token
   * makes this machine the family screen and retires the old one. Gated by
   * the family email, not the password — minting a second trusted device is
   * the one action the password must not perform (M116).
   */
  completeScreenReplacement: (token: string) => Promise<void>;
  unlockProfile: (id: string, pin?: string) => Promise<{ role: Role; redirect_to: string }>;
  /** Leaves the machine trusted; the next person only needs their PIN. */
  switchProfile: () => Promise<void>;
  /** Signs the whole installation out. */
  signOut: () => Promise<void>;
}

/** Who can confirm a pairing: an administrator of the family with a PIN. */
export interface PairingAdmin {
  id: string;
  name: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * A device where the subject's profile has been opened is her screen.
 *
 * The mark decides what "leaving" means there: a helper's session is a visit,
 * and the way out leads back to her display — never to a signed-out kiosk.
 * On a device she has never used (a helper's own laptop), signing out is
 * signing out. The mark survives profile switches and dies with the
 * installation sign-out.
 */
const SUBJECT_DEVICE_KEY = "recall:subject-device";

export function isSubjectDevice(): boolean {
  try {
    return localStorage.getItem(SUBJECT_DEVICE_KEY) === "1";
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<SessionResponse>({ device: false, family: false, profile: null });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // Requests and cached payloads belong to the identity that started them.
    // Session changes must not let a later family/profile observe those rows.
    await clearSessionCache(queryClient);
    try {
      setState(await api.get<SessionResponse>("/auth/session"));
    } catch {
      setState({ device: false, family: false, profile: null });
    }
  }, [queryClient]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const signInFamily = useCallback(
    async (email: string, password: string, code?: string) => {
      const res = await api.post<{ ok: true; next: string }>("/family/login", {
        email,
        password,
        ...(code ? { code } : {}),
      });
      await refresh();
      return { next: res.next };
    },
    [refresh]
  );

  const pairingAdmins = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ admins: PairingAdmin[] }>("/family/pair-screen/admins", {
      email,
      password,
    });
    return res.admins;
  }, []);

  const pairScreen = useCallback(
    async (email: string, password: string, adminId: string, pin: string) => {
      await api.post("/family/pair-screen", { email, password, admin_person_id: adminId, pin });
      /*
       * A paired machine is her screen, whether or not her profile exists
       * yet: the mark decides what "leaving" means here, and on the family
       * screen the way out must lead back to her display.
       */
      try {
        localStorage.setItem(SUBJECT_DEVICE_KEY, "1");
      } catch {
        /* a device that cannot remember stays an ordinary one */
      }
      await refresh();
    },
    [refresh]
  );

  const completeScreenReplacement = useCallback(
    async (token: string) => {
      await api.post("/family/replace-screen/complete", { token });
      // Same mark as pairScreen, for the same reason: this machine is her
      // screen now, and the way out must lead back to her display.
      try {
        localStorage.setItem(SUBJECT_DEVICE_KEY, "1");
      } catch {
        /* a device that cannot remember stays an ordinary one */
      }
      await refresh();
    },
    [refresh]
  );

  const unlockProfile = useCallback(
    async (id: string, pin?: string) => {
      const res = await api.post<{ role: Role; redirect_to: string }>(
        `/auth/profiles/${id}/unlock`,
        pin ? { pin } : {}
      );
      if (res.role === "user") {
        try {
          localStorage.setItem(SUBJECT_DEVICE_KEY, "1");
        } catch {
          /* a device that cannot remember stays an ordinary one */
        }
      }
      await refresh();
      return res;
    },
    [refresh]
  );

  const switchProfile = useCallback(async () => {
    await api.post("/auth/profiles/sign-out");
    await refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await api.post("/auth/sign-out");
    try {
      localStorage.removeItem(SUBJECT_DEVICE_KEY);
    } catch {
      /* nothing to forget */
    }
    await refresh();
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({
      hasDevice: state.device,
      hasFamily: !!state.family,
      signedIn: state.device || !!state.family,
      profile: state.profile,
      role: state.profile?.role ?? null,
      isAdmin: state.profile?.role === "admin",
      isCoAuthor: state.profile?.role === "co_author",
      isUser: state.profile?.role === "user",
      loading,
      refresh,
      signInFamily,
      pairingAdmins,
      pairScreen,
      completeScreenReplacement,
      unlockProfile,
      switchProfile,
      signOut,
    }),
    [state, loading, refresh, signInFamily, pairingAdmins, pairScreen, completeScreenReplacement, unlockProfile, switchProfile, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
