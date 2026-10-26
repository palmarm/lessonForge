"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useAuth } from "./auth-provider";
import { AuthPanel } from "./auth-panel";
import { LessonsPanel } from "./lessons-panel";
import { ResourcesPanel } from "./resources-panel";
import { Button } from "./ui-controls";
import { useWorkspaceNavigation } from "./workspace-navigation";

// Routes select visibility only. The layout owns these mounted stores until the
// confirmed user/role/session changes; no editor state enters browser storage.
function PersistentWorkspaces({
  pathname,
  admin,
}: {
  pathname: string;
  admin: boolean;
}) {
  return (
    <>
      <div
        hidden={
          admin
            ? pathname !== "/admin/resources"
            : !(pathname === "/resources" || pathname.startsWith("/resources/"))
        }
      >
        <ResourcesPanel />
      </div>
      {!admin && (
        <div hidden={pathname !== "/drafts"}>
          <LessonsPanel />
        </div>
      )}
    </>
  );
}

export function ApplicationShell({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const { requestLeave } = useWorkspaceNavigation();
  const pathname = usePathname();
  const main = useRef<HTMLElement>(null);
  const admin = auth.identity?.user.role === "ADMIN";
  const ready = auth.status === "authenticated" && auth.pending === null;
  const navigation = admin
    ? [{ href: "/admin/resources", label: "Manage resources" }]
    : [
        { href: "/resources", label: "Resources" },
        { href: "/drafts", label: "My drafts" },
      ];
  const workspaceRoute =
    navigation.some((item) => item.href === pathname) ||
    (!admin && pathname.startsWith("/resources/"));
  useEffect(() => {
    const heading = main.current?.querySelector<HTMLElement>("h1");
    heading?.focus();
  }, [pathname, ready]);
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[240px_minmax(0,1fr)] lg:grid-cols-[264px_minmax(0,1fr)]">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="flex min-w-0 flex-col border-b border-neutral-300 bg-neutral-50 px-5 py-5 md:sticky md:top-0 md:h-dvh md:border-r md:border-b-0 md:px-6 md:py-9">
        <p className="text-2xl font-bold tracking-tight">LessonForge</p>
        {auth.identity && (
          <nav
            aria-label={
              admin ? "Administrator navigation" : "Teacher navigation"
            }
            inert={!ready}
            className={`mt-5 grid gap-2 ${admin ? "grid-cols-1" : "grid-cols-2"} md:mt-12 md:grid-cols-1`}
          >
            {navigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={
                  pathname === item.href ||
                  (item.href === "/resources" &&
                    pathname.startsWith("/resources/"))
                    ? "page"
                    : undefined
                }
                className="navigation-link"
                aria-disabled={!ready}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}
        <section
          aria-label="Account"
          className="mt-5 min-w-0 space-y-3 border-t border-neutral-300 pt-4 md:mt-auto md:pt-6"
        >
          {auth.identity ? (
            <>
              <p className="text-sm text-neutral-600">
                {ready
                  ? admin
                    ? "Administrator account"
                    : "Teacher account"
                  : "Last confirmed account"}
              </p>
              <p className="break-words font-semibold">
                {auth.identity.user.displayName}
              </p>
              <Button
                disabled={auth.pending !== null || auth.status === "loading"}
                onClick={() => {
                  if (requestLeave(true)) void auth.logout();
                }}
              >
                {auth.pending === "logout" ? "Signing out…" : "Sign out"}
              </Button>
              <Button
                disabled={auth.pending !== null || auth.status === "loading"}
                onClick={() => void auth.restore()}
              >
                Check session again
              </Button>
            </>
          ) : (
            <Link href="/sign-in" className="text-link">
              Sign in
            </Link>
          )}
        </section>
      </aside>
      <main
        ref={main}
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl min-w-0 space-y-6 px-5 py-8 sm:px-8 sm:py-10 lg:px-12 lg:py-12"
      >
        {(pathname === "/sign-in" || !ready) && <AuthPanel />}
        {auth.identity && pathname !== "/sign-in" && !workspaceRoute && (
          <section className="feedback">
            <h1 className="section-title" tabIndex={-1}>
              This page is unavailable for your role
            </h1>
            <Link href={navigation[0].href} className="text-link">
              Continue to your workspace
            </Link>
          </section>
        )}
        {(workspaceRoute || !auth.identity) &&
          pathname !== "/sign-in" &&
          children}
        {auth.identity && (
          <PersistentWorkspaces
            key={`${auth.identity.user.id}:${auth.identity.user.role}:${auth.identity.expiresAt}`}
            pathname={pathname}
            admin={admin}
          />
        )}
        {pathname === "/sign-in" && ready && (
          <Link className="text-link" href={navigation[0].href}>
            Continue to your workspace
          </Link>
        )}
      </main>
    </div>
  );
}
