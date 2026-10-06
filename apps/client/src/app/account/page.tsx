"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, register } from "@/lib/accountApi";
import { useAuthStore } from "@/store/auth";
import { PASSWORD_MIN_LENGTH, USERNAME_MAX_LENGTH } from "@beatsync/shared";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Mode = "login" | "signup";

export default function AccountPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const setSession = useAuthStore((state) => state.setSession);

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // Already logged in: nothing to do here
  useEffect(() => {
    if (user) router.replace("/library");
  }, [user, router]);

  const submit = useMutation({
    mutationFn: () => (mode === "login" ? login({ email, password }) : register({ email, username, password })),
    onSuccess: (session) => {
      setSession(session);
      router.replace("/library");
    },
  });

  const switchMode = (next: Mode) => {
    setMode(next);
    submit.reset();
  };

  return (
    <div className="w-full px-2.5 max-w-[24rem] mx-auto mt-24 lg:mt-28">
      <div className="p-6 bg-neutral-900 rounded-lg border border-neutral-800 shadow-xl">
        <h1 className="text-base font-medium tracking-tight text-white text-center">
          {mode === "login" ? "Log in" : "Create your account"}
        </h1>
        <p className="text-neutral-400 mt-1 mb-5 text-center text-xs">
          An account keeps your music, playlists and rooms.
        </p>

        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit.mutate();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email" className="text-xs text-neutral-400">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          {mode === "signup" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="username" className="text-xs text-neutral-400">
                Name shown in rooms
              </Label>
              <Input
                id="username"
                autoComplete="nickname"
                required
                minLength={2}
                maxLength={USERNAME_MAX_LENGTH}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password" className="text-xs text-neutral-400">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              minLength={mode === "signup" ? PASSWORD_MIN_LENGTH : undefined}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {mode === "signup" && (
              <p className="text-[11px] text-neutral-500">At least {PASSWORD_MIN_LENGTH} characters.</p>
            )}
          </div>

          {submit.error && (
            <p role="alert" className="text-xs text-red-400">
              {submit.error.message}
            </p>
          )}

          <Button type="submit" className="rounded-full w-full" disabled={submit.isPending}>
            {submit.isPending ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
          </Button>
        </form>

        <div className="mt-5 text-center text-xs text-neutral-400">
          {mode === "login" ? "New here?" : "Already have an account?"}{" "}
          <button
            type="button"
            className="text-white underline underline-offset-2 cursor-pointer"
            onClick={() => switchMode(mode === "login" ? "signup" : "login")}
          >
            {mode === "login" ? "Create an account" : "Log in"}
          </button>
        </div>
      </div>

      <div className="mt-4 text-center">
        <Link href="/" className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors">
          Continue without an account
        </Link>
      </div>
    </div>
  );
}
