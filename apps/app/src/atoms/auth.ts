import { atom } from "jotai";
import type { User } from "better-auth/types";

export const userAtom = atom<User | null>(null);
export const tokenAtom = atom<string | null>(null);
export const roleAtom = atom<"owner" | "admin" | "member" | undefined>(
	undefined
);
