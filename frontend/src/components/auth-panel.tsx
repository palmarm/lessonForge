"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "./auth-provider";

const buttonStyle =
  "rounded-lg bg-slate-900 px-5 py-3 font-semibold text-white transition hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-700 disabled:cursor-wait disabled:opacity-60";
const inputStyle =
  "mt-2 w-full rounded-lg border border-slate-400 bg-white px-3 py-3 text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-700 disabled:opacity-60";

export function AuthPanel() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const pending = auth.pending !== null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const submittedPassword = password;
    setPassword("");
    void auth.login(email, submittedPassword);
  }

  return (
    <section
      aria-labelledby="auth-heading"
      className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <h2 id="auth-heading" className="text-2xl font-semibold text-slate-900">
        {auth.identity ? "Your account" : "Sign in"}
      </h2>
      <p id="auth-status" role="status" className="mt-3 text-slate-600">
        {auth.pending === "login"
          ? "Signing in…"
          : auth.pending === "logout"
            ? "Signing out…"
            : auth.status === "loading"
              ? "Checking your session…"
              : auth.status === "error"
                ? auth.identity
                  ? "We could not confirm the latest request. Your last confirmed account is shown."
                  : "We could not confirm your session. Check your session or try signing in again."
                : auth.identity
                  ? "You are signed in to LessonForge."
                  : "Sign in with your teacher or administrator account."}
      </p>
      {auth.error && (
        <p
          id="auth-error"
          role="alert"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800"
        >
          {auth.error}
        </p>
      )}

      {auth.identity ? (
        <div className="mt-6 space-y-4">
          <dl className="space-y-3 text-slate-900">
            <div>
              <dt className="text-sm text-slate-600">Name</dt>
              <dd className="break-words font-medium">
                {auth.identity.user.displayName}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-slate-600">Role</dt>
              <dd>
                {auth.identity.user.role === "ADMIN"
                  ? "Administrator"
                  : "Teacher"}
              </dd>
            </div>
          </dl>
          <button
            type="button"
            className={buttonStyle}
            onClick={() => void auth.logout()}
            disabled={pending || auth.status === "loading"}
            aria-describedby={auth.error ? "auth-error" : "auth-status"}
          >
            {auth.pending === "logout" ? "Signing out…" : "Sign out"}
          </button>
        </div>
      ) : auth.status !== "loading" ? (
        <form
          onSubmit={submit}
          aria-busy={pending}
          aria-describedby={auth.error ? "auth-error" : "auth-status"}
          className="mt-6 space-y-5"
        >
          <div>
            <label htmlFor="login-email" className="font-medium text-slate-900">
              Email
            </label>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              inputMode="email"
              required
              className={inputStyle}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={pending}
            />
          </div>
          <div>
            <label
              htmlFor="login-password"
              className="font-medium text-slate-900"
            >
              Password
            </label>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className={inputStyle}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={pending}
            />
          </div>
          <button
            type="submit"
            className={`${buttonStyle} w-full`}
            disabled={pending}
          >
            {auth.pending === "login" ? "Signing in…" : "Sign in"}
          </button>
        </form>
      ) : null}
      {auth.status === "error" && (
        <button
          type="button"
          onClick={() => void auth.restore()}
          className="mt-4 rounded text-sm font-medium text-slate-700 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-700"
        >
          Check session again
        </button>
      )}
    </section>
  );
}
