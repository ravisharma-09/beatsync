"use client";
import { hydrateAuth } from "@/store/auth";
import { useEffect } from "react";

/** Restores the saved login once the app has mounted in the browser. Renders nothing. */
export const AuthHydrator = () => {
  useEffect(() => {
    void hydrateAuth();
  }, []);
  return null;
};
