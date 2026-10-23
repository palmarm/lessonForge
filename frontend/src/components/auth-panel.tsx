"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "./auth-provider";
import { useWorkspaceNavigation } from "./workspace-navigation";
import { Button, Input } from "./ui-controls";

const buttonStyle = "button";
const inputStyle = "mt-2";

export function AuthPanel() {
  const auth = useAuth();
  const { requestLeave } = useWorkspaceNavigation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>(
    {},
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const emailField = useRef<HTMLInputElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  const pending = auth.pending !== null || auth.status === "loading";
  useEffect(() => {
    heading.current?.focus();
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const submittedPassword = password;
    setPassword("");
    setVisible(false);
    const next = {
      ...(!email.trim() || !emailField.current?.validity.valid
        ? { email: "Enter a valid email address." }
        : {}),
      ...(!submittedPassword ? { password: "Enter your password." } : {}),
    };
    setErrors(next);
    if (Object.keys(next).length) {
      requestAnimationFrame(() => summary.current?.focus());
      return;
    }
    void auth.login(email, submittedPassword);
  }

  return (
    <section
      aria-labelledby="auth-heading"
      className="workspace-panel max-w-lg"
    >
      <h1 ref={heading} tabIndex={-1} id="auth-heading" className="page-title">
        {auth.identity ? "Your account" : "Sign in"}
      </h1>
      <p id="auth-status" role="status" className="mt-3 text-neutral-600">
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
                : auth.notice
                  ? auth.notice
                  : auth.identity
                    ? "You are signed in to LessonForge."
                    : "Sign in with your teacher or administrator account."}
      </p>
      {auth.error && (
        <p id="auth-error" role="alert" className="feedback mt-4">
          {auth.error}
        </p>
      )}
      {Object.keys(errors).length > 0 && (
        <div ref={summary} tabIndex={-1} role="alert" className="feedback mt-4">
          <p className="font-semibold">Check your sign-in details</p>
          {Object.entries(errors).map(([field, error]) => (
            <p key={field}>
              <a href={`#login-${field}`} className="text-link">
                {error}
              </a>
            </p>
          ))}
        </div>
      )}

      {auth.identity ? (
        <div className="mt-6 space-y-4">
          <dl className="space-y-3 text-neutral-900">
            <div>
              <dt className="text-sm text-neutral-600">Name</dt>
              <dd className="break-words font-medium">
                {auth.identity.user.displayName}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-neutral-600">Role</dt>
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
            onClick={() => {
              if (requestLeave(true)) void auth.logout();
            }}
            disabled={pending || auth.status === "loading"}
            aria-describedby={auth.error ? "auth-error" : "auth-status"}
          >
            {auth.pending === "logout" ? "Signing out…" : "Sign out"}
          </button>
        </div>
      ) : auth.status !== "loading" ? (
        <form
          noValidate
          onSubmit={submit}
          aria-busy={pending}
          aria-describedby={auth.error ? "auth-error" : "auth-status"}
          className="mt-6 space-y-5"
        >
          <div>
            <label htmlFor="login-email" className="font-medium text-neutral-900">
              Email
            </label>
            <Input
              ref={emailField}
              id="login-email"
              name="email"
              type="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              inputMode="email"
              required
              maxLength={254}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? "email-error" : undefined}
              className={inputStyle}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={pending}
            />
            {errors.email && <p id="email-error">{errors.email}</p>}
          </div>
          <div>
            <label
              htmlFor="login-password"
              className="font-medium text-neutral-900"
            >
              Password
            </label>
            <Input
              id="login-password"
              name="password"
              type={visible ? "text" : "password"}
              autoComplete="current-password"
              required
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? "password-error" : undefined}
              className={inputStyle}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={pending}
            />
            <Button
              className="mt-2"
              disabled={pending}
              aria-controls="login-password"
              aria-pressed={visible}
              onClick={() => setVisible(!visible)}
            >
              {visible ? "Hide password" : "Show password"}
            </Button>
            {errors.password && <p id="password-error">{errors.password}</p>}
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
          className="button mt-4"
        >
          Check session again
        </button>
      )}
    </section>
  );
}
