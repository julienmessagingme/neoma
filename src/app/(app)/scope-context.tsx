"use client";

import { createContext, useContext } from "react";

/**
 * Contexte client exposant le scope courant (école précise vs EDH groupe).
 * Posé par le layout serveur autour de `children`, il évite de threader
 * `isEdhScope` à travers toutes les pages serveurs juste pour le repasser
 * aux composants client (sub-nav, builder, etc.).
 */
interface ScopeValue {
  slug: string;
  isEdh: boolean;
}

const ScopeContext = createContext<ScopeValue>({ slug: "", isEdh: false });

export function ScopeProvider({
  slug,
  isEdh,
  children,
}: {
  slug: string;
  isEdh: boolean;
  children: React.ReactNode;
}) {
  return (
    <ScopeContext.Provider value={{ slug, isEdh }}>
      {children}
    </ScopeContext.Provider>
  );
}

export function useScope(): ScopeValue {
  return useContext(ScopeContext);
}
