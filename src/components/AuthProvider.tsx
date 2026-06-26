"use client";

import {
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  type User
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { auth, db, isFirebaseConfigured } from "@/lib/firebase";
import type { UserProfile } from "@/lib/types";

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  user: User | null;
  profile: UserProfile | null;
  authError: string;
  signIn: (email: string, password: string) => Promise<void>;
  signOutUser: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(isFirebaseConfigured);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }

    const fallback = window.setTimeout(() => {
      setLoading(false);
    }, 4000);

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      window.clearTimeout(fallback);
      void handleAuthState(nextUser);
    });

    return () => {
      window.clearTimeout(fallback);
      unsubscribe();
    };
  }, []);

  async function handleAuthState(nextUser: User | null) {
    setAuthError("");

    if (!nextUser) {
      setUser(null);
      setProfile(null);
      setLoading(false);
      return;
    }

    try {
      const nextProfile = await assertActiveUser(nextUser.uid);
      setUser(nextUser);
      setProfile(nextProfile);
    } catch (caught) {
      setUser(null);
      setProfile(null);
      setAuthError(caught instanceof Error ? caught.message : "此帳號目前無法使用，請聯絡管理員。");
      if (auth) {
        await signOut(auth);
      }
    } finally {
      setLoading(false);
    }
  }

  const value = useMemo<AuthContextValue>(
    () => ({
      configured: isFirebaseConfigured,
      loading,
      user,
      profile,
      authError,
      async signIn(email, password) {
        if (!auth) throw new Error("Firebase 尚未設定。");
        setAuthError("");
        const credential = await signInWithEmailAndPassword(auth, email, password);
        try {
          await assertActiveUser(credential.user.uid);
        } catch (caught) {
          await signOut(auth);
          throw caught;
        }
      },
      async signOutUser() {
        if (!auth) return;
        await signOut(auth);
      },
      async changePassword(currentPassword, newPassword) {
        if (!auth?.currentUser) throw new Error("請先登入。");
        const email = auth.currentUser.email;
        if (!email) throw new Error("此帳號沒有 Email，無法修改密碼。");
        if (newPassword.length < 6) throw new Error("新密碼至少需要 6 碼。");

        const credential = EmailAuthProvider.credential(email, currentPassword);
        await reauthenticateWithCredential(auth.currentUser, credential);
        await updatePassword(auth.currentUser, newPassword);
      }
    }),
    [authError, loading, profile, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

async function assertActiveUser(uid: string) {
  if (!db) {
    throw new Error("Firebase 尚未設定。");
  }

  const snapshot = await getDoc(doc(db, "users", uid));

  if (!snapshot.exists()) {
    throw new Error("此帳號尚未建立員工資料，請聯絡管理員。");
  }

  const data = snapshot.data();

  if (data.active === false) {
    throw new Error("此帳號已停用，請聯絡管理員。");
  }

  return {
    id: snapshot.id,
    email: String(data.email ?? ""),
    displayName: String(data.displayName ?? ""),
    role: data.role === "owner" || data.role === "admin" || data.role === "staff" || data.role === "viewer"
      ? data.role
      : "staff",
    active: data.active !== false,
    createdAt: null,
    updatedAt: null
  } satisfies UserProfile;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
}
